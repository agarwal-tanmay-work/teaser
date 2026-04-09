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
      "action": "navigate | click | scroll_down | scroll_up | wait | hover | type",
      "description": "string (what this step demonstrates to the viewer)",
      "element_to_click": "string (CSS selector, button text, or aria-label — required for click/hover/type)",
      "navigate_to": "string (full URL or relative path — required for navigate)",
      "type_text": "string (text to type — required for type action)"
    }
  ]
}

CRITICAL INSTRUCTIONS FOR demo_flow:
You MUST generate a demo_flow of 8 to 12 steps that shows a complete user journey through this product. Do not just scroll through the landing page. The demo must:
1. Start at the main URL
2. Click the primary CTA button (Sign up, Get started, Try free, or similar) to show the signup or onboarding
3. Navigate to the actual product dashboard or main feature area (not just the landing page)
4. Demonstrate at least 3 core product features by clicking into them
5. Show the product actually working, not just the marketing page

If the product requires login and no credentials were provided, navigate to the pricing page and feature pages instead of the dashboard. Never generate a demo_flow that only scrolls the landing page.

STEP GUIDELINES:
- Use "click" action for buttons, links, tabs, cards, menu items, toggles
- Use "hover" action for elements with hover effects, tooltips, dropdown menus
- Use "type" action for search bars, input fields, forms (provide type_text)
- Use "navigate" action to go to specific URLs/pages directly
- Use "scroll_down" to reveal content below the fold
- Use "scroll_up" to return to top
- Use "wait" after complex interactions to let animations/content load
- Make the flow feel like a REAL USER exploring the product naturally

ELEMENT TARGETING RULES (critical for automation reliability — follow exactly):
- element_to_click MUST be the VISIBLE TEXT shown on the button or link (e.g., "Get Started", "Sign Up Free", "Try for free", "Pricing", "Features")
- Do NOT use CSS class names (e.g., ".btn-cta", "#hero-button", ".nav-link") — these WILL fail
- Do NOT use HTML attributes like data-id or aria-hidden
- Keep element_to_click SHORT: 1–5 words that exactly match what the user sees on screen
- For navigation menu items: use the exact nav label ("Features", "Pricing", "About", "Docs", "Blog")
- For CTA buttons: use the button's visible text exactly as it appears ("Start free trial", "Get started free", "Book a demo")
- For form inputs: use the placeholder text ("Search...", "Enter your email", "Email address")
- If a button says "→" or uses an icon only, use its aria-label if visible, otherwise skip it

TIMING RULES:
- Always add a "wait" step immediately after every major CTA click (page loads, modals, animations need time)
- Always add a "wait" step right after each "navigate" step before interacting with the new page
- Aim for at least 15 steps total — more meaningful interactions = better product video
- Show the ACTUAL PRODUCT functionality, not just the marketing landing page
- If the product has a dashboard, interactive demo, pricing table, or feature showcase — go there and interact with it

Product URL: ${productUrl}
User description: ${description ?? 'Not provided'}
Scraped content:
${scrapedContent.slice(0, 12000)}`

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
The script must be precisely timed to align with a user demo of the product. Use the provided demo_flow to structure the segments.
For each segment, YOU MUST map the corresponding demo_flow step to the script segment. Extract the "what_to_show" field and derive the exact action from it.

Return ONLY valid JSON:
{
  "total_duration": ${videoLength},
  "segments": [
    {
      "start_time": 0,
      "end_time": 5,
      "narration": "exact words to speak",
      "what_to_show": "what appears on screen",
      "zoom_target": "optional element to zoom",
      "action": "navigate | click | scroll_down | scroll_up | wait",
      "element_to_click": "optional string from demo_flow",
      "navigate_to": "optional URL from demo_flow",
      "type_text": "optional text from demo_flow"
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
- Features: ${understanding.top_5_features.join(', ')}

Here is the exact demo_flow to follow for actions:
${JSON.stringify(understanding.demo_flow, null, 2)}`

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

