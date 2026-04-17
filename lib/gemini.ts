import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ProductUnderstanding, VideoScript, VideoTone, VideoLength, DemoStep, ScriptSegment } from '@/types'
import { retryWithBackoff } from '@/lib/utils'
import { logger } from '@/lib/logger'

if (!process.env.GEMINI_API_KEY) {
  logger.error('gemini: GEMINI_API_KEY is not set — all Gemini calls will fail')
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')

/** Models tried in order. On quota exhaustion (limit: 0), skips immediately to next. */
const MODEL_CHAIN = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash', 'gemini-2.0-flash']

function getModel(modelName: string) {
  return genAI.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' })
}

/**
 * Races a promise against a timeout. Rejects with a descriptive error if the timeout fires first.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ])
}

/**
 * Returns true when the error is a daily/monthly quota exhaustion (limit: 0).
 * In this case retrying the same model is pointless — skip to the next model immediately.
 */
function isQuotaExhausted(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  // Gemini surfaces "limit: 0" when the daily free-tier quota is fully used up
  return msg.includes('limit: 0')
}

/**
 * Calls Gemini with automatic model fallback and retry.
 * - On rate-limit (429, temporary): retries with backoff honoring the retry-after hint
 * - On quota exhaustion (limit: 0, daily cap hit): skips directly to next model — no retries
 * Each model attempt is wrapped with a 90-second timeout.
 */
async function generateWithFallback(
  systemInstruction: string,
  prompt: string
): Promise<string> {
  let lastError: Error | null = null

  for (const modelName of MODEL_CHAIN) {
    try {
      logger.info(`gemini: trying model ${modelName}`)
      const result = await retryWithBackoff(
        async () => {
          const model = getModel(modelName)
          const res = await withTimeout(
            model.generateContent({
              systemInstruction,
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
            }),
            90_000,
            `gemini:${modelName}`
          )
          return res.response.text().trim()
        },
        3,                    // max 3 attempts per model (not 5)
        (err) => {
          // Skip all remaining retries for this model if daily quota is gone
          if (isQuotaExhausted(err)) {
            logger.warn(`gemini: ${modelName} daily quota exhausted — skipping to next model`)
            return true // signal: abort retries
          }
          return false
        }
      )
      return result
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      logger.warn(`gemini: model ${modelName} failed`, { error: lastError.message.slice(0, 200) })
    }
  }
  throw new Error(
    `All Gemini models are unavailable (quota exhausted or API error). ` +
    `Original error: ${lastError?.message?.slice(0, 300) ?? 'unknown'}`
  )
}

function extractJson(text: string): string {
  // Try to find JSON inside code fences first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()

  if (!text.includes('{')) return text
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1).trim()
  }
  return text.trim()
}

// ─── SYSTEM PROMPT: Product Understanding + Narrative Goals ──────────────────

const UNDERSTAND_SYSTEM_PROMPT = `You are an expert product analyst and demo video director. Your job is to analyze a product website and create a comprehensive product understanding plus a NAVIGATION-HEAVY interactive demo flow for recording a professional startup demo video.

CRITICAL RULES:
1. Return valid JSON matching the exact schema below. No extra text, no markdown fences.
2. For element_to_click: use the EXACT visible button/link text as it appears on the page (e.g. "Get Started", "Sign Up Free", "View Pricing"). NEVER use CSS selectors, class names, or IDs.
3. Generate 10-18 demo steps. AT LEAST 8 must be click, navigate, or type actions. MAX 2 scroll steps total — scrolls are filler, not content.
4. The demo MUST navigate AWAY from the homepage by step 3. Show the actual product interface, not just the marketing page.
5. MUST contain at least 4 distinct "navigate" steps, each pointing at a REAL FULL URL (starts with http:// or https://) found in the scraped content (features page, pricing, docs, dashboard, product page, blog, etc.). NEVER use in-page anchors like "#features" — they don't change the page.
6. NEVER include steps that navigate to login, signup, register, auth, or password-reset pages.
7. Each step's narration must describe what the viewer sees on screen. Reference the product by its actual name.
8. Follow this narrative arc:
   - Steps 1-2: Hook — landing page hero, establish the problem this product solves
   - Steps 3-6: Navigate INTO the product — features page, product page, dashboard, or pricing
   - Steps 7-14: Feature demos — click through 3-5 key features, type in search/input fields, hover over elements
   - Steps 15+: Closing — pricing or CTA page, end strong
9. For "type" actions, use realistic example text that demonstrates the product.
10. After every navigate, include 1-2 click/scroll steps on that page before the next navigate so the viewer sees what's on each page.

OUTPUT SCHEMA (return ONLY this JSON, nothing else):
{
  "product_name": "string",
  "tagline": "string",
  "core_value_prop": "string",
  "target_audience": "string",
  "top_5_features": ["feature1", "feature2", "feature3", "feature4", "feature5"],
  "brand_tone": "string",
  "product_category": "string",
  "problem_being_solved": "string",
  "key_pages_to_visit": ["full_url1", "full_url2"],
  "demo_flow": [
    {
      "step": 1,
      "action": "navigate",
      "description": "Open the landing page",
      "narration": "Meet ProductName — the easiest way to solve X.",
      "navigate_to": "https://example.com"
    },
    {
      "step": 2,
      "action": "scroll_down",
      "description": "Scroll to see the hero value proposition",
      "narration": "Right from the homepage, you can see how ProductName transforms your workflow."
    },
    {
      "step": 3,
      "action": "click",
      "description": "Click Features in the navigation to explore the product",
      "narration": "Let's dive into what makes ProductName powerful.",
      "element_to_click": "Features"
    },
    {
      "step": 4,
      "action": "navigate",
      "description": "Go to the product or app page",
      "narration": "Here is what you see when you open ProductName.",
      "navigate_to": "https://example.com/product"
    },
    {
      "step": 5,
      "action": "type",
      "description": "Type a search query in the search bar",
      "narration": "Watch how fast ProductName finds exactly what you need.",
      "element_to_click": "Search",
      "type_text": "quarterly revenue report"
    }
  ]
}

ALLOWED ACTIONS:
- "navigate": Go to a URL. Requires "navigate_to" (full URL from scraped content only).
- "click": Click a button/link. Requires "element_to_click" (exact visible text).
- "type": Click a field and type text. Requires "element_to_click" + "type_text".
- "hover": Hover over an element. Requires "element_to_click".
- "scroll_down": Scroll the page down. Use sparingly (max 3 total).
- "scroll_up": Scroll the page up. Use sparingly.
- "wait": Pause for 2 seconds (use only to let animations complete).`

// ─── SYSTEM PROMPT: Video Script Generation ──────────────────────────────────

const SCRIPT_SYSTEM_PROMPT = `You are a professional video script writer for SaaS startup demo videos. Given a product understanding with its demo flow, generate a timed video script.

CRITICAL RULES:
1. Return valid JSON matching the exact schema below. No extra text, no markdown fences.
2. Each segment corresponds to one demo step. The number of segments MUST match the number of demo_flow steps exactly.
3. Each segment's narration should describe what the viewer sees on screen at that moment.
4. Reference the product by its actual name — never say "this product" or "the tool".
5. Use the narration from the demo_flow steps as a strong starting point, but make them flow together as a cohesive script.
6. Timing: allocate 3-6 seconds per step. Click/type steps get 4-5s. Navigate steps get 5-6s. Scroll/wait get 3-4s.
7. Follow this narrative arc:
   - Opening (first 2 segments): Hook the viewer with the problem, introduce the product
   - Middle (3-8 segments): Demonstrate key features with specific, compelling narration
   - Closing (last 2 segments): Social proof, call to action

OUTPUT SCHEMA (return ONLY this JSON, nothing else):
{
  "total_duration": 60,
  "segments": [
    {
      "start_time": 0,
      "end_time": 5,
      "narration": "What the voiceover says during this segment",
      "what_to_show": "Brief description of what is visible on screen"
    }
  ]
}`

// ─── Repair Functions ────────────────────────────────────────────────────────

function repairDemoStep(s: unknown, i: number, productUrl: string): DemoStep {
  if (typeof s === 'string') {
    return {
      step: i + 1,
      action: i === 0 ? 'navigate' : 'wait',
      description: s,
      narration: s,
      navigate_to: i === 0 ? productUrl : undefined
    }
  }
  const step = s as Record<string, unknown>
  return {
    step: typeof step.step === 'number' ? step.step : i + 1,
    action: (typeof step.action === 'string' ? step.action : (i === 0 ? 'navigate' : 'wait')) as DemoStep['action'],
    description: typeof step.description === 'string' ? step.description : (typeof step.text === 'string' ? step.text : 'Continue walkthrough'),
    narration: typeof step.narration === 'string' ? step.narration : (typeof step.description === 'string' ? step.description : 'Exploring the product.'),
    element_to_click: typeof step.element_to_click === 'string' ? step.element_to_click : (typeof step.target === 'string' ? step.target : undefined),
    navigate_to: typeof step.navigate_to === 'string' ? step.navigate_to : (i === 0 ? productUrl : undefined),
    type_text: typeof step.type_text === 'string' ? step.type_text : undefined
  }
}

/**
 * Hyper-flexible repair function for product data.
 * Ensures the pipeline proceeds even if Gemini returns a non-standard structure.
 */
function repairProductUnderstanding(raw: unknown, url: string): ProductUnderstanding {
  const p = (raw as Record<string, unknown>) ?? {}

  const productName = (typeof p.product_name === 'string' ? p.product_name : null) ??
    (typeof p.name === 'string' ? p.name : null) ?? 'Product Demo'
  const problemSolved = (typeof p.problem_being_solved === 'string' ? p.problem_being_solved : null) ?? 'workflow inefficiency'

  const repaired: ProductUnderstanding = {
    product_name: productName,
    tagline: (typeof p.tagline === 'string' ? p.tagline : null) ?? (typeof p.description === 'string' ? p.description : null) ?? 'A revolutionary new tool.',
    core_value_prop: (typeof p.core_value_prop === 'string' ? p.core_value_prop : null) ?? (typeof p.value_prop === 'string' ? p.value_prop : null) ?? 'Innovative solution.',
    target_audience: (typeof p.target_audience === 'string' ? p.target_audience : null) ?? 'Professionals',
    top_5_features: Array.isArray(p.top_5_features) ? p.top_5_features as string[] : ['Easy to use', 'Fast', 'Reliable', 'Scalable', 'Secure'],
    brand_tone: (typeof p.brand_tone === 'string' ? p.brand_tone : null) ?? 'professional',
    product_category: (typeof p.product_category === 'string' ? p.product_category : null) ?? 'software',
    problem_being_solved: problemSolved,
    key_pages_to_visit: Array.isArray(p.key_pages_to_visit) ? p.key_pages_to_visit as string[] : [],
    demo_flow: []
  }

  // Repair demo flow
  const rawFlow = Array.isArray(p.demo_flow) ? p.demo_flow :
    (Array.isArray(p.steps) ? p.steps : (Array.isArray(p.flow) ? p.flow : (Array.isArray(p.plan) ? p.plan : [])))

  if (Array.isArray(rawFlow) && rawFlow.length > 0) {
    repaired.demo_flow = rawFlow.map((s: unknown, i: number) => repairDemoStep(s, i, url))

    // Strip demo_flow navigate steps whose target is an in-page anchor (#section) —
    // those don't actually change the page and lead to "stuck on landing page" output.
    const realNavigates = repaired.demo_flow.filter(
      (s) => s.action === 'navigate' && s.navigate_to?.startsWith('http') && !s.navigate_to.includes('#')
    )
    // Augment with key_pages_to_visit when Gemini only returned anchors or too-few navigates
    if (realNavigates.length < 3 && Array.isArray(p.key_pages_to_visit)) {
      const keyPages = (p.key_pages_to_visit as unknown[])
        .filter((u): u is string => typeof u === 'string' && u.startsWith('http') && !u.includes('#'))
        .slice(0, 5)
      const existingUrls = new Set(realNavigates.map((s) => s.navigate_to))
      for (const pageUrl of keyPages) {
        if (!existingUrls.has(pageUrl)) {
          repaired.demo_flow.push({
            step: repaired.demo_flow.length + 1,
            action: 'navigate',
            description: `Navigate to ${new URL(pageUrl).pathname}`,
            narration: `Let's look at ${productName} up close.`,
            navigate_to: pageUrl,
          })
        }
      }
    }
  } else {
    // Meaningful fallback flow — better than just scroll/wait
    repaired.demo_flow = [
      { step: 1, action: 'navigate', description: 'Open the product homepage', narration: `Introducing ${productName} — let's see what it can do.`, navigate_to: url },
      { step: 2, action: 'scroll_down', description: 'View the hero section and value proposition', narration: `${productName} solves ${problemSolved} for teams everywhere.` },
      { step: 3, action: 'scroll_down', description: 'Explore the key features section', narration: `Here are the core capabilities that make ${productName} stand out.` },
      { step: 4, action: 'scroll_down', description: 'View social proof and testimonials', narration: `Teams around the world trust ${productName} to get results.` },
      { step: 5, action: 'scroll_down', description: 'See the pricing and plans', narration: `Getting started with ${productName} is straightforward and affordable.` },
      { step: 6, action: 'scroll_up', description: 'Return to the top and CTA', narration: `${productName} — start your free trial today.` },
    ]
  }

  return repaired
}

function repairScript(raw: unknown, understanding: ProductUnderstanding, videoLength: number): VideoScript {
  const r = raw as Record<string, unknown> | null | undefined
  const segments: ScriptSegment[] = []

  if (r && Array.isArray(r.segments) && r.segments.length > 0) {
    for (const seg of r.segments as Record<string, unknown>[]) {
      segments.push({
        start_time: typeof seg.start_time === 'number' ? seg.start_time : 0,
        end_time: typeof seg.end_time === 'number' ? seg.end_time : 5,
        narration: typeof seg.narration === 'string' ? seg.narration : '',
        what_to_show: typeof seg.what_to_show === 'string' ? seg.what_to_show : '',
        action: (typeof seg.action === 'string' ? seg.action : 'wait') as ScriptSegment['action'],
      })
    }
  } else {
    // Build segments from demo_flow narrations as fallback
    const stepDuration = Math.floor(videoLength / Math.max(understanding.demo_flow.length, 1))
    let time = 0
    for (const step of understanding.demo_flow) {
      segments.push({
        start_time: time,
        end_time: time + stepDuration,
        narration: step.narration,
        what_to_show: step.description,
        action: step.action,
      })
      time += stepDuration
    }
  }

  return {
    total_duration: (typeof r?.total_duration === 'number' ? r.total_duration : null) ?? videoLength,
    segments
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function understandProduct(
  productUrl: string,
  scrapedContent: string,
  description?: string,
  videoLength: number = 60
): Promise<ProductUnderstanding> {
  const descriptionBlock = description
    ? `\n\nADDITIONAL CONTEXT FROM THE USER:\n${description}`
    : ''

  const prompt = `Analyze this product and create a comprehensive understanding + demo flow.

PRODUCT URL: ${productUrl}

VIDEO LENGTH: ${videoLength} seconds (plan approximately ${Math.floor(videoLength / 4)} demo steps, minimum 10)
${descriptionBlock}

SCRAPED WEBSITE CONTENT:
${scrapedContent.slice(0, 20000)}

Remember:
- Use EXACT visible button/link text for element_to_click (copy from the scraped content)
- For navigate_to: use real URLs found in the scraped content ONLY
- Generate AT LEAST 8 click/navigate/type steps — scrolls are filler
- Navigate AWAY from homepage by step 3 into the actual product
- Follow the narrative arc: Hook → Into the product → Feature demos → CTA
- Return ONLY valid JSON, nothing else`

  const text = await generateWithFallback(UNDERSTAND_SYSTEM_PROMPT, prompt)
  const jsonText = extractJson(text)

  try {
    const raw = JSON.parse(jsonText.replace(/\\n/g, ' '))
    return repairProductUnderstanding(raw, productUrl)
  } catch (err) {
    logger.warn('understandProduct: failed to parse JSON, using fallback repair', { error: err })
    return repairProductUnderstanding({}, productUrl)
  }
}

export async function generateScript(
  understanding: ProductUnderstanding,
  tone: VideoTone,
  videoLength: VideoLength
): Promise<VideoScript> {
  const prompt = `Write a ${videoLength}-second video script for the following product.

PRODUCT NAME: ${understanding.product_name}
TAGLINE: ${understanding.tagline}
CORE VALUE PROPOSITION: ${understanding.core_value_prop}
TARGET AUDIENCE: ${understanding.target_audience}
KEY FEATURES: ${understanding.top_5_features.join(', ')}
PROBLEM SOLVED: ${understanding.problem_being_solved}
PRODUCT CATEGORY: ${understanding.product_category}
TONE: ${tone}

DEMO FLOW (your script segments must match these steps 1:1):
${JSON.stringify(understanding.demo_flow.map(s => ({
    step: s.step,
    action: s.action,
    description: s.description,
    narration: s.narration
  })), null, 2)}

RULES:
- Generate exactly ${understanding.demo_flow.length} segments, one per demo step
- Total duration must be ${videoLength} seconds
- Each segment narration should expand on the corresponding demo step's narration
- Reference "${understanding.product_name}" by name
- Tone: ${tone}
- Return ONLY valid JSON, nothing else`

  const text = await generateWithFallback(SCRIPT_SYSTEM_PROMPT, prompt)
  const jsonText = extractJson(text)

  try {
    const raw = JSON.parse(jsonText.replace(/\\n/g, ' '))
    return repairScript(raw, understanding, videoLength)
  } catch (err) {
    logger.warn('generateScript: parse failed, building from demo_flow narrations', { error: err })
    return repairScript({}, understanding, videoLength)
  }
}

/**
 * Uses Gemini Vision to decide 3-6 actions for the page currently on screen.
 *
 * Architecture: click-driven navigation only. This function plans both in-page
 * interactions AND (optionally) one exit click on a visible nav link. It never
 * emits a "navigate" action with a guessed URL — the only way to reach a new
 * page is to click a link that Gemini sees in the screenshot.
 *
 * The plan should demonstrate the current page FIRST (scroll, click feature
 * cards, type in visible fields) before any navigation, so each page has
 * meaningful content in the final video.
 *
 * @param screenshotBase64 - JPEG screenshot of the current page as base64
 * @param pageUrl - Current URL (for context only)
 * @param productName - Product name for narration
 * @param understanding - Text understanding (for feature/audience context)
 * @param visitedUrls - URLs already visited this session — Gemini avoids linking back
 * @param allowNavigation - When false, the final plan must not include any click that leaves the page
 */
export async function planPageInteractions(
  screenshotBase64: string,
  pageUrl: string,
  productName: string,
  understanding: ProductUnderstanding,
  visitedUrls: string[],
  allowNavigation: boolean = true,
): Promise<DemoStep[]> {
  const visitedList = visitedUrls.length > 0
    ? `\nAlready visited (don't click links that go back to these): ${visitedUrls.slice(-5).join(', ')}`
    : ''

  const navRule = allowNavigation
    ? `6. You MAY include ONE final click on a visible nav link or CTA that leads to a different page — but ONLY after 2+ in-page interactions. This is how the video discovers subpages. Pick the most demo-worthy visible link (e.g. "Product", "Features", "Pricing", "Dashboard", "Try it", "Get started"). Skip links that go to already-visited URLs.`
    : `6. Do NOT click any link that navigates away from this page. Every action must keep the viewer on the current URL.`

  const prompt = `You are directing a professional SaaS startup demo video. Look at this live screenshot.

Product: ${productName}
Current URL: ${pageUrl}
Key features to highlight: ${understanding.top_5_features.slice(0, 5).join(', ')}${visitedList}

Generate 3-6 actions that demonstrate what's actually visible on THIS page, then optionally navigate to the next page by clicking a visible link.

STRATEGY per page type:
- Marketing/landing page: scroll to reveal more, hover/click a feature card to show detail, type in any visible search/demo field, THEN optionally click a nav link.
- Feature or product page: click into feature cards or tabs to show depth, type a realistic query if a demo field is visible, THEN optionally navigate on.
- Dashboard/app (authed): click a sidebar item, open a row or tab, type in a real input field to show the product in action.

CRITICAL RULES:
1. ONLY use "click", "scroll_down", "scroll_up", "type", or "hover" actions. NEVER "navigate" (the system handles navigation by clicking links you identify).
2. For EVERY click/type: element_to_click must be EXACT visible text from the screenshot. Read it character-for-character. Do not invent, translate, or paraphrase.
3. Only reference elements you can actually SEE in this screenshot. If you can't see something, don't mention it.
4. For "type": element_to_click is the visible field label or placeholder; type_text is a realistic example (e.g. "quarterly report", "acme corp").
5. Never click login / signup / register / auth / password / logout links.
${navRule}
7. MINIMUM 2 in-page interactions (scroll, click feature, type) BEFORE any navigation click. A video that just jumps between pages without showing anything is useless.
8. Each narration: 1 vivid sentence, naming "${productName}" when natural.

Return ONLY valid JSON (no markdown):
{"steps": [
  {"step": 1, "action": "scroll_down", "description": "Reveal the product showcase below the hero", "narration": "${productName} is designed to feel immediate."},
  {"step": 2, "action": "click", "description": "Open the automation feature card", "narration": "Here's how ${productName} automates the workflow.", "element_to_click": "Automated workflows"},
  {"step": 3, "action": "type", "description": "Try a realistic search query", "narration": "Finding anything takes seconds.", "element_to_click": "Search", "type_text": "quarterly revenue"},
  {"step": 4, "action": "click", "description": "Navigate to the pricing page via the top nav", "narration": "And the pricing is as simple as the product.", "element_to_click": "Pricing"}
]}`

  const visionModels = ['gemini-2.5-flash', 'gemini-1.5-flash']

  for (const visionModel of visionModels) {
    try {
      logger.info(`gemini: planPageInteractions via ${visionModel} for ${pageUrl}`)
      const model = genAI.getGenerativeModel({ model: visionModel }, { apiVersion: 'v1beta' })
      const res = await withTimeout(
        model.generateContent({
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: screenshotBase64 } },
              { text: prompt },
            ],
          }],
        }),
        30_000,
        `gemini:planPageInteractions:${visionModel}`
      )

      const text = res.response.text().trim()
      const jsonText = extractJson(text)
      const raw = JSON.parse(jsonText.replace(/\\n/g, ' ')) as Record<string, unknown>
      const stepsArray = Array.isArray(raw.steps) ? raw.steps : (Array.isArray(raw) ? raw : [])

      if (stepsArray.length === 0) {
        logger.warn(`planPageInteractions: ${visionModel} returned empty steps for ${pageUrl}`)
        continue
      }

      const steps = (stepsArray as unknown[])
        .map((s: unknown, i: number) => repairDemoStep(s, i, pageUrl))
        // Enforce no-navigate at application level (defense in depth vs. prompt adherence)
        .filter((s) => s.action !== 'navigate')
        .slice(0, 4)
      logger.info(`gemini: planPageInteractions: ${steps.length} in-page steps`)
      return steps
    } catch (err) {
      if (isQuotaExhausted(err)) {
        logger.warn(`planPageInteractions: ${visionModel} quota exhausted, trying next`)
        continue
      }
      logger.warn(`planPageInteractions: ${visionModel} failed`, { error: err })
    }
  }

  logger.warn('planPageInteractions: all vision models failed — no in-page actions for this page')
  return []
}

/**
 * Uses Gemini Vision to identify the exact visible text of a button, link, or field
 * on a screenshot that best matches the given description.
 *
 * This is called ONLY as a fallback when text-based element finding fails —
 * keeping Gemini API calls per video to a minimum.
 *
 * @param screenshotBase64 - JPEG screenshot as base64
 * @param description - What we're looking for (e.g. "the sign up button", "search field")
 * @param pageUrl - Current page URL for context
 * @returns The exact visible text to pass to findElement, or null if not found
 */
export async function identifyElementOnPage(
  screenshotBase64: string,
  description: string,
  pageUrl: string
): Promise<string | null> {
  const prompt = `Current page URL: ${pageUrl}

I need to interact with: "${description}"

Look at this screenshot and find the element that best matches the description.
Return the EXACT visible text of the button, link, or input field label/placeholder.
If it's a navigation link, return the exact menu text.
If you cannot find a matching element, return null.

Return ONLY valid JSON: {"element_text": "exact text here"} or {"element_text": null}`

  // Vision models to try in order (skip a model instantly if its quota is exhausted)
  const visionModels = ['gemini-2.5-flash', 'gemini-1.5-flash']

  for (const visionModel of visionModels) {
    try {
    const model = genAI.getGenerativeModel({ model: visionModel }, { apiVersion: 'v1beta' })
    const res = await withTimeout(
      model.generateContent({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: screenshotBase64 } },
            { text: prompt },
          ],
        }],
      }),
      30_000,
      `gemini-vision:${visionModel}`
    )

    const text = res.response.text().trim()
    const jsonText = extractJson(text)
    const raw = JSON.parse(jsonText.replace(/\\n/g, ' ')) as Record<string, unknown>
    const result = raw.element_text
    return typeof result === 'string' && result.length > 0 ? result : null
    } catch (err) {
      if (isQuotaExhausted(err)) {
        logger.warn(`identifyElementOnPage: ${visionModel} quota exhausted, trying next model`)
        continue
      }
      logger.warn(`identifyElementOnPage: ${visionModel} failed`, { error: err })
      return null
    }
  }

  logger.warn('identifyElementOnPage: all vision models exhausted')
  return null
}
