import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ProductUnderstanding, VideoScript, VideoTone, VideoLength } from '@/types'
import { retryWithBackoff } from '@/lib/utils'
import { logger } from '@/lib/logger'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')

/**
 * Gets the Gemini 1.5 Pro model instance.
 */
function getModel() {
  return genAI.getGenerativeModel({ model: 'gemini-1.5-pro' })
}

/**
 * Analyzes a scraped product page and returns a structured ProductUnderstanding.
 * Uses retryWithBackoff internally for resilience against transient API failures.
 * @param productUrl - The URL of the product being analyzed
 * @param scrapedContent - Markdown content scraped from the product site
 * @param description - Optional user-provided description of the product
 */
export async function understandProduct(
  productUrl: string,
  scrapedContent: string,
  description?: string
): Promise<ProductUnderstanding> {
  return retryWithBackoff(async () => {
    const model = getModel()

    const systemInstruction = `You are an expert product analyst and UX researcher. You have deep knowledge of SaaS products, startup launches, and what makes a compelling product demo video. Analyze the provided product information thoroughly.`

    const userPrompt = `Analyze this product and return ONLY valid JSON with no markdown formatting, no code blocks, no explanation. Return exactly this structure:
{
  "product_name": "string",
  "tagline": "string (one punchy sentence)",
  "core_value_prop": "string (what problem it solves and how)",
  "target_audience": "string (who uses this and why)",
  "top_5_features": ["string", "string", "string", "string", "string"],
  "brand_tone": "string (professional/playful/technical/friendly)",
  "product_category": "string (e.g. project management, CRM, analytics)",
  "problem_being_solved": "string (the specific pain point addressed)",
  "key_pages_to_visit": ["string"],
  "demo_flow": [
    {
      "step": 1,
      "action": "string (scroll_down/scroll_up/click/navigate/wait)",
      "description": "string (what this step shows the viewer)",
      "element_to_click": "string (optional, button text or element description)",
      "navigate_to": "string (optional, URL path to navigate to)"
    }
  ]
}

Product URL: ${productUrl}
User description: ${description ?? 'Not provided'}
Scraped content: ${scrapedContent.slice(0, 8000)}`

    const result = await model.generateContent({
      systemInstruction,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    })

    const text = result.response.text().trim()

    // Strip any markdown code fences if Gemini wraps the response
    const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      logger.error('understandProduct: failed to parse Gemini JSON response', { raw: jsonText.slice(0, 500) })
      throw new Error('Gemini returned invalid JSON for product understanding')
    }

    // Validate required fields
    const p = parsed as Record<string, unknown>
    if (
      typeof p.product_name !== 'string' ||
      typeof p.tagline !== 'string' ||
      typeof p.core_value_prop !== 'string' ||
      typeof p.target_audience !== 'string' ||
      !Array.isArray(p.top_5_features) ||
      typeof p.brand_tone !== 'string' ||
      typeof p.product_category !== 'string' ||
      typeof p.problem_being_solved !== 'string' ||
      !Array.isArray(p.key_pages_to_visit) ||
      !Array.isArray(p.demo_flow)
    ) {
      throw new Error('Gemini response missing required fields for ProductUnderstanding')
    }

    return parsed as ProductUnderstanding
  })
}

/**
 * Generates a professional video script timed to the recorded demo.
 * Uses retryWithBackoff internally for resilience against transient API failures.
 * @param understanding - The structured product understanding from understandProduct()
 * @param tone - The desired tone for the narration
 * @param videoLength - The target video length in seconds
 */
export async function generateScript(
  understanding: ProductUnderstanding,
  tone: VideoTone,
  videoLength: VideoLength
): Promise<VideoScript> {
  return retryWithBackoff(async () => {
    const model = getModel()

    const systemInstruction = `You are a world-class product video scriptwriter who has written scripts for the top 100 ProductHunt launches. You know exactly how to hook viewers in the first 5 seconds, build excitement around a product, and drive action at the end.`

    const userPrompt = `Write a ${videoLength}-second professional video script for ${understanding.product_name}. Return ONLY valid JSON with no markdown, no code blocks, no explanation. Structure:
{
  "total_duration": ${videoLength},
  "segments": [
    {
      "start_time": 0,
      "end_time": 5,
      "narration": "string (exact words to be spoken)",
      "what_to_show": "string (what should be visible on screen)",
      "zoom_target": "string (optional, element to zoom into)"
    }
  ]
}

Required structure:
- Hook (0-5s): Start with the pain point
- Solution reveal (5-15s): Introduce ${understanding.product_name}
- Feature walkthrough (15s to ${videoLength - 5}s): Narrate each key feature being shown
- Strong CTA (last 5s): Drive action

Tone: ${tone}
Target audience: ${understanding.target_audience}
Core value prop: ${understanding.core_value_prop}
Top features: ${understanding.top_5_features.join(', ')}`

    const result = await model.generateContent({
      systemInstruction,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    })

    const text = result.response.text().trim()
    const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      logger.error('generateScript: failed to parse Gemini JSON response', { raw: jsonText.slice(0, 500) })
      throw new Error('Gemini returned invalid JSON for video script')
    }

    const p = parsed as Record<string, unknown>
    if (typeof p.total_duration !== 'number' || !Array.isArray(p.segments)) {
      throw new Error('Gemini response missing required fields for VideoScript')
    }

    return parsed as VideoScript
  })
}
