import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ProductUnderstanding, VideoScript, VideoTone, VideoLength } from '@/types'
import { retryWithBackoff } from '@/lib/utils'
import { logger } from '@/lib/logger'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')

/**
 * Ordered list of models to try. If the first model fails (e.g. 503 overload),
 * the next one is attempted automatically.
 */
const MODEL_CHAIN = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']

/**
 * Tries to generate content using the model fallback chain.
 * Each model gets full retry-with-backoff treatment before moving on.
 */
async function generateWithFallback(
  systemInstruction: string,
  prompt: string
): Promise<string> {
  let lastError: Error | null = null

  for (const modelName of MODEL_CHAIN) {
    try {
      logger.info(`gemini: trying model ${modelName}`)
      const result = await retryWithBackoff(async () => {
        const model = genAI.getGenerativeModel({ model: modelName, systemInstruction })
        const res = await model.generateContent(prompt)
        return res.response.text().trim()
      })
      return result
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      logger.warn(`gemini: model ${modelName} failed, trying next fallback`, {
        error: lastError.message,
      })
    }
  }

  throw lastError ?? new Error('All Gemini models failed')
}

/**
 * Extracts a JSON string from a text block, even if it contains Conversational
 * leading/trailing text or markdown fences.
 */
function extractJson(text: string): string {
  // If no JSON-like content found, return as-is (JSON.parse will catch it)
  if (!text.includes('{')) return text

  // 1. Try to find content between triple backticks
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i
  const match = text.match(codeBlockRegex)
  if (match?.[1]) return match[1].trim()

  // 2. Fallback: Find the first '{' and last '}'
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1).trim()
  }

  return text.trim()
}

/**
 * Analyzes a scraped product page and returns a structured ProductUnderstanding.
 */
export async function understandProduct(
  productUrl: string,
  scrapedContent: string,
  description?: string
): Promise<ProductUnderstanding> {
  const systemInstruction =
    'You are an expert product analyst. Analyze products and return ONLY valid JSON — no markdown, no code fences, no explanation.'

  const prompt = `Analyze this product and return ONLY valid JSON matching this exact structure:
{
  "product_name": "string",
  "tagline": "string (one punchy sentence)",
  "core_value_prop": "string",
  "target_audience": "string",
  "top_5_features": ["string","string","string","string","string"],
  "brand_tone": "string",
  "product_category": "string",
  "problem_being_solved": "string",
  "key_pages_to_visit": ["string"],
  "demo_flow": [
    {
      "step": 1,
      "action": "navigate",
      "description": "string",
      "element_to_click": "string (optional)",
      "navigate_to": "string (optional)"
    }
  ]
}

Product URL: ${productUrl}
User description: ${description ?? 'Not provided'}
Scraped content:
${scrapedContent.slice(0, 10000)}`

  const text = await generateWithFallback(systemInstruction, prompt)
  const jsonText = extractJson(text)

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    logger.error('understandProduct: Gemini returned non-JSON', { raw: text.slice(0, 500) })
    throw new Error('Gemini returned malformed JSON. Please try again.')
  }

  const p = parsed as Record<string, unknown>
  if (
    !p.product_name ||
    !p.tagline ||
    !Array.isArray(p.demo_flow) ||
    p.demo_flow.length === 0
  ) {
    logger.error('understandProduct: missing required fields', { parsed })
    throw new Error('Gemini response was missing required fields. Please try again.')
  }

  return parsed as ProductUnderstanding
}

/**
 * Generates a professional video script timed to the recorded demo.
 */
export async function generateScript(
  understanding: ProductUnderstanding,
  tone: VideoTone,
  videoLength: VideoLength
): Promise<VideoScript> {
  const systemInstruction =
    'You are a world-class product video scriptwriter. Return ONLY valid JSON — no markdown, no code fences, no explanation.'

  const prompt = `Write a ${videoLength}-second product launch video script for "${understanding.product_name}".
Return ONLY valid JSON:
{
  "total_duration": ${videoLength},
  "segments": [
    {
      "start_time": 0,
      "end_time": 5,
      "narration": "exact words to speak",
      "what_to_show": "what appears on screen",
      "zoom_target": "optional element to zoom"
    }
  ]
}

Rules:
- Hook (0-5s): open with the pain point
- Solution (5-15s): introduce ${understanding.product_name}
- Features (15-${videoLength - 5}s): narrate each feature
- CTA (last 5s): strong call to action
- Tone: ${tone}
- Audience: ${understanding.target_audience}
- Value prop: ${understanding.core_value_prop}
- Features: ${understanding.top_5_features.join(', ')}`

  const text = await generateWithFallback(systemInstruction, prompt)
  const jsonText = extractJson(text)

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    logger.error('generateScript: Gemini returned non-JSON', { raw: text.slice(0, 500) })
    throw new Error('Gemini returned malformed JSON for script. Please try again.')
  }

  const p = parsed as Record<string, unknown>
  if (typeof p.total_duration !== 'number' || !Array.isArray(p.segments) || p.segments.length === 0) {
    logger.error('generateScript: missing required fields', { parsed })
    throw new Error('Gemini script response was missing required fields. Please try again.')
  }

  return parsed as VideoScript
}

