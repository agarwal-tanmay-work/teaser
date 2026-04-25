import type {
  ProductUnderstanding,
  VideoScript,
  VideoTone,
  VideoLength,
  DemoStep,
  ScriptSegment,
  InteractiveInventory,
  DomInventory,
} from '@/types'
import { logger } from '@/lib/logger'
import * as https from 'https'

if (!process.env.GEMINI_API_KEY) {
  logger.error('gemini: GEMINI_API_KEY is not set — all LLM calls will fail')
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ''
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

/** Models tried in order. On quota exhaustion (402) skip to next; on rate limit (429) wait and retry. */
const MODEL_CHAIN = [
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]
const VISION_MODEL_CHAIN = [
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]

interface GeminiTextResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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
 * Returns true when the error is a PERMANENT quota exhaustion (402 / daily limit gone).
 * In this case retrying the same model is pointless — skip to the next model immediately.
 * Note: 429 rate limits are NOT treated as exhaustion — they can be waited out.
 */
function isQuotaExhausted(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const lowerMsg = msg.toLowerCase()
  // True exhaustion: 402 or explicit "quota" wording (daily cap)
  if (lowerMsg.includes('402') || lowerMsg.includes('quota')) return true
  // Exclude 429 rate limits — those are temporary and should be retried
  return false
}

/**
 * Returns true when the error is a 429 rate limit (temporary — can be waited out).
 */
function isRateLimited(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('429') || msg.toLowerCase().includes('rate limit')
}

/**
 * Parses the retry delay from a Groq 429 error. Returns ms to wait, or 35000 default.
 */
function parseGeminiRetryDelay(): number {
  return 35_000 // default 35s wait for rate limits for Gemini
}

async function httpsPost<TResponse>(urlStr: string, payload: unknown): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr)
    const data = JSON.stringify(payload)
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 120000 // 2 minutes
    }

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (chunk) => body += chunk)
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`API Error: ${res.statusCode} ${res.statusMessage} - ${body}`))
        } else {
          try {
            resolve(JSON.parse(body) as TResponse)
          } catch {
            reject(new Error(`Invalid JSON response: ${body.substring(0, 100)}`))
          }
        }
      })
    })

    req.on('error', (e) => reject(e))
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })

    req.write(data)
    req.end()
  })
}

async function callGemini(modelName: string, systemInstruction: string, prompt: string): Promise<string> {
  const url = `${GEMINI_BASE_URL}/${modelName}:generateContent?key=${GEMINI_API_KEY}`

  const textPayload = systemInstruction
    ? `SYSTEM INSTRUCTION:\n${systemInstruction}\n\nUSER PROMPT:\n${prompt}`
    : prompt

  try {
    const data = await httpsPost<GeminiTextResponse>(url, {
      contents: [{
        role: "user",
        parts: [{ text: textPayload }]
      }]
    })
    return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  } catch (err: unknown) {
    throw new Error(`Gemini API error: ${errorMessage(err)}`)
  }
}

async function callGeminiVision(modelName: string, prompt: string, screenshotBase64: string): Promise<string> {
  const url = `${GEMINI_BASE_URL}/${modelName}:generateContent?key=${GEMINI_API_KEY}`

  try {
    const data = await httpsPost<GeminiTextResponse>(url, {
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "image/jpeg", data: screenshotBase64 } }
        ]
      }]
    })
    return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  } catch (err: unknown) {
    throw new Error(`Gemini Vision API error: ${errorMessage(err)}`)
  }
}

/**
 * Calls Gemini with automatic model fallback and retry.
 */
async function generateWithFallback(
  systemInstruction: string,
  prompt: string
): Promise<string> {
  let lastError: Error | null = null

  for (const modelName of MODEL_CHAIN) {
    // Try each model up to 3 times, with special handling for rate limits
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        logger.info(`gemini: trying model ${modelName} (attempt ${attempt + 1}/3)`)
        const result = await withTimeout(
          callGemini(modelName, systemInstruction, prompt),
          90_000,
          `gemini:${modelName}`
        )
        return result
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        // True quota exhaustion (402 / daily cap) — skip to next model immediately
        if (isQuotaExhausted(err)) {
          logger.warn(`gemini: ${modelName} quota exhausted — skipping to next model`)
          break
        }

        // Rate limited (429) — wait for the retry period, then retry SAME model
        if (isRateLimited(err)) {
          const waitMs = parseGeminiRetryDelay()
          logger.info(`gemini: ${modelName} rate limited — waiting ${Math.round(waitMs / 1000)}s before retry`)
          await new Promise(resolve => setTimeout(resolve, waitMs))
          continue // retry same model
        }

        // Other error — log and try next model
        logger.warn(`gemini: model ${modelName} failed`, { error: lastError.message.slice(0, 200) })
        break
      }
    }
  }

  throw new Error(
    `All LLM models are unavailable (quota exhausted or API error). ` +
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
2. For element_to_click: you MUST use text EXACTLY as it appears in the VERIFIED INTERACTIVE ELEMENTS list below. Pick from that list. Do NOT invent, paraphrase, or guess button/link text. If the list doesn't contain an element you want to click, DO NOT include that step.
3. Generate 15-25 demo steps. AT LEAST 10 must be click, navigate, or type actions. MAX 3 scroll steps total — scrolls are filler, not content.
4. The demo MUST navigate AWAY from the homepage by step 3. Show the actual product interface, not just the marketing page.
5. MUST contain at least 3 distinct "navigate" steps, each pointing at a URL from the VERIFIED SUBPAGES list below. NEVER invent URLs. NEVER use in-page anchors like "#features".
6. NEVER include steps that navigate to login, signup, register, auth, or password-reset pages.
7. Each step's narration must describe what the viewer sees on screen. Reference the product by its actual name.
8. Follow this narrative arc:
   - Steps 1-2: Hook — landing page hero, establish the problem this product solves
   - Steps 3-6: Navigate INTO the product — features page, product page, dashboard, or pricing
   - Steps 7-14: Feature demos — click through 3-5 key features, type in search/input fields, hover over elements
   - Steps 15+: Closing — pricing or CTA page, end strong
9. For "type" actions: element_to_click must be an input field label/placeholder from the VERIFIED INTERACTIVE ELEMENTS list. Use realistic example text that demonstrates the product.
10. After every navigate, include 1-2 click/hover/scroll steps on that page before the next navigate so the viewer sees what's on each page.
11. PREFER click-based navigation over navigate actions when a nav link exists in the verified elements. Clicking a visible link produces a more natural demo than a hard page load.

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
- "navigate": Go to a URL. Requires "navigate_to" (MUST be from the VERIFIED SUBPAGES list).
- "click": Click a button/link. Requires "element_to_click" (MUST be from VERIFIED INTERACTIVE ELEMENTS).
- "type": Click a field and type text. Requires "element_to_click" (MUST be an input from VERIFIED INTERACTIVE ELEMENTS) + "type_text".
- "hover": Hover over an element. Requires "element_to_click" (MUST be from VERIFIED INTERACTIVE ELEMENTS).
- "scroll_down": Scroll the page down. Use sparingly (max 2 total).
- "scroll_up": Scroll the page up. Use sparingly.
- "wait": Pause for 2 seconds (use only to let animations complete).`

// ─── SYSTEM PROMPT: Video Script Generation ──────────────────────────────────

const SCRIPT_SYSTEM_PROMPT = `You are a top-tier scriptwriter for Product Hunt launch videos. You write the on-screen captions for 2–3 minute silent-friendly demo videos that the viewer WATCHES, not listens to — every line appears as bold karaoke-style captions while the product is shown.

YOUR JOB: Turn a product understanding + demo flow into punchy, concrete, specific caption copy that makes a scroller stop scrolling.

━━━ NON-NEGOTIABLE NARRATIVE ARC ━━━
Segment 1 (0-3s): HOOK. A provocative question, a bold claim, or a "what if" framing. Must create a pattern-break in the first 2 seconds. Examples that work: "Your team wastes 3 hours a week on status updates." "What if writing SQL felt like talking?" NEVER open with "Introducing X" or "Meet X".
Segments 2-3: PROBLEM. Name the specific pain with concrete data or a vivid scene. Not "teams struggle with productivity" — "47% of a dev's week is meetings about meetings."
Segments 4 through (N-2): PRODUCT IN ACTION. One feature per segment, each line sells the OUTCOME not the feature. "Drag a Figma frame in. Ship a component." beats "Figma integration available." Reference real capabilities from the scraped content.
Segment N-1: PROOF or CATEGORY STATEMENT. Specific customer type, number, or outcome. "Shipping at 40 teams including Linear and Arc." or "This replaces 4 tools in your stack."
Segment N (last 2-3s): CTA. Short, urgent, directive. "Try it free — link below." or "Built for teams. Yours today."

━━━ BANNED PHRASES (reject every one of these) ━━━
"unlock productivity" · "streamline your workflow" · "powerful platform" · "seamless experience" · "revolutionary" · "game-changing" · "next-generation" · "cutting-edge" · "best-in-class" · "world-class" · "robust solution" · "empowers teams" · "takes it to the next level" · "unleash the power" · "supercharge" · "effortlessly" · "at your fingertips" · "the future of X" · "one-stop-shop" · "AI-powered" (unless the product genuinely is — and even then, say what the AI DOES, not that it exists)

If your draft contains any of these, REWRITE it with a specific, concrete claim drawn from the scraped product content.

━━━ CAPTION CRAFT RULES ━━━
- Each narration is ONE sentence, 6–14 words. Short. Declarative. Scanable in 2 seconds.
- Write in present tense, active voice, second person ("your team", "you ship") or imperative ("drop a link", "hit send").
- Numbers, names, and concrete nouns beat adjectives. "40 teams" > "many teams". "8 clicks" > "quickly".
- Use **double asterisks** around the 1–2 words per segment that should POP. These render as amber + slight scale-up in the karaoke layer. Pick words that carry the meaning — verbs and numbers, not filler. Example: "Ship **10x** faster without **yak shaving**."
- One emphasis pair per segment max. Don't bold entire phrases.
- Reference the product by its actual name at least twice across the whole script (once in hook area, once in outro). Never say "this product", "this tool", "the platform".
- Do NOT narrate what's happening on screen ("now we click here", "as you can see"). The video SHOWS that. The caption DELIVERS the value claim.

━━━ TECHNICAL RULES ━━━
1. Return valid JSON matching the exact schema below. No extra text, no markdown fences.
2. Number of segments MUST exactly equal the number of demo_flow steps. Each segment i maps to demo_flow step i+1.
3. Timing: allocate the full requested duration across the exact number of steps. For longer demos, 6–12 seconds per segment is fine. Click/type/navigate steps should usually get more time than scroll/wait steps. Segments must be contiguous (each start_time equals the previous end_time).
4. "what_to_show" briefly describes what's visible on screen during this segment — this is an internal hint, not shown to the viewer.

OUTPUT SCHEMA (return ONLY this JSON, nothing else):
{
  "total_duration": 60,
  "segments": [
    {
      "start_time": 0,
      "end_time": 5,
      "narration": "Ship **10x** faster without yak shaving.",
      "what_to_show": "Hero of product landing page"
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
  videoLength: number = 60,
  features?: string,
  siteMap: string[] = [],
  inventory?: InteractiveInventory,
): Promise<ProductUnderstanding> {
  const userContextParts: string[] = []
  if (description) userContextParts.push(`Product description: ${description}`)
  if (features) userContextParts.push(`Key features/flows the user specifically wants shown: ${features}`)
  const descriptionBlock = userContextParts.length
    ? `\n\nADDITIONAL CONTEXT FROM THE USER (prioritise these instructions):\n${userContextParts.join('\n\n')}`
    : ''

  // Build the verified subpage URLs block — combine siteMap with inventory subpages
  const allSubpages = new Set<string>(siteMap)
  if (inventory) {
    for (const sp of inventory.subpages) allSubpages.add(sp)
  }
  const subpageList = Array.from(allSubpages).slice(0, 40)
  const siteMapBlock = subpageList.length > 1
    ? `\n\nVERIFIED SUBPAGE URLS (use ONLY these for navigate_to steps — do NOT invent URLs):\n${subpageList.map((u) => `- ${u}`).join('\n')}`
    : ''

  // Build the verified interactive elements block
  let interactiveBlock = ''
  if (inventory && inventory.elements.length > 0) {
    const linkElements = inventory.elements
      .filter((e) => e.role === 'link')
      .slice(0, 50)
      .map((e) => `  - "${e.text}"${e.href ? ` → ${e.href}` : ''}`)
    const buttonElements = inventory.elements
      .filter((e) => e.role === 'button')
      .slice(0, 30)
      .map((e) => `  - "${e.text}"`)
    const inputElements = inventory.elements
      .filter((e) => e.role === 'input')
      .slice(0, 15)
      .map((e) => `  - "${e.text}"`)

    interactiveBlock = `\n\n━━━ VERIFIED INTERACTIVE ELEMENTS (use ONLY these for element_to_click) ━━━
Navigation links (clickable, use exact text for element_to_click with action "click"):
${linkElements.join('\n')}

Buttons (clickable, use exact text):
${buttonElements.join('\n')}

Input fields (use exact placeholder/label for element_to_click with action "type"):
${inputElements.join('\n')}

⚠️ CRITICAL: Every element_to_click value in your demo_flow MUST be copied character-for-character from the lists above. If you need an element that's not listed, use a "scroll_down" or "navigate" instead — never invent element text.`
  }

  const prompt = `Analyze this product and create a comprehensive understanding + demo flow.

PRODUCT URL: ${productUrl}

VIDEO LENGTH: ${videoLength} seconds (create a strong 15-25 step seed flow; the browser recorder will extend it live to the full duration)
${descriptionBlock}${siteMapBlock}${interactiveBlock}

SCRAPED WEBSITE CONTENT:
${scrapedContent.slice(0, 12000)}

Remember:
- For element_to_click: COPY the exact text from the VERIFIED INTERACTIVE ELEMENTS list above. Do NOT invent, paraphrase, or abbreviate.
- For navigate_to: COPY a URL from the VERIFIED SUBPAGE URLS list above. Do NOT invent URLs.
- PREFER clicking a navigation link (action: "click") over action: "navigate" when the link text exists in the verified elements. Clicking looks more natural in the demo.
- Generate AT LEAST 10 click/navigate/type steps — scrolls are filler, not content
- Navigate AWAY from homepage by step 3 into the actual product
- Visit at least 3 different subpages to show the product depth
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
  const prompt = `Write a ${videoLength}-second silent-friendly launch video script for the following product, following the Product Hunt narrative arc (HOOK → PROBLEM → PRODUCT IN ACTION → PROOF → CTA).

PRODUCT NAME: ${understanding.product_name}
TAGLINE: ${understanding.tagline}
CORE VALUE PROPOSITION: ${understanding.core_value_prop}
TARGET AUDIENCE: ${understanding.target_audience}
KEY FEATURES: ${understanding.top_5_features.join(', ')}
PROBLEM SOLVED: ${understanding.problem_being_solved}
PRODUCT CATEGORY: ${understanding.product_category}
TONE: ${tone}

DEMO FLOW (your script MUST produce exactly ${understanding.demo_flow.length} segments, one per step, in this order):
${JSON.stringify(understanding.demo_flow.map(s => ({
    step: s.step,
    action: s.action,
    description: s.description,
    narration: s.narration
  })), null, 2)}

REQUIREMENTS:
- Exactly ${understanding.demo_flow.length} segments. Total duration must equal ${videoLength} seconds. Segments must be contiguous.
- Segment 1 is the HOOK — provocative, never "Introducing ${understanding.product_name}". Grab attention in the first 2 seconds.
- Segments 2–3 establish the PROBLEM with concrete specifics (numbers, named pain, vivid scene).
- Middle segments show the product in action — one OUTCOME per caption, not feature lists. Draw details from the product description above (real capabilities, real names).
- Second-to-last segment is PROOF or a category-defining claim.
- Final segment is a short, directive CTA.
- Each narration is ONE sentence, 6–14 words.
- Use **double asterisks** around 1–2 emphasis words per segment (these render amber in captions). Pick verbs and numbers, not filler. Max one emphasis pair per segment.
- Use "${understanding.product_name}" by name at least twice across the script.
- Forbidden: "unlock productivity", "streamline workflow", "powerful platform", "seamless experience", "revolutionary", "game-changing", "empowers teams", "supercharge", "effortlessly", generic adjective-heavy filler. If your draft contains any, rewrite with a concrete claim from the product info above.
- Return ONLY valid JSON, nothing else.`

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
  inventory?: DomInventory,
  rejectionHint?: string,
): Promise<DemoStep[]> {
  const visitedList = visitedUrls.length > 0
    ? `\nAlready visited (don't click links that go back to these): ${visitedUrls.slice(-5).join(', ')}`
    : ''

  const navRule = allowNavigation
    ? `6. You MAY include ONE final click on a visible nav link or CTA that leads to a different page — but ONLY after 2+ in-page interactions. This is how the video discovers subpages. Pick the most demo-worthy visible link (e.g. "Product", "Features", "Pricing", "Dashboard", "Try it", "Get started"). Skip links that go to already-visited URLs.`
    : `6. Do NOT click any link that navigates away from this page. Every action must keep the viewer on the current URL.`

  const inventoryBlock = inventory && inventory.items.length > 0
    ? `\n\nLIVE DOM INVENTORY (these elements ARE on the page right now — strongly prefer interacting with these):
- Counts: ${inventory.buttonCount} buttons, ${inventory.linkCount} links, ${inventory.inputCount} inputs, ${inventory.searchCount} search fields.
${inventory.primaryCta ? `- Primary CTA visible: "${inventory.primaryCta.text}" (${inventory.primaryCta.kind}).\n` : ''}- Available elements (use these EXACT strings for element_to_click):
${inventory.items.map((it) => `  • ${it.kind}: "${it.text}"`).join('\n')}

ADAPTIVE STRATEGY based on the inventory above:
- If a search field exists → type a realistic query into it (the most demo-worthy interaction).
- If text inputs exist → type a realistic example showing what users would actually enter.
- If a primary CTA exists → click it (it's the most important button on the page).
- If buttons exist but no inputs → click 2-3 of the most informative buttons.
- If only marketing copy is visible (no real interactives) → 1 scroll then move on, do NOT linger.`
    : `\n\nNo DOM inventory available — read the screenshot carefully and pick interactions that are visibly clickable or typeable.`

  const rejectBlock = rejectionHint ? `\n\n⚠ FEEDBACK FROM PREVIOUS ATTEMPT: ${rejectionHint}\nChoose interactions that demonstrate the product, not just scroll. Type into a real input or click a real button this time.` : ''

  const prompt = `You are directing a professional SaaS startup demo video. Look at this live screenshot.

Product: ${productName}
Current URL: ${pageUrl}
Key features to highlight: ${understanding.top_5_features.slice(0, 5).join(', ')}${visitedList}${inventoryBlock}${rejectBlock}

Generate 3-6 actions that demonstrate what's actually visible on THIS page. Match the action mix to what the page actually offers — do not force interactions that aren't there, but do not default to scrolling when real interactions ARE available.

CRITICAL RULES:
1. ONLY use "click", "scroll_down", "scroll_up", "type", or "hover" actions. NEVER "navigate" (the system handles navigation by clicking links you identify).
2. For EVERY click/type: element_to_click must be EXACT visible text. Prefer text from the LIVE DOM INVENTORY above. Do not invent, translate, or paraphrase.
3. Only reference elements you can actually SEE or that appear in the inventory.
4. For "type": element_to_click is the field label/placeholder; type_text is a realistic example tied to the product (e.g. for a search bar on an analytics tool: "Q3 revenue by region").
5. Never click login / signup / register / auth / password / logout links — but DO click "Try it free", "Get started", "See demo", primary CTAs that don't gate behind credentials.
${navRule}
7. Prefer click/type over scroll when both are possible. A demo of an interactive product should show interaction, not just scrolling marketing copy. If the page genuinely has nothing interactive (pure marketing), one scroll is fine — but only one.
8. Each narration: 1 vivid sentence, 6-12 words, naming "${productName}" when natural. Describe the OUTCOME of the interaction, not the mechanics.

Return ONLY valid JSON (no markdown):
{"steps": [
  {"step": 1, "action": "type", "description": "Type a realistic query into the search field", "narration": "Finding insights in ${productName} takes seconds.", "element_to_click": "Search", "type_text": "quarterly revenue"},
  {"step": 2, "action": "click", "description": "Open the automation feature card", "narration": "Here's how ${productName} automates the workflow.", "element_to_click": "Automated workflows"},
  {"step": 3, "action": "click", "description": "Click the primary CTA", "narration": "Getting started with ${productName} takes one click.", "element_to_click": "Try it free"}
]}`

  const visionModels = VISION_MODEL_CHAIN

  for (const visionModel of visionModels) {
    try {
      logger.info(`gemini: planPageInteractions via ${visionModel} for ${pageUrl}`)

      const text = await withTimeout(
        callGeminiVision(visionModel, prompt, screenshotBase64),
        30_000,
        `gemini:planPageInteractions:${visionModel}`
      )
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
        .slice(0, 6)
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

  logger.warn('planPageInteractions: all vision models failed — emitting inventory-driven fallback')
  return inventoryDrivenFallback(inventory, productName)
}

/**
 * Deterministic fallback when Gemini Vision is fully unavailable. Picks the
 * most demo-worthy interaction available from the live DOM inventory:
 *   1. Type into a search field if one is visible.
 *   2. Click the primary CTA if one was detected.
 *   3. Click the first input field (might be email capture).
 *   4. Click the first button.
 *   5. Single scroll if literally nothing interactive is available.
 *
 * Always better than the old 3-scroll canned fallback because it shows real
 * interaction with whatever the page offers.
 */
function inventoryDrivenFallback(
  inventory: DomInventory | undefined,
  productName: string,
): DemoStep[] {
  if (!inventory || inventory.items.length === 0) {
    return [
      {
        step: 1,
        action: 'scroll_down',
        description: 'Scroll to reveal the product below the fold',
        narration: `Here's ${productName} in action.`,
      },
    ]
  }

  const search = inventory.items.find((it) => it.kind === 'search')
  if (search) {
    const seed = productName.split(' ')[0].toLowerCase()
    return [
      {
        step: 1,
        action: 'type',
        description: 'Type a realistic query into the search field',
        narration: `Search inside ${productName} is **instant**.`,
        element_to_click: search.text,
        type_text: `${seed} workflow`,
      },
    ]
  }

  if (inventory.primaryCta) {
    return [
      {
        step: 1,
        action: 'click',
        description: `Click the primary CTA "${inventory.primaryCta.text}"`,
        narration: `Getting started with ${productName} is **one click**.`,
        element_to_click: inventory.primaryCta.text,
      },
    ]
  }

  const input = inventory.items.find((it) => it.kind === 'input')
  if (input) {
    return [
      {
        step: 1,
        action: 'type',
        description: 'Type a realistic value into the visible field',
        narration: `${productName} keeps inputs **simple**.`,
        element_to_click: input.text,
        type_text: input.inputType === 'email' ? 'demo@example.com' : `Try ${productName}`,
      },
    ]
  }

  const button = inventory.items.find((it) => it.kind === 'button')
  if (button) {
    return [
      {
        step: 1,
        action: 'click',
        description: `Click the "${button.text}" button`,
        narration: `Inside ${productName} every action is **direct**.`,
        element_to_click: button.text,
      },
    ]
  }

  return [
    {
      step: 1,
      action: 'scroll_down',
      description: 'Scroll to reveal more of the page',
      narration: `Here's more of ${productName}.`,
    },
  ]
}

/**
 * Per-clip vision-based caption rewrite. After recording, every scene gets
 * its narration regenerated by sending the actual mid-clip screenshot to
 * Gemini Vision and asking for a 6-12 word caption that matches what the
 * viewer is seeing. Replaces the upfront, planned caption that may not
 * match the recorded reality.
 *
 * Returns one polished narration per scene, in order. Falls back to the
 * existing scene narration on per-call failure (never throws — caption
 * sync is best-effort).
 */
export async function regenerateNarrationsFromVision(
  scenes: Array<{ description: string; narration: string; action: string; pageUrl: string; screenshotBase64?: string }>,
  productName: string,
  understanding: { tagline: string; core_value_prop: string; problem_being_solved: string; top_5_features: string[] },
): Promise<string[]> {
  if (scenes.length === 0) return []

  const banned = `"unlock productivity", "streamline workflow", "powerful platform", "seamless experience", "revolutionary", "game-changing", "empowers teams", "supercharge", "effortlessly"`
  const out: string[] = []

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]
    const positionHint = i === 0
      ? 'This is the HOOK (first scene).'
      : i === scenes.length - 1
        ? 'This is the closing CTA.'
        : i === scenes.length - 2
          ? 'This is the proof / category claim before the CTA.'
          : `Middle of arc (${i + 1}/${scenes.length}) — show the product in action.`

    if (!scene.screenshotBase64) {
      out.push(scene.narration)
      continue
    }

    const prompt = `You are writing a single 6-12 word caption for one scene of a silent product demo video.

Product: ${productName}
Tagline: ${understanding.tagline}
Value proposition: ${understanding.core_value_prop}
Problem solved: ${understanding.problem_being_solved}

Scene action: ${scene.action}
Page URL: ${scene.pageUrl}
Position: ${positionHint}

The screenshot below shows the EXACT frame the viewer will see for this scene. Write ONE caption that:
1. Describes what is visible AND/OR the outcome of the action — never invent features or text not in the image.
2. Is 6-12 words, ONE sentence, present tense, active voice, second person or imperative.
3. Wraps 1-2 high-impact words in **double asterisks** (these render amber in the karaoke captions). Pick verbs and concrete nouns, not filler.
4. Avoids these banned phrases: ${banned}.
5. Uses "${productName}" by name when natural — but not in every caption.
6. Does NOT narrate the mechanic ("now we click", "as you can see"). Deliver the value claim.

Return ONLY the caption text. No quotes, no markdown, no JSON, no explanation.`

    let caption: string | null = null
    for (const visionModel of VISION_MODEL_CHAIN) {
      try {
        const text = await withTimeout(
          callGeminiVision(visionModel, prompt, scene.screenshotBase64),
          30_000,
          `gemini:regenerateNarration:${visionModel}`,
        )
        const trimmed = text.replace(/^["'`\s]+|["'`\s]+$/g, '').replace(/\n+/g, ' ').trim()
        if (trimmed && trimmed.length >= 8 && trimmed.length <= 200) {
          caption = trimmed
          break
        }
      } catch (err) {
        if (isQuotaExhausted(err)) continue
        logger.warn(`regenerateNarrationsFromVision: ${visionModel} failed for scene ${i + 1}`, { err })
      }
    }
    out.push(caption ?? scene.narration)
  }

  logger.info(`gemini: regenerated ${out.filter((c, i) => c !== scenes[i].narration).length}/${scenes.length} narrations from screenshots`)
  return out
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
  const visionModels = VISION_MODEL_CHAIN

  for (const visionModel of visionModels) {
    try {
      const text = await withTimeout(
        callGeminiVision(visionModel, prompt, screenshotBase64),
        30_000,
        `gemini-vision:${visionModel}`
      )
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

/**
 * Post-recording narration polish: takes ALL recorded scenes and rewrites
 * their narrations into a coherent professional narrative arc.
 *
 * Called AFTER recording is complete but BEFORE Remotion renders, so the
 * captions tell a proper story instead of showing raw/repetitive text
 * from the live planning phase.
 *
 * Falls back to the original narrations if the API call fails.
 */
export async function polishRecordedNarrations(
  scenes: Array<{ description: string; narration: string; action: string; pageUrl: string }>,
  productName: string,
  understanding: { tagline: string; core_value_prop: string; problem_being_solved: string; top_5_features: string[] },
): Promise<string[]> {
  if (scenes.length === 0) return []

  const sceneList = scenes.map((s, i) => ({
    i: i + 1,
    action: s.action,
    desc: s.description,
    page: s.pageUrl,
    raw: s.narration,
  }))

  const prompt = `You are LIGHTLY polishing captions for a silent-friendly product demo video of "${productName}". Each input caption was carefully written to MATCH WHAT IS ON SCREEN in its scene — your job is to improve flow and arc without changing the subject of any caption.

PRODUCT: ${productName}
TAGLINE: ${understanding.tagline}
VALUE PROP: ${understanding.core_value_prop}
PROBLEM SOLVED: ${understanding.problem_being_solved}
KEY FEATURES: ${understanding.top_5_features.join(', ')}

Below are the ${scenes.length} scenes that were ACTUALLY recorded, with captions that already reflect what the viewer sees on screen. Polish them for narrative flow.

SCENES:
${JSON.stringify(sceneList, null, 1)}

RULES:
1. Return a JSON array of exactly ${scenes.length} strings — one polished caption per scene, in order.
2. PRESERVE the content of each input caption. Keep the same verbs, feature nouns, and concrete details. Do NOT introduce content that isn't already there or in the scene description — the captions must still match the actual recorded frames.
3. Improve sentence rhythm, replace generic words with concrete ones, refine emphasis markup, and ensure adjacent captions don't repeat the same sentence shape.
4. The overall arc across the sequence:
   - First caption: should read as a HOOK (provocative or specific). Never "Introducing ${productName}".
   - Last caption: should read as a CTA — short, directive.
   - Middle captions: each should sell ONE outcome rather than describing UI mechanics.
5. Each caption: ONE sentence, 6-14 words, present tense, active voice.
6. Use **double asterisks** on 1-2 emphasis words per caption (these render amber in karaoke). Verbs and numbers, not filler.
7. NEVER repeat the same caption. Every single one must be unique.
8. BANNED: "unlock productivity", "streamline workflow", "powerful platform", "seamless experience", "revolutionary", "game-changing", "empowers teams", "supercharge", "effortlessly".
9. Do NOT describe the mechanic ("now we click", "as you can see"). The video SHOWS that. The caption DELIVERS the value claim.

Return ONLY a JSON array of strings, nothing else.`

  try {
    const text = await generateWithFallback('', prompt)
    const jsonText = extractJson(text)
    const parsed = JSON.parse(jsonText.replace(/\\n/g, ' '))

    if (Array.isArray(parsed) && parsed.length === scenes.length) {
      // Validate every element is a non-empty string
      const valid = parsed.every((s: unknown) => typeof s === 'string' && s.length > 0)
      if (valid) {
        logger.info(`gemini: polished ${scenes.length} narrations into coherent arc`)
        return parsed as string[]
      }
    }

    // If array length doesn't match, try to extract from object with "narrations" key
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>
      const narrations = obj.narrations ?? obj.captions ?? obj.segments
      if (Array.isArray(narrations) && narrations.length === scenes.length) {
        logger.info(`gemini: polished ${scenes.length} narrations (from object key)`)
        return narrations.map((n: unknown) => typeof n === 'string' ? n : String(n))
      }
    }

    logger.warn('gemini: polish returned wrong count, keeping originals')
    return scenes.map((s) => s.narration)
  } catch (err) {
    logger.warn('gemini: polishRecordedNarrations failed, keeping original narrations', { error: err })
    return scenes.map((s) => s.narration)
  }
}
