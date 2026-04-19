import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { chromium, type Page } from 'playwright'
import { logger } from '../lib/logger'
import { getFfmpegPath } from '../lib/ffmpegUtils'
import type {
  ProductUnderstanding,
  DemoStep,
  SceneCapture,
  RecordingManifest,
  ElementBox,
} from '../types'

const RECORDINGS_DIR = path.join(os.tmpdir(), 'teaser-recordings')

const VIDEO_WIDTH = 1920
const VIDEO_HEIGHT = 1080

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const MAX_STEPS = 20

const POPUP_HIDE_CSS = `
  [class*="cookie" i], [id*="cookie" i],
  [class*="consent" i], [id*="consent" i],
  [class*="gdpr" i], [id*="gdpr" i],
  [class*="chat-widget" i], [class*="intercom" i], [id*="intercom"],
  [class*="crisp" i], [class*="drift" i], [class*="hubspot-messages" i],
  [class*="zendesk" i], [class*="livechat" i],
  [class*="newsletter" i]:not(section):not(header):not(main),
  [class*="notification-banner" i], [class*="announcement" i],
  [aria-label*="cookie" i], [aria-label*="consent" i],
  [data-testid*="cookie" i], [data-testid*="consent" i],
  iframe[src*="intercom" i], iframe[src*="hubspot" i], iframe[src*="drift" i],
  iframe[src*="zendesk" i], iframe[src*="crisp" i] {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
  /* Neutralize body locks common to cookie/consent portals */
  html, body { overflow: auto !important; }
`

/** Regex-safe text patterns for popup accept/close affordances. */
const POPUP_ACCEPT_PATTERNS = [
  /^accept( all)?( cookies)?$/i,
  /^agree$/i,
  /^got it$/i,
  /^i agree$/i,
  /^ok(ay)?$/i,
  /^allow( all)?$/i,
  /^close$/i,
  /^dismiss$/i,
  /^no thanks$/i,
]

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-web-security',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  `--window-size=${VIDEO_WIDTH},${VIDEO_HEIGHT}`,
]

/**
 * DOM-side polish injected into every recorded page:
 * - A 40 px pointer that follows real Playwright mouse input.
 * - A click ripple rendered as a white inner glow + dark outer ring,
 *   which stays visible on light, dark, AND brand-colored backgrounds
 *   (fixes the old hardcoded-green-on-green invisibility bug).
 * - A thin drop shadow on both so the cursor reads over any surface.
 */
const CURSOR_SCRIPT = `
  if (!window.__injectedCursor) {
    const style = document.createElement('style');
    style.textContent = \`
      @keyframes teaser-ripple {
        0%   { transform: translate(-50%, -50%) scale(0.35); opacity: 0.95; }
        60%  { opacity: 0.55; }
        100% { transform: translate(-50%, -50%) scale(2.4); opacity: 0; }
      }
      .teaser-click-ripple {
        position: fixed;
        width: 72px; height: 72px;
        border-radius: 50%;
        pointer-events: none;
        z-index: 2147483646;
        background: radial-gradient(circle,
          rgba(255,255,255,0.75) 0%,
          rgba(255,255,255,0.18) 45%,
          rgba(0,0,0,0) 72%);
        box-shadow:
          inset 0 0 0 2px rgba(255,255,255,0.9),
          0 0 0 2px rgba(0,0,0,0.55),
          0 6px 22px rgba(0,0,0,0.35);
        animation: teaser-ripple 620ms cubic-bezier(0.22, 0.8, 0.3, 1) forwards;
      }
    \`;
    document.documentElement.appendChild(style);

    const CURSOR_SIZE = 40;
    const cursor = document.createElement('div');
    cursor.id = 'teaser-demo-cursor';
    cursor.style.cssText = 'position: fixed; top: 0; left: 0; width: ' + CURSOR_SIZE + 'px; height: ' + CURSOR_SIZE + 'px; z-index: 2147483647; pointer-events: none; transform: translate(-9999px, -9999px); will-change: transform;';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(CURSOR_SIZE));
    svg.setAttribute('height', String(CURSOR_SIZE));
    svg.style.filter = 'drop-shadow(0px 3px 6px rgba(0,0,0,0.55))';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.24c.45 0 .67-.54.35-.85L6.35 2.85a.5.5 0 0 0-.85.35Z');
    path.setAttribute('fill', '#0B0B0B');
    path.setAttribute('stroke', '#FFFFFF');
    path.setAttribute('stroke-width', '1.4');
    path.setAttribute('stroke-linejoin', 'round');

    svg.appendChild(path);
    cursor.appendChild(svg);
    document.documentElement.appendChild(cursor);

    window.__injectedCursor = cursor;

    // Follow the real pointer. A hair of CSS transition smooths jitter between
    // the RAF-timed Playwright mouse moves, without trailing the cursor enough
    // to desync it from the click point.
    cursor.style.transition = 'transform 60ms cubic-bezier(0.25, 0.8, 0.35, 1)';
    document.addEventListener('mousemove', (e) => {
      window.__injectedCursor.style.transform = \`translate(\${e.clientX - CURSOR_SIZE / 2}px, \${e.clientY - CURSOR_SIZE / 2}px)\`;
    }, { capture: true, passive: true });

    document.addEventListener('mousedown', (e) => {
      const ripple = document.createElement('div');
      ripple.className = 'teaser-click-ripple';
      ripple.style.left = e.clientX + 'px';
      ripple.style.top = e.clientY + 'px';
      document.documentElement.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    }, { capture: true, passive: true });
  }
`

// ─── Utilities ───────────────────────────────────────────────────────────────

function toFfPath(p: string): string {
  return p.replace(/\\/g, '/')
}

function spawnFfmpeg(ffmpegPath: string, args: string[], timeoutMs = 600_000): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info(`ffmpeg: ${args.slice(0, 8).join(' ')} ...`)
    const proc = spawn(ffmpegPath, args)
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`FFmpeg timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-600)}`))
    })
    proc.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

// ─── Cursor motion, scrolling, typing, popup cleanup ─────────────────────────

/** Cubic-bezier easing (0.25, 0.8, 0.35, 1) — matches material standard. */
function bezierEase(t: number): number {
  // Fast, good-enough approximation without solving a cubic per step.
  const u = 1 - t
  return 3 * u * t * t * 1 + t * t * t
}

/**
 * Animates the real Playwright mouse to `(tx, ty)` along a smoothly-arced
 * path with cubic-bezier easing. Each intermediate `page.mouse.move` fires
 * mousemove listeners, so the injected DOM cursor follows naturally.
 *
 * Arc deviation: a parabolic perpendicular offset peaking at ~40 px mid-flight.
 * Slows down within the last 80 px for a human "settle" feel.
 */
async function easedMoveTo(page: Page, tx: number, ty: number): Promise<void> {
  const state = await page
    .evaluate(() => ({
      x: (window as unknown as { __lastMouseX?: number }).__lastMouseX ?? 0,
      y: (window as unknown as { __lastMouseY?: number }).__lastMouseY ?? 0,
    }))
    .catch(() => ({ x: 0, y: 0 }))
  const sx = state.x
  const sy = state.y
  const dx = tx - sx
  const dy = ty - sy
  const dist = Math.hypot(dx, dy)
  if (dist < 2) {
    await page.mouse.move(tx, ty)
    return
  }
  // Perpendicular arc: 18% of the distance, capped at 44 px.
  const arcPeak = Math.min(44, dist * 0.18)
  // Perpendicular unit vector (right-hand rule).
  const px = -dy / dist
  const py = dx / dist

  const steps = Math.max(18, Math.min(44, Math.round(dist / 28)))
  for (let i = 1; i <= steps; i++) {
    const raw = i / steps
    const eased = bezierEase(raw)
    // Slow the final 20% by applying extra ease-out for a settled landing.
    const finalT = raw > 0.8 ? 0.8 + (eased - 0.8) * 0.6 : eased
    const arc = Math.sin(Math.PI * finalT) * arcPeak
    const mx = sx + dx * finalT + px * arc
    const my = sy + dy * finalT + py * arc
    await page.mouse.move(mx, my)
    await page.waitForTimeout(14 + Math.round(Math.random() * 4))
  }
  await page
    .evaluate((pos: { x: number; y: number }) => {
      ;(window as unknown as { __lastMouseX?: number; __lastMouseY?: number }).__lastMouseX = pos.x
      ;(window as unknown as { __lastMouseX?: number; __lastMouseY?: number }).__lastMouseY = pos.y
    }, { x: tx, y: ty })
    .catch(() => {})
}

/**
 * Waits for the page to stabilise after a navigation or click. Capped at
 * 2.5 s — networkidle often takes 4-10 s on analytics-heavy sites and that
 * dead air bloats the video.
 */
async function postActionWait(page: Page, maxMs = 2500): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: maxMs }).catch(() => {})
}

/**
 * Smooth scroll by `deltaY`px with RAF-based easing. Runs inside the page so
 * the compositor paints every frame, unlike discrete wheel events which render
 * as stutters. A small settle pause lets lazy-loaded content pop in.
 */
async function smoothScroll(page: Page, deltaY: number): Promise<void> {
  await page.evaluate((dy: number) => {
    return new Promise<void>((resolve) => {
      const startY = window.scrollY
      const target = startY + dy
      const duration = 900
      const startTime = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - startTime) / duration)
        // cubic-bezier(0.22, 0.8, 0.3, 1) approx
        const eased = 1 - Math.pow(1 - t, 3)
        window.scrollTo(0, startY + (target - startY) * eased)
        if (t < 1) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
  }, deltaY)
  await page.waitForTimeout(450)
}

/**
 * Types `text` with per-key random jitter around 45 ms. Playwright's built-in
 * fixed-delay mode (`{ delay }`) reads as mechanical; humans have ±15 ms of
 * natural variance.
 */
async function typeWithJitter(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch)
    await page.waitForTimeout(30 + Math.round(Math.random() * 30))
  }
}

/**
 * Best-effort click of any visible "Accept / Close / Got it" popup before
 * falling back to the CSS hide sheet. Clicking is preferable because some
 * sites remount the dialog via JS after a CSS `display:none`.
 */
async function dismissPopups(page: Page): Promise<void> {
  for (const pattern of POPUP_ACCEPT_PATTERNS) {
    try {
      const btn = page.getByRole('button', { name: pattern }).first()
      if (await btn.isVisible({ timeout: 250 }).catch(() => false)) {
        await btn.click({ timeout: 600 }).catch(() => {})
        await page.waitForTimeout(120)
        break
      }
    } catch { /* next */ }
  }
  await page.addStyleTag({ content: POPUP_HIDE_CSS }).catch(() => {})
}

// ─── Element finding ──────────────────────────────────────────────────────────

/**
 * Finds a visible element matching `selector` within a total time budget.
 * Tries multiple Playwright strategies in priority order, stopping as soon as
 * one resolves or the budget is exhausted. Hard cap prevents failed lookups
 * from freezing the recording for 10+ seconds.
 */
async function findLocator(page: Page, selector: string | undefined, budgetMs = 2500) {
  if (!selector) return null
  const deadline = Date.now() + budgetMs
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const exact = new RegExp(`^\\s*${escaped}\\s*$`, 'i')
  const loose = new RegExp(escaped, 'i')

  const strategies = [
    page.getByRole('link', { name: exact }),
    page.getByRole('button', { name: exact }),
    page.getByRole('menuitem', { name: exact }),
    page.getByRole('tab', { name: exact }),
    page.getByRole('link', { name: loose }),
    page.getByRole('button', { name: loose }),
    page.getByPlaceholder(loose),
    page.getByLabel(loose),
    page.locator('a', { hasText: loose }),
    page.locator('button', { hasText: loose }),
    page.getByText(loose, { exact: false }),
  ]

  for (const locator of strategies) {
    if (Date.now() >= deadline) break
    try {
      const remaining = Math.max(0, deadline - Date.now())
      const first = locator.first()
      await first.waitFor({ state: 'visible', timeout: Math.min(600, remaining) })
      const box = await first.boundingBox()
      if (box && box.width > 0 && box.height > 0) {
        // Bring target into view before returning. Off-screen elements fail
        // real click events and produce dead-air frames.
        await first.scrollIntoViewIfNeeded({ timeout: 800 }).catch(() => {})
        return first
      }
    } catch { /* try next */ }
  }
  return null
}

// ─── Step execution ───────────────────────────────────────────────────────────

interface StepContext {
  page: Page
  recordingStartTime: number
  scenes: SceneCapture[]
  visitedUrls: string[]
  productUrl: string
  understanding: ProductUnderstanding
  allowedPaths: Set<string> | null
  productOrigin: string
}

/** Normalises a URL to `host+pathname` for siteMap membership checks. */
function urlKey(u: string): string | null {
  try {
    const parsed = new URL(u)
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    return `${parsed.host}${path}`
  } catch {
    return null
  }
}

/**
 * Executes one demo step and writes a scene entry to the manifest.
 * All timeouts are tight — no step should freeze the recording for more
 * than a few seconds regardless of outcome.
 */
async function captureStep(
  ctx: StepContext,
  step: DemoStep,
  stepIndex: number,
): Promise<SceneCapture> {
  const { page, recordingStartTime } = ctx
  const t = () => Date.now() - recordingStartTime
  const sceneStart = t()
  let targetElement: ElementBox | null = null
  let elementNotFound = false

  const shortLabel = step.element_to_click ? ` → "${step.element_to_click.slice(0, 40)}"` : ''
  logger.info(`recorder step ${stepIndex}: ${step.action}${shortLabel}`)

  try {
    switch (step.action) {
      case 'navigate': {
        if (!step.navigate_to) break
        const raw = step.navigate_to.trim()
        // Skip in-page anchors — they don't change what's on screen meaningfully
        if (raw.startsWith('#')) break
        const targetUrl = raw.startsWith('http')
          ? raw
          : new URL(raw, ctx.productUrl).href

        // Only navigate to URLs that exist in the discovered siteMap.
        // This prevents Gemini hallucinations from triggering long 404 waits
        // or landing on dead pages that drag out the recording.
        if (ctx.allowedPaths) {
          const key = urlKey(targetUrl)
          const sameOrigin = (() => {
            try { return new URL(targetUrl).origin === ctx.productOrigin } catch { return false }
          })()
          if (!sameOrigin || !key || !ctx.allowedPaths.has(key)) {
            logger.warn(`recorder step ${stepIndex}: navigate_to "${targetUrl}" not in siteMap — skipping`)
            elementNotFound = true
            break
          }
        }

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {})
        await dismissPopups(page)
        await postActionWait(page)
        break
      }

      case 'click': {
        const locator = await findLocator(page, step.element_to_click)
        if (locator) {
          try {
            const box = await locator.boundingBox()
            if (box) {
              targetElement = {
                x: Math.round(box.x + box.width / 2),
                y: Math.round(box.y + box.height / 2),
                width: Math.round(box.width),
                height: Math.round(box.height),
              }
              // Arc toward the target → hover-signal 280 ms → click.
              // The hover dwell lets CSS `:hover` states render before
              // the press, which is the hallmark "planned" feel of good
              // product demos.
              await easedMoveTo(page, targetElement.x, targetElement.y)
              await page.waitForTimeout(280)
            }
            await locator.click({ timeout: 3000, delay: 60 })
            await postActionWait(page)
          } catch (clickErr) {
            logger.warn(`recorder step ${stepIndex}: click failed`, { err: clickErr })
            elementNotFound = true
          }
        } else {
          logger.warn(`recorder step ${stepIndex}: "${step.element_to_click}" not found`)
          elementNotFound = true
        }
        break
      }

      case 'type': {
        const locator = await findLocator(page, step.element_to_click)
        if (locator) {
          try {
            const box = await locator.boundingBox()
            if (box) {
              targetElement = {
                x: Math.round(box.x + box.width / 2),
                y: Math.round(box.y + box.height / 2),
                width: Math.round(box.width),
                height: Math.round(box.height),
              }
              await easedMoveTo(page, targetElement.x, targetElement.y)
              await page.waitForTimeout(220)
            }
            await locator.click({ timeout: 3000 })
            await typeWithJitter(page, step.type_text ?? 'hello')
            await page.waitForTimeout(650)
          } catch {
            elementNotFound = true
          }
        } else {
          elementNotFound = true
        }
        break
      }

      case 'hover': {
        targetElement = null
        const locator = await findLocator(page, step.element_to_click)
        if (locator) {
          const box = await locator.boundingBox()
          if (box) {
            targetElement = {
              x: Math.round(box.x + box.width / 2),
              y: Math.round(box.y + box.height / 2),
              width: Math.round(box.width),
              height: Math.round(box.height),
            }
            await easedMoveTo(page, targetElement.x, targetElement.y)
            await page.waitForTimeout(900)
          } else {
            elementNotFound = true
          }
        } else {
          elementNotFound = true
        }
        break
      }

      case 'scroll_down':
      case 'scroll_up': {
        // Single RAF-driven smooth scroll — renders every compositor frame
        // and reads as intentional, not mechanical, unlike the old
        // 20×55ms discrete wheel loop.
        const delta = (step.action === 'scroll_down' ? 1 : -1) * 780
        await smoothScroll(page, delta)
        break
      }

      default: {
        await page.waitForTimeout(1200)
      }
    }
  } catch (err) {
    logger.warn(`recorder step ${stepIndex} (${step.action}) errored`, { err })
  }

  const sceneEnd = t()
  return {
    step: stepIndex,
    action: step.action,
    description: step.description,
    narration: step.narration,
    clips: elementNotFound ? [] : [{ start: sceneStart, end: sceneEnd }],
    targetElement,
    typeText: step.type_text ?? null,
    elementNotFound,
    pageUrl: page.url(),
  }
}

// ─── Main recorder ────────────────────────────────────────────────────────────

/**
 * Records a product demo by executing the pre-planned steps from
 * `understanding.demo_flow`. All Gemini API calls happen BEFORE this
 * function is called, so the recording session is pure browser interaction
 * with no API gaps that would cause frozen/fast-forwarded video.
 */
export async function recordProduct(
  productUrl: string,
  understanding: ProductUnderstanding,
  jobId: string,
  _credentials?: { username: string; password: string },
  startUrl?: string,
  siteMap: string[] = [],
): Promise<string> {
  const outputDir = path.join(RECORDINGS_DIR, jobId)
  fs.mkdirSync(outputDir, { recursive: true })

  logger.info(`recorder: starting job ${jobId} for ${productUrl}`)

  // Build an allow-list of host+path entries from the discovered siteMap.
  // Any navigate_to step that does not resolve to one of these is skipped.
  const productOrigin = (() => {
    try { return new URL(productUrl).origin } catch { return '' }
  })()
  const allowedPaths: Set<string> | null = siteMap.length > 0
    ? new Set(siteMap.map(urlKey).filter((k): k is string => !!k))
    : null
  if (allowedPaths) {
    logger.info(`recorder: navigate allow-list has ${allowedPaths.size} entries`)
  }

  // ── Build step plan from pre-computed demo_flow ───────────────────────────
  // No Gemini calls here — the understanding was already generated in Stage 1.
  // Append fallback scrolls to guarantee minimum footage on thin pages.
  const demoSteps: DemoStep[] = [
    ...understanding.demo_flow.slice(0, MAX_STEPS),
  ]

  const hasScrolls = demoSteps.some(
    (s) => s.action === 'scroll_down' || s.action === 'scroll_up',
  )
  if (!hasScrolls || demoSteps.length < 4) {
    demoSteps.push(
      { step: 90, action: 'scroll_down', description: 'Explore the page', narration: `Here's what ${understanding.product_name} can do.` },
      { step: 91, action: 'scroll_down', description: 'More features', narration: 'Every detail is crafted for clarity.' },
      { step: 92, action: 'scroll_down', description: 'Continue exploring', narration: `${understanding.product_name} — built for speed.` },
      { step: 93, action: 'scroll_up', description: 'Back to top', narration: 'Start your free trial today.' },
    )
  }

  logger.info(`recorder: ${demoSteps.length} pre-planned steps (no API calls during recording)`)

  // ── Open browser with recordVideo ─────────────────────────────────────────
  // headless: false — compositor renders at full speed, capturing real motion.
  // In headless mode, the compositor throttles or skips frames causing frozen video.
  const browser = await chromium.launch({ headless: false, args: BROWSER_ARGS })
  try {
    const context = await browser.newContext({
      viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      userAgent: USER_AGENT,
      deviceScaleFactor: 1,
      recordVideo: {
        dir: outputDir,
        size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      },
    })
    context.setDefaultTimeout(10_000)
    context.setDefaultNavigationTimeout(25_000)

    const page = await context.newPage()
    await page.route('**/*.{mp4,webm,ogg,avi}', (route) => route.abort())
    await page.addInitScript(CURSOR_SCRIPT)

    const recordingStartTime = Date.now()
    logger.info('recorder: Playwright recordVideo active')

    // ── Navigate to entry URL ─────────────────────────────────────────────────
    const entryUrl = startUrl ?? productUrl
    logger.info(`recorder: navigating to ${entryUrl}`)
    await page
      .goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      .catch(async () => {
        await page.goto(entryUrl, { waitUntil: 'commit', timeout: 15_000 }).catch(() => {})
      })
    await dismissPopups(page)
    // Let the page paint once before we start interacting. 1.2 s is enough for
    // first-contentful-paint on any site that loaded via domcontentloaded.
    await page.waitForTimeout(1200)

    const scenes: SceneCapture[] = []
    const visitedUrls: string[] = [page.url()]

    const ctx: StepContext = {
      page,
      recordingStartTime,
      scenes,
      visitedUrls,
      productUrl,
      understanding,
      allowedPaths,
      productOrigin,
    }

    // ── Execute all pre-planned steps ─────────────────────────────────────────
    for (let i = 0; i < demoSteps.length; i++) {
      const step = demoSteps[i]
      const scene = await captureStep(ctx, step, i + 1)
      scenes.push(scene)

      // Track URL changes for the manifest (for reference, not re-planning)
      const currentUrl = page.url()
      if (!visitedUrls.includes(currentUrl)) {
        visitedUrls.push(currentUrl)
        logger.info(`recorder: navigated to new page → ${currentUrl}`)
        await dismissPopups(page)
        await page.waitForTimeout(600)
      }
    }

    await page.waitForTimeout(800)

    const wallClockMs = Date.now() - recordingStartTime
    logger.info(
      `recorder: ${scenes.length} scenes / ${visitedUrls.length} URLs / ${Math.round(wallClockMs / 1000)}s wall-clock`,
    )
    logger.info(`recorder: URLs visited: ${visitedUrls.join(' → ')}`)

    // ── Finalise recording ────────────────────────────────────────────────────
    // Closing the context tells Playwright to finish writing the WebM.
    const webmPath = await page.video()!.path()
    await context.close()

    // Convert WebM → CFR MP4. The WebM timestamps are wall-clock aligned because
    // the browser runs in real-time (headed mode, no time-budget tricks).
    const recordingMp4 = path.join(outputDir, 'recording.mp4')
    logger.info(`recorder: converting ${webmPath} → recording.mp4`)
    await spawnFfmpeg(
      getFfmpegPath(),
      [
        '-i', toFfPath(webmPath),
        // Scale+pad → subtle cinematic grade (desat, slight contrast lift,
        // cool-tilt white balance). Keeps UI readable but stops the footage
        // from looking like a raw screen capture.
        '-vf', [
          'scale=1920:1080:force_original_aspect_ratio=decrease',
          'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
          'setsar=1',
          'eq=saturation=0.94:contrast=1.07:brightness=-0.015',
          'colorbalance=rm=0.02:bm=-0.02',
        ].join(','),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-fps_mode', 'cfr', '-r', '30',
        '-g', '60',
        '-video_track_timescale', '30000',
        '-an',
        '-movflags', '+faststart',
        '-y', toFfPath(recordingMp4),
      ],
      600_000,
    )
    try { fs.rmSync(webmPath, { force: true }) } catch {}

    logger.info(
      `recorder: recording.mp4 saved — ${Math.round(fs.statSync(recordingMp4).size / 1024 / 1024)} MB`,
    )

    const manifest: RecordingManifest = {
      productUrl: entryUrl,
      productName: understanding.product_name,
      tagline: understanding.tagline,
      totalScenes: scenes.length,
      scenes,
    }
    fs.writeFileSync(
      path.join(outputDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    )
    logger.info(`recorder: manifest saved — ${scenes.length} scenes`)

    return outputDir
  } finally {
    await browser.close()
  }
}
