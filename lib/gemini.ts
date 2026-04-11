import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ProductUnderstanding, VideoScript, VideoTone, VideoLength, DemoStep, ScriptSegment } from '@/types'
import { retryWithBackoff } from '@/lib/utils'
import { logger } from '@/lib/logger'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')

const MODEL_CHAIN = ['gemini-2.5-flash', 'gemini-2.0-flash']

function getModel(modelName: string) {
  return genAI.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' })
}

async function generateWithFallback(
  systemInstruction: string,
  prompt: string
): Promise<string> {
  let lastError: Error | null = null

  for (const modelName of MODEL_CHAIN) {
    try {
      logger.info(`gemini: trying model ${modelName}`)
      const result = await retryWithBackoff(async () => {
        const model = getModel(modelName)
        const res = await model.generateContent({
          systemInstruction,
          contents: [{ role: 'user', parts: [{ text: prompt }] }]
        })
        return res.response.text().trim()
      })
      return result
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      logger.warn(`gemini: model ${modelName} failed`, { error: lastError.message })
    }
  }
  throw lastError ?? new Error('All Gemini models failed')
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

// ─── SYSTEM PROMPT: Product Understanding + Demo Flow ────────────────────────

const UNDERSTAND_SYSTEM_PROMPT = `You are an expert product analyst and demo video director. Your job is to analyze a product website and create a comprehensive product understanding plus an interactive demo flow that will be used to record a professional startup demo video.

CRITICAL RULES:
1. You MUST return valid JSON matching the exact schema below. No extra text.
2. For element_to_click: use the EXACT visible button/link text as it appears on the page (e.g. "Get Started", "Sign Up Free", "View Pricing"). NEVER use CSS selectors, class names, or IDs.
3. Generate 10-20 demo steps that showcase the product's key features and pages.
4. Ensure a continuous natural flow. Heavily prefer using "click" actions to navigate between pages. Use "navigate" primarily for the very first step.
5. ALWAYS visit at least 2 different pages (e.g. features page, pricing page) by clicking relevant links.
6. The narration for each step must describe what the viewer is SEEING on screen at that moment. Reference the product by its actual name.
7. NEVER include steps that navigate to login, signup, register, or auth pages.
8. NEVER include steps that scroll more than 3 times consecutively.
9. For "type" actions, use realistic example text that demonstrates the product (e.g. if it's a search bar, type a realistic query).
10. Follow this narrative arc:
    - Steps 1-2: Hook — show the landing page, introduce the problem the product solves
    - Steps 3-5: Introduction — navigate to features/product page, show core value
    - Steps 6-12: Feature demos — click through 3-5 key features, type in fields, hover over elements
    - Steps 13-15+: Closing — show pricing/testimonials, end with CTA

OUTPUT SCHEMA:
{
  "product_name": "string — the actual product name",
  "tagline": "string — the product's tagline or one-line description",
  "core_value_prop": "string — what makes this product uniquely valuable",
  "target_audience": "string — who this product is for",
  "top_5_features": ["feature1", "feature2", "feature3", "feature4", "feature5"],
  "brand_tone": "string — professional/playful/technical/friendly",
  "product_category": "string — e.g. project management, analytics, design tool",
  "problem_being_solved": "string — the pain point this product addresses",
  "key_pages_to_visit": ["url1", "url2"] — full URLs of important pages found on the site,
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
      "description": "Scroll to see the hero section features",
      "narration": "Right from the homepage, you can see how ProductName transforms your workflow."
    },
    {
      "step": 3,
      "action": "click",
      "description": "Click on Features in the navigation",
      "narration": "Let's dive into what makes ProductName powerful.",
      "element_to_click": "Features"
    },
    {
      "step": 4,
      "action": "type",
      "description": "Type a search query in the search bar",
      "narration": "Watch how fast ProductName finds exactly what you need.",
      "element_to_click": "Search",
      "type_text": "quarterly revenue report"
    }
  ]
}

ALLOWED ACTIONS:
- "navigate": Go to a URL. Requires "navigate_to" (full URL or relative path).
- "click": Click a button/link. Requires "element_to_click" (exact visible text on the button).
- "type": Click a field and type text. Requires "element_to_click" (field label/placeholder) + "type_text".
- "hover": Hover over an element. Requires "element_to_click".
- "scroll_down": Scroll the page down smoothly.
- "scroll_up": Scroll the page up smoothly.
- "wait": Pause for 3 seconds (use sparingly, only to let the viewer absorb what's on screen).`

// ─── SYSTEM PROMPT: Video Script Generation ──────────────────────────────────

const SCRIPT_SYSTEM_PROMPT = `You are a professional video script writer for SaaS startup demo videos. Given a product understanding with its demo flow, generate a timed video script.

CRITICAL RULES:
1. Return valid JSON matching the exact schema below. No extra text.
2. Each segment corresponds to one demo step. The number of segments MUST match the number of demo_flow steps.
3. Each segment's narration should describe what the viewer sees on screen at that moment.
4. Reference the product by its actual name — never say "this product" or "the tool".
5. Use the narration from the demo_flow steps as a strong starting point, but make them flow together as a cohesive script.
6. Timing: allocate 3-6 seconds per step. Click/type steps get 4-5s. Navigate steps get 5-6s. Scroll/wait get 3-4s.
7. Follow this narrative arc:
   - Opening (first 2 segments): Hook the viewer with the problem, introduce the product
   - Middle (3-8 segments): Demonstrate key features with specific, compelling narration
   - Closing (last 2 segments): Social proof, call to action

OUTPUT SCHEMA:
{
  "total_duration": 60,
  "segments": [
    {
      "start_time": 0,
      "end_time": 5,
      "narration": "What the voiceover says during this segment",
      "what_to_show": "Brief description of what's visible on screen"
    }
  ]
}

// ─── SYSTEM PROMPT: Dynamic Page Analysis ────────────────────────────────────

const ANALYZE_PAGE_SYSTEM_PROMPT = `You are a real-time web interaction auditor. Your job is to analyze the current state of a web page (after a navigation or action) and determine where the target elements for the next demo steps are located.

CRITICAL RULES:
1. You MUST return valid JSON.
2. Analyze the provided "PAGE SNAPSHOT" (which is a simplified representation of the DOM).
3. Identify the EXACT visible text of buttons, links, or fields that correspond to the requested interactive goals.
4. If the page doesn't look like what was expected, provide a "correction" field.

OUTPUT SCHEMA:
{
  "page_context": "string — brief description of what page we are on (e.g. 'Dashboard', 'Settings')",
  "is_target_ready": boolean,
  "corrections": [
    {
       "step_index": number,
       "new_element_text": "string — the actual text found on page",
       "explanation": "string — why this correction was made"
    }
  ],
  "suggested_actions": ["array of strings — fallback actions if the plan is stuck"]
}`

// ─── Repair Functions ────────────────────────────────────────────────────────

function repairDemoStep(s: any, i: number, productUrl: string): DemoStep {
  if (typeof s === 'string') {
    return {
      step: i + 1,
      action: i === 0 ? 'navigate' : 'wait',
      description: s,
      narration: s,
      navigate_to: i === 0 ? productUrl : undefined
    }
  }
  return {
    step: s.step ?? i + 1,
    action: s.action || (i === 0 ? 'navigate' : 'wait'),
    description: s.description || s.text || 'Continue walkthrough',
    narration: s.narration || s.description || 'Exploring the product.',
    element_to_click: s.element_to_click || s.target || undefined,
    navigate_to: s.navigate_to || (i === 0 ? productUrl : undefined),
    type_text: s.type_text || undefined
  }
}

/**
 * Hyper-flexible repair function for product data.
 * Ensures the pipeline proceeds even if Gemini returns a non-standard structure.
 */
function repairProductUnderstanding(raw: any, url: string): ProductUnderstanding {
  const p = raw || {}

  const repaired: ProductUnderstanding = {
    product_name: p.product_name || p.name || 'Product Demo',
    tagline: p.tagline || p.description || 'A revolutionary new tool.',
    core_value_prop: p.core_value_prop || p.value_prop || 'Innovative solution.',
    target_audience: p.target_audience || 'Professionals',
    top_5_features: Array.isArray(p.top_5_features) ? p.top_5_features : ['Easy to use', 'Fast', 'Reliable'],
    brand_tone: p.brand_tone || 'professional',
    product_category: p.product_category || 'software',
    problem_being_solved: p.problem_being_solved || 'inefficiency',
    key_pages_to_visit: Array.isArray(p.key_pages_to_visit) ? p.key_pages_to_visit : [],
    demo_flow: []
  }

  // Repair demo flow
  const rawFlow = p.demo_flow || p.steps || p.flow || p.plan || []
  if (Array.isArray(rawFlow) && rawFlow.length > 0) {
    repaired.demo_flow = rawFlow.map((s: any, i: number) => repairDemoStep(s, i, url))
  } else {
    // Fallback flow if Gemini totally failed
    repaired.demo_flow = [
      { step: 1, action: 'navigate', description: 'Open the landing page', narration: `Welcome to ${repaired.product_name}.`, navigate_to: url },
      { step: 2, action: 'scroll_down', description: 'Explore the hero section', narration: `${repaired.product_name} helps you ${repaired.problem_being_solved}.` },
      { step: 3, action: 'scroll_down', description: 'View features section', narration: `Let's see what ${repaired.product_name} can do.` },
      { step: 4, action: 'wait', description: 'Reviewing the page', narration: `${repaired.product_name} — try it today.` }
    ]
  }

  return repaired
}

function repairScript(raw: any, understanding: ProductUnderstanding, videoLength: number): VideoScript {
  const segments: ScriptSegment[] = []

  if (raw && Array.isArray(raw.segments) && raw.segments.length > 0) {
    for (const seg of raw.segments) {
      segments.push({
        start_time: seg.start_time ?? 0,
        end_time: seg.end_time ?? 5,
        narration: seg.narration || '',
        what_to_show: seg.what_to_show || '',
        action: seg.action || 'wait',
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
    total_duration: raw?.total_duration || videoLength,
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

VIDEO LENGTH: ${videoLength} seconds (plan approximately ${Math.floor(videoLength / 4)} demo steps)
${descriptionBlock}

SCRAPED WEBSITE CONTENT:
${scrapedContent.slice(0, 20000)}

Remember:
- Use the EXACT visible button/link text for element_to_click
- Generate 10-${Math.floor(videoLength / 4)} demo steps
- Include clicks, typing, navigation to different pages
- Each step needs a "narration" field describing what the viewer sees
- Follow the narrative arc: Hook → Intro → Feature demos → CTA
- Return ONLY valid JSON, no markdown fences`

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
- Return ONLY valid JSON, no markdown fences`

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

export async function analyzePageState(
  pageUrl: string,
  pageSnapshot: string,
  upcomingSteps: DemoStep[]
): Promise<any> {
  const prompt = `Analyze this page snapshot and help the demo recorder find the next elements.

CURRENT URL: ${pageUrl}

UPCOMING DEMO STEPS:
${JSON.stringify(upcomingSteps, null, 2)}

PAGE SNAPSHOT (Simplified DOM):
${pageSnapshot.slice(0, 10000)}

Return JSON identifying if the elements for the next steps are visible and if any text/label corrections are needed.`

  const text = await generateWithFallback(ANALYZE_PAGE_SYSTEM_PROMPT, prompt)
  const jsonText = extractJson(text)
  
  try {
    return JSON.parse(jsonText.replace(/\\n/g, ' '))
  } catch (err) {
    logger.warn('analyzePageState: parse failed', { error: err })
    return { is_target_ready: true, corrections: [] }
  }
}
