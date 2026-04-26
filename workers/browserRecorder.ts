import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { chromium, type Locator, type Page } from 'playwright'
import { logger } from '../lib/logger'
import { getFfmpegPath } from '../lib/ffmpegUtils'
import { identifyElementOnPage, planPageInteractions, planBeatSteps, proposeBeat } from '../lib/gemini'
import { scanDomInventory, sampleTypeText, filterInventory } from '../lib/domInventory'
import {
  perceptualHash,
  hashSimilarity,
  viewportEntropy,
  klDivergence,
  domFingerprintScript,
  fingerprintsDiffer,
  type DomFingerprint,
} from '../lib/utils'
import type {
  ProductUnderstanding,
  DemoStep,
  SceneCapture,
  RecordingManifest,
  RecordingDiagnostics,
  ElementBox,
  VideoLength,
  DomInventory,
  DomInventoryItem,
  DemoBeat,
} from '../types'

const RECORDINGS_DIR = path.join(os.tmpdir(), 'teaser-recordings')

const VIDEO_WIDTH = 1920
const VIDEO_HEIGHT = 1080

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const INTRO_OUTRO_SECONDS = 7
const DEFAULT_VIDEO_LENGTH_SECONDS: VideoLength = 150
const MIN_FINAL_VIDEO_SECONDS = 60
const MAX_FINAL_VIDEO_SECONDS = 300

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
      /* Loading shim — covers the page in dark while it's still loading.
         Removed once the recorder writes data-teaser-ready="1" on <body>. */
      #teaser-loading-shim {
        position: fixed;
        inset: 0;
        z-index: 2147483645;
        background: #0A0A0A;
        pointer-events: none;
        opacity: 1;
        transition: opacity 380ms ease-out;
      }
      body[data-teaser-ready="1"] #teaser-loading-shim { opacity: 0; pointer-events: none; }
    \`;
    document.documentElement.appendChild(style);

    // Inject the loading shim as soon as <body> exists.
    const installShim = () => {
      if (!document.body || document.getElementById('teaser-loading-shim')) return;
      const shim = document.createElement('div');
      shim.id = 'teaser-loading-shim';
      document.body.appendChild(shim);
    };
    if (document.body) installShim();
    else document.addEventListener('DOMContentLoaded', installShim, { once: true });

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
 * Hard page-settle for navigations — waits for networkidle, fonts to finish
 * loading, and then a fixed paint settle so animations + first contentful
 * paint complete before any clip window opens. Returns the wall-clock ms
 * spent waiting so callers can subtract it from clip durations if needed.
 */
async function pageSettle(page: Page, opts: { networkIdleMs?: number; settleMs?: number } = {}): Promise<number> {
  const { networkIdleMs = 4000, settleMs = 800 } = opts
  const start = Date.now()
  await page.waitForLoadState('networkidle', { timeout: networkIdleMs }).catch(() => {})
  await page
    .evaluate(() => {
      const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
      return fonts && fonts.ready ? fonts.ready : null
    })
    .catch(() => {})
  await page.waitForTimeout(settleMs)
  return Date.now() - start
}

/**
 * Marks the page as ready so the dark loading shim fades out. Called once,
 * after the initial entry settle completes, and after every navigate-step
 * settle. Idempotent — safe to call repeatedly.
 */
async function markPageReady(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      if (document.body) document.body.dataset.teaserReady = '1'
    })
    .catch(() => {})
}

/**
 * Marks the page as NOT ready immediately before a navigation that will
 * reload content. The dark shim re-installs itself on the next page via
 * the init script, so the loading transition appears as a brief dark fade
 * instead of a white flash in the recording.
 */
async function markPageLoading(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      if (document.body) document.body.removeAttribute('data-teaser-ready')
    })
    .catch(() => {})
}

/**
 * Animates the cursor into frame from off-screen toward a point ~120 px
 * from the target. Reads as "I'm about to do something on purpose" — the
 * core visual signal of intentional interaction in product launch videos.
 * Skipped if the cursor is already near the target.
 */
async function cursorEntrance(page: Page, targetX: number, targetY: number): Promise<void> {
  // Defensive: if box geometry was off-screen / negative (e.g. element scrolled
  // out of view between detection and click), clamp the target to the viewport
  // so the cursor doesn't drift into invisible space and stutter the recording.
  const tx = Math.max(8, Math.min(VIDEO_WIDTH - 8, Math.round(targetX)))
  const ty = Math.max(8, Math.min(VIDEO_HEIGHT - 8, Math.round(targetY)))
  const state = await page
    .evaluate(() => ({
      x: (window as unknown as { __lastMouseX?: number }).__lastMouseX ?? -1,
      y: (window as unknown as { __lastMouseY?: number }).__lastMouseY ?? -1,
    }))
    .catch(() => ({ x: -1, y: -1 }))
  const dist = state.x < 0 ? Infinity : Math.hypot(tx - state.x, ty - state.y)
  if (dist < 200) return // already nearby — skip the entrance, just ease in

  // Pick the nearest edge as the entry point. Edge values are intentionally
  // just outside the viewport so the cursor visibly slides INTO frame.
  const fromLeft = tx < VIDEO_WIDTH / 2
  const entryX = fromLeft ? -40 : VIDEO_WIDTH + 40
  const entryY = Math.max(80, Math.min(VIDEO_HEIGHT - 80, ty + (Math.random() < 0.5 ? -90 : 90)))
  await page
    .evaluate((pos: { x: number; y: number }) => {
      ;(window as unknown as { __lastMouseX?: number; __lastMouseY?: number }).__lastMouseX = pos.x
      ;(window as unknown as { __lastMouseX?: number; __lastMouseY?: number }).__lastMouseY = pos.y
    }, { x: entryX, y: entryY })
    .catch(() => {})
  await page.mouse.move(entryX, entryY)

  // Approach: animate to a point ~140 px from target (clamped to the viewport),
  // briefly pause, then the regular easedMoveTo handles the final settle.
  const approachX = Math.max(8, Math.min(VIDEO_WIDTH - 8, tx + (fromLeft ? -140 : 140)))
  const approachY = Math.max(8, Math.min(VIDEO_HEIGHT - 8, ty + (Math.random() < 0.5 ? -40 : 40)))
  await easedMoveTo(page, approachX, approachY)
  await page.waitForTimeout(120)
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
 * Strips ASCII control characters and non-printables from a string. Used on
 * any LLM-supplied text that we type into the live page or write to logs —
 * defends against terminal-control injection (e.g. ANSI escapes that would
 * mangle the worker log) and Playwright keyboard.type() crashes on some
 * unicode control bytes.
 */
function sanitizeForType(text: string | null | undefined): string {
  if (!text) return ''
  // eslint-disable-next-line no-control-regex
  return text
    .replace(/[\x00-\x1f\x7f]/g, ' ') // ASCII control chars → space
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

/**
 * Sanitises a string before logging. Prevents LLM-supplied text or page
 * content from injecting newlines/escape sequences into the worker log.
 */
function sanitizeForLog(text: string | null | undefined, max = 80): string {
  if (!text) return ''
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * Returns true if `text` looks like an input placeholder rather than a real
 * sample value. The LLM occasionally copies the placeholder into `type_text`
 * which then types literally and leaves the form invalid (because most React
 * forms validate on the typed value, not on placeholder visibility).
 */
function looksLikePlaceholder(text: string | null | undefined): boolean {
  if (!text) return true
  const t = text.trim()
  if (t.length === 0) return true
  if (t.length < 3) return true
  if (/^e\.g\.?\s/i.test(t)) return true
  if (/\.{3}$/.test(t)) return true // ends in ellipsis
  if (/^enter\s+/i.test(t)) return true // "Enter your name"
  if (/^type\s+/i.test(t)) return true
  if (/^your\s+/i.test(t)) return true // "Your email"
  return false
}

/**
 * Picks a realistic sample value for an input based on its semantic role.
 * Used when the LLM didn't supply a sensible `type_text` (e.g. it pasted
 * the placeholder). Mirrors `sampleTypeText` from lib/domInventory.ts but
 * works without a DomInventoryItem in scope.
 */
function fallbackTypeText(elementLabel: string | undefined, productName: string): string {
  const label = (elementLabel ?? '').toLowerCase()
  if (/email/.test(label)) return 'demo@example.com'
  if (/password/.test(label)) return 'demo-password-123'
  if (/phone|tel/.test(label)) return '+1 555 0123'
  if (/url|link|website/.test(label)) return 'https://example.com'
  if (/search|query|find|look/.test(label)) return `${productName.split(' ')[0].toLowerCase()} workflow`
  if (/name/.test(label)) return 'Acme Corp'
  if (/message|comment|feedback|describe/.test(label)) {
    return `Trying ${productName} for our team — looks promising.`
  }
  return `Try ${productName}`
}

/**
 * Dispatches React-friendly input + change events on the focused element
 * after typing. Many React forms (controlled inputs) listen for `input`
 * events to update internal state; without this, the typed value stays
 * "invisible" to the form validator and submit buttons remain disabled.
 */
async function fireReactInputEvents(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
      if (!el) return
      const inputEvent = new Event('input', { bubbles: true })
      const changeEvent = new Event('change', { bubbles: true })
      el.dispatchEvent(inputEvent)
      el.dispatchEvent(changeEvent)
    })
    .catch(() => {})
}

/**
 * Strict interactability check. Playwright's `isEnabled` checks the native
 * `disabled` attribute and ARIA roles, but it misses three cases that show
 * up frequently in real React apps:
 *   1. `aria-disabled="true"` on a non-button element used as a button
 *   2. A `.disabled` / `.is-disabled` CSS class with no native attribute
 *   3. `readOnly` inputs (we don't want to "type" into a read-only field)
 * Returns true if the element is safe to click/type into.
 */
async function isInteractable(locator: Locator, kind: 'click' | 'type' = 'click'): Promise<boolean> {
  const enabled = await locator.isEnabled({ timeout: 500 }).catch(() => true)
  if (!enabled) return false
  const flags = await locator
    .evaluate((el: Element, k: 'click' | 'type') => {
      const node = el as HTMLElement
      const ariaDisabled = node.getAttribute('aria-disabled') === 'true'
      const cls = (node.className && typeof node.className === 'string' ? node.className : '').toLowerCase()
      const classDisabled = /\b(is-disabled|disabled|btn-disabled)\b/.test(cls)
      const readOnly = k === 'type' && (node as HTMLInputElement).readOnly === true
      return { ariaDisabled, classDisabled, readOnly }
    }, kind)
    .catch(() => ({ ariaDisabled: false, classDisabled: false, readOnly: false }))
  return !flags.ariaDisabled && !flags.classDisabled && !flags.readOnly
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

/**
 * Vision-based click fallback: when text-based findLocator fails, takes a
 * screenshot, sends it to Gemini Vision to identify the exact element text,
 * and retries findLocator with the corrected text. If that also fails, clicks
 * at the centre of the page as a last resort.
 *
 * This handles cases where Gemini's demo_flow says "Get Started" but the
 * actual button reads "Get started" (capitalisation) or "Get Started →" (icon).
 */
async function visionClickFallback(
  page: Page,
  originalText: string,
): Promise<{ locator: ReturnType<typeof page.locator> | null; elementBox: ElementBox | null }> {
  try {
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 70 })
    const base64 = screenshot.toString('base64')
    const correctedText = await identifyElementOnPage(base64, originalText, page.url())

    if (correctedText && correctedText !== originalText) {
      logger.info(`visionClickFallback: "${originalText}" → "${correctedText}"`)
      const locator = await findLocator(page, correctedText, 2000)
      if (locator) {
        const box = await locator.boundingBox()
        const elementBox = box ? {
          x: Math.round(box.x + box.width / 2),
          y: Math.round(box.y + box.height / 2),
          width: Math.round(box.width),
          height: Math.round(box.height),
        } : null
        return { locator, elementBox }
      }
    }
  } catch (err) {
    logger.warn('visionClickFallback: failed', { err })
  }
  return { locator: null, elementBox: null }
}

/**
 * Extracts same-origin <a href> values from the currently loaded page and
 * adds any new ones to the allow-list. Called after every navigation to ensure
 * the recorder never blocks a mid-demo navigate to a freshly-discovered page.
 */
async function expandAllowedPaths(
  page: Page,
  allowedPaths: Set<string> | null,
  productOrigin: string,
): Promise<void> {
  if (!allowedPaths) return
  try {
    const links: string[] = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h && h.startsWith(location.origin))
    })
    let added = 0
    for (const href of links) {
      const key = urlKey(href)
      if (key && !allowedPaths.has(key)) {
        try {
          if (new URL(href).origin === productOrigin) {
            allowedPaths.add(key)
            added++
          }
        } catch { /* skip */ }
      }
    }
    if (added > 0) {
      logger.info(`expandAllowedPaths: +${added} new paths (total: ${allowedPaths.size})`)
    }
  } catch { /* page might be navigating */ }
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
  /** Wall-clock ms reserved at the start of the recording for entry-page settle.
   *  No clip starts before this time; ensures the leading loading frames are
   *  not part of any clip window. */
  prerollMs: number
  /** Output directory — the recorder writes per-scene reference screenshots here
   *  for the post-recording vision narration pass. */
  outputDir: string
  /** URL of the initial entry page. We refuse to navigate back to this after
   *  the seed steps complete, which kills the homepage-loop-back symptom. */
  entryUrl: string
  /** URL keys (host+pathname) the runtime refuses to navigate to during the
   *  live phase. Pre-seeded with the entry URL before seed steps run, so a
   *  homepage-link click in the seed phase can't drop us back to landing. */
  forbiddenRevisits: Set<string>
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
 * Computes the target demo clip duration in ms, dynamically adjusted for
 * the product's actual depth. More discoverable pages and interactive
 * elements → longer target so the video covers the product properly.
 */
function targetDemoDurationMs(
  videoLength: VideoLength = DEFAULT_VIDEO_LENGTH_SECONDS,
  siteMapSize = 0,
  interactiveElementCount = 0,
): number {
  let baseSeconds = Math.max(
    MIN_FINAL_VIDEO_SECONDS,
    Math.min(MAX_FINAL_VIDEO_SECONDS, videoLength),
  )
  // Products with more discoverable pages deserve more screen time
  if (siteMapSize >= 8) baseSeconds = Math.max(baseSeconds, 210)
  else if (siteMapSize >= 5) baseSeconds = Math.max(baseSeconds, 180)
  else if (siteMapSize >= 3) baseSeconds = Math.max(baseSeconds, 150)
  // Products with many interactive elements need time to demo them
  if (interactiveElementCount >= 15) baseSeconds = Math.min(MAX_FINAL_VIDEO_SECONDS, baseSeconds + 30)
  else if (interactiveElementCount >= 8) baseSeconds = Math.min(MAX_FINAL_VIDEO_SECONDS, baseSeconds + 15)
  return Math.max(30_000, (baseSeconds - INTRO_OUTRO_SECONDS) * 1000)
}

function capturedClipDurationMs(scenes: SceneCapture[]): number {
  return scenes.reduce((total, scene) => {
    return total + scene.clips.reduce((sceneTotal, clip) => {
      return sceneTotal + Math.max(0, clip.end - clip.start)
    }, 0)
  }, 0)
}

function minimumSceneDurationMs(action: DemoStep['action'], elementNotFound: boolean): number {
  if (elementNotFound) return 3500
  if (action === 'navigate') return 6000
  if (action === 'click' || action === 'type') return 5000
  if (action === 'hover') return 4000
  if (action === 'scroll_down' || action === 'scroll_up') return 4500
  return 3000
}

async function fallbackVisualMotion(page: Page, stepIndex: number): Promise<void> {
  await easedMoveTo(
    page,
    stepIndex % 2 === 0 ? 1480 : 420,
    stepIndex % 3 === 0 ? 760 : 360,
  ).catch(() => {})
  await smoothScroll(page, stepIndex % 2 === 0 ? 520 : -420).catch(async () => {
    await page.waitForTimeout(900)
  })
}

/**
 * Returns true if every step in `steps` is a scroll action — used to detect
 * scroll-only batches that ignore the live interactivity available on the page.
 */
function isScrollOnlyBatch(steps: DemoStep[]): boolean {
  if (steps.length === 0) return true
  return steps.every((s) => s.action === 'scroll_down' || s.action === 'scroll_up')
}

/**
 * Adds a deterministic interaction to a scroll-only batch when the live DOM
 * has real interactive elements available. We pick the highest-value option
 * (search > primary CTA > input > button) and synthesize a step before any
 * scrolls so the viewer sees real interaction first.
 */
function injectInventoryInteraction(
  steps: DemoStep[],
  inventory: DomInventory,
  productName: string,
): DemoStep[] {
  const search = inventory.items.find((it) => it.kind === 'search')
  if (search) {
    return [
      {
        step: 0,
        action: 'type',
        description: 'Type a realistic query into the search field',
        narration: `Search inside ${productName} is **instant**.`,
        element_to_click: search.text,
        type_text: sampleTypeText(search.inputType, productName),
      },
      ...steps,
    ]
  }
  if (inventory.primaryCta) {
    return [
      {
        step: 0,
        action: 'click',
        description: `Click the primary CTA "${inventory.primaryCta.text}"`,
        narration: `Getting started with ${productName} is **one click**.`,
        element_to_click: inventory.primaryCta.text,
      },
      ...steps,
    ]
  }
  const input = inventory.items.find((it) => it.kind === 'input')
  if (input) {
    return [
      {
        step: 0,
        action: 'type',
        description: 'Type a realistic value into the visible input',
        narration: `${productName} keeps inputs **simple**.`,
        element_to_click: input.text,
        type_text: sampleTypeText(input.inputType, productName),
      },
      ...steps,
    ]
  }
  const button = inventory.items.find((it) => it.kind === 'button')
  if (button) {
    return [
      {
        step: 0,
        action: 'click',
        description: `Click the "${button.text}" button`,
        narration: `Inside ${productName} actions are **direct**.`,
        element_to_click: button.text,
      },
      ...steps,
    ]
  }
  return steps
}

async function planLiveSteps(
  ctx: StepContext,
  allowNavigation: boolean,
  inventory: DomInventory,
): Promise<DemoStep[]> {
  try {
    await dismissPopups(ctx.page)
    const screenshot = await ctx.page.screenshot({ type: 'jpeg', quality: 70 })
    let steps = await planPageInteractions(
      screenshot.toString('base64'),
      ctx.page.url(),
      ctx.understanding.product_name,
      ctx.understanding,
      ctx.visitedUrls,
      allowNavigation,
      inventory,
    )

    const hasInteractives = inventory.buttonCount + inventory.inputCount + inventory.searchCount > 0
    // If the page has real interactives but Gemini returned scroll-only,
    // reject and re-plan once with an explicit feedback hint.
    if (hasInteractives && isScrollOnlyBatch(steps)) {
      logger.info('recorder: scroll-only batch rejected — re-planning with inventory feedback')
      try {
        const retrySteps = await planPageInteractions(
          screenshot.toString('base64'),
          ctx.page.url(),
          ctx.understanding.product_name,
          ctx.understanding,
          ctx.visitedUrls,
          allowNavigation,
          inventory,
          `Your previous plan only contained scrolls. The page has ${inventory.buttonCount + inventory.linkCount} buttons/links and ${inventory.inputCount + inventory.searchCount} input/search fields. Pick a click or type instead.`,
        )
        if (!isScrollOnlyBatch(retrySteps)) {
          steps = retrySteps
        }
      } catch (err) {
        logger.warn('recorder: re-plan attempt failed', { err })
      }
    }

    // If the planner is still scroll-only despite available interactives,
    // synthesize a deterministic interaction step from the inventory.
    if (hasInteractives && isScrollOnlyBatch(steps)) {
      logger.info('recorder: still scroll-only — injecting deterministic interaction from inventory')
      steps = injectInventoryInteraction(steps, inventory, ctx.understanding.product_name)
    }

    return steps
      .filter((step) => step.action !== 'navigate')
      .slice(0, 6)
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0].slice(0, 140) : String(err).slice(0, 140)
    logger.info(`recorder: live planning failed (${msg}) — using inventory fallback`)
    if (inventory.items.length > 0) {
      return injectInventoryInteraction([], inventory, ctx.understanding.product_name)
    }
    return [
      {
        step: 1,
        action: 'scroll_down',
        description: 'Explore more of the current page',
        narration: `Here is ${ctx.understanding.product_name} in more detail.`,
      },
    ]
  }
}

async function handlePageAfterScene(ctx: StepContext): Promise<void> {
  const currentUrl = ctx.page.url()
  if (!ctx.visitedUrls.includes(currentUrl)) {
    ctx.visitedUrls.push(currentUrl)
    logger.info(`recorder: navigated to new page -> ${currentUrl}`)
    await dismissPopups(ctx.page)
    // Longer dwell so the viewer sees the new page before interactions start
    await ctx.page.waitForTimeout(2000)
  }
  await expandAllowedPaths(ctx.page, ctx.allowedPaths, ctx.productOrigin)
}

/** Sample a fingerprint of the current page for before/after change detection. */
async function samplePageFingerprint(page: Page): Promise<DomFingerprint> {
  try {
    const fp = await page.evaluate(domFingerprintScript)
    return { url: page.url(), nodeCount: fp.nodeCount, textLength: fp.textLength }
  } catch {
    return { url: page.url(), nodeCount: 0, textLength: 0 }
  }
}

/** Patterns we treat as commit triggers when a sibling button sits next to an input. */
const COMMIT_BUTTON_RE = /^(send|submit|search|go|ask|run|generate|enter|create|add|save|continue|→|↵|⏎|🔍)$/i

/**
 * Commits typed input by triggering the most likely "go" affordance:
 *   1. nearest enclosing form's submit button
 *   2. a sibling button matching COMMIT_BUTTON_RE (right of or below the input)
 *   3. chat-style send-icon button when the input is a textarea / chat placeholder
 *   4. Enter key (search-style inputs, default fallback)
 *   5. blur (last resort for forms that validate on blur)
 *
 * Returns the kind of commit that fired so the runtime can log + decide whether
 * to wait on a network response.
 */
async function commitInput(
  page: Page,
  locator: Locator,
  inventory: DomInventory | undefined,
): Promise<'form-submit' | 'sibling-button' | 'enter' | 'blur' | 'skipped'> {
  try {
    // 1. Form ancestor — click its submit button.
    const formSubmit = await locator.evaluate((el): { x: number; y: number } | null => {
      const form = (el as HTMLElement).closest('form')
      if (!form) return null
      const btn = form.querySelector<HTMLElement>('button[type=submit], input[type=submit], button:not([type])')
      if (!btn) return null
      const r = btn.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return null
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }).catch(() => null)
    if (formSubmit) {
      await page.mouse.click(formSubmit.x, formSubmit.y, { delay: 60 }).catch(() => { })
      return 'form-submit'
    }

    // 2. Sibling submit button from inventory — text matches commit pattern AND
    // box sits within 240px right-of or below the input.
    const inputBox = await locator.boundingBox().catch(() => null)
    if (inputBox && inventory) {
      const inputCx = inputBox.x + inputBox.width / 2
      const inputCy = inputBox.y + inputBox.height / 2
      const sibling = inventory.items.find((it: DomInventoryItem) => {
        if (it.kind !== 'button') return false
        if (!COMMIT_BUTTON_RE.test(it.text.trim())) return false
        const dx = it.box.x - inputCx
        const dy = it.box.y - inputCy
        const horizontal = dx > 0 && dx < 240 && Math.abs(dy) < inputBox.height + 40
        const vertical = dy > 0 && dy < 200 && Math.abs(dx) < inputBox.width + 80
        return horizontal || vertical
      })
      if (sibling) {
        await page.mouse.click(sibling.box.x, sibling.box.y, { delay: 60 }).catch(() => { })
        return 'sibling-button'
      }
    }

    // 3-5. Enter key works for search bars, chat inputs, and most forms.
    // Press twice with a short pause — search-as-you-type widgets that
    // debounce a single Enter still respond to a quick double-press.
    await page.keyboard.press('Enter').catch(() => { })
    await page.waitForTimeout(50)
    await page.keyboard.press('Enter').catch(() => { })
    return 'enter'
  } catch {
    try { await locator.blur().catch(() => { }) } catch { /* ignore */ }
    return 'blur'
  }
}

/**
 * Race four signals that confirm a commit produced a visible outcome:
 *   - URL change
 *   - DOM fingerprint delta (≥3 result-bearing nodes OR ≥120 chars text)
 *   - networkidle (gated on a request having actually fired post-commit)
 *   - aria-live region populated (chat replies, inline form confirmations)
 *
 * The ceiling is adaptive: 8s default, 12s when the commit kind is
 * `form-submit` (round-trips to a server, more likely slow) OR a network
 * request fires within the first 1500ms (also implies a server round-trip).
 *
 * Returns the kind of signal that fired (or 'timeout'), the wall-clock ms
 * spent waiting, and whether to dwell long (viewer reads the result) or
 * short (no outcome → don't pad the clip).
 */
async function awaitOutcome(
  page: Page,
  before: DomFingerprint,
  options: { commitKind?: 'form-submit' | 'sibling-button' | 'enter' | 'blur' | 'skipped'; ceilingMs?: number } = {},
): Promise<{ kind: 'url' | 'dom' | 'network' | 'aria-live' | 'timeout'; dwellMs: number; outcomeMs: number }> {
  const start = Date.now()
  const baseCeiling = options.ceilingMs ?? 8000
  const slowCeiling = 12000

  let networkFired = false
  const onRequest = (): void => { networkFired = true }
  page.on('request', onRequest)

  // Adaptive ceiling: form-submit always gets the slow ceiling; otherwise
  // we briefly check whether a request fired in the first 1500ms (which
  // implies a server round-trip), and if so extend to the slow ceiling.
  let ceilingMs = options.commitKind === 'form-submit' ? slowCeiling : baseCeiling
  if (ceilingMs === baseCeiling) {
    await new Promise((r) => setTimeout(r, 1500))
    if (networkFired) ceilingMs = slowCeiling
  }

  const urlChanged = page
    .waitForURL((u) => u.toString() !== before.url, { timeout: ceilingMs })
    .then(() => 'url' as const)
    .catch(() => null)

  const domChanged = page
    .waitForFunction(
      ({ baseline, script }: { baseline: { nodeCount: number; textLength: number }; script: string }) => {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const fn = new Function(`${script}; return domFingerprintScript()`) as () => { nodeCount: number; textLength: number }
        try {
          const fp = fn()
          return Math.abs(fp.nodeCount - baseline.nodeCount) >= 3 || Math.abs(fp.textLength - baseline.textLength) >= 120
        } catch {
          return false
        }
      },
      {
        baseline: { nodeCount: before.nodeCount, textLength: before.textLength },
        script: domFingerprintScript.toString(),
      },
      { timeout: ceilingMs, polling: 250 },
    )
    .then(() => 'dom' as const)
    .catch(() => null)

  const networkIdle = page
    .waitForLoadState('networkidle', { timeout: ceilingMs })
    .then(() => (networkFired ? ('network' as const) : null))
    .catch(() => null)

  // aria-live region populated post-commit. Threshold of 10 chars dodges
  // empty/initial states where aria-live exists but is blank. Chat widgets
  // and form-confirmation toasts almost always fire this signal.
  const ariaLive = page
    .waitForFunction(
      () => Array.from(document.querySelectorAll('[aria-live]:not([aria-live="off"]), [role=status], [role=alert]'))
        .some((n) => ((n as HTMLElement).textContent ?? '').trim().length > 10),
      undefined,
      { timeout: ceilingMs, polling: 250 },
    )
    .then(() => 'aria-live' as const)
    .catch(() => null)

  const winner = await Promise.race([urlChanged, domChanged, networkIdle, ariaLive, new Promise<null>((r) => setTimeout(() => r(null), ceilingMs + 200))])
  page.off('request', onRequest)

  const outcomeMs = Date.now() - start
  if (winner === 'url' || winner === 'dom' || winner === 'network' || winner === 'aria-live') {
    // Random 2.5–3.5s reveal dwell so the viewer can read the result.
    const dwellMs = 2500 + Math.floor(Math.random() * 1000)
    return { kind: winner, dwellMs, outcomeMs }
  }
  // No outcome — short dwell, signal upstream that the beat may need to retry.
  // Log the fingerprint values so we can see what the recorder saw.
  logger.info(`awaitOutcome: timeout after ${outcomeMs}ms (commitKind=${options.commitKind ?? 'n/a'}, networkFired=${networkFired}, before nodes=${before.nodeCount}/text=${before.textLength})`)
  return { kind: 'timeout', dwellMs: 900, outcomeMs }
}

/**
 * Returns true when a click did not change the page in any observable way.
 * Used to skip resetting `scrollOnlyBatches` for inert decorative clicks
 * (close buttons, expand-collapse toggles that don't change the surface).
 *
 * "Same" = identical URL AND no DOM-fingerprint change AND no network request fired
 * AND perceptual-hash similarity > 0.92 (frame essentially unchanged).
 */
function wasDeadInteraction(
  before: DomFingerprint,
  after: DomFingerprint,
  beforeHash: string | undefined,
  afterHash: string | undefined,
  networkFired: boolean,
): boolean {
  if (networkFired) return false
  if (before.url !== after.url) return false
  if (fingerprintsDiffer(before, after)) return false
  if (!beforeHash || !afterHash) return true
  return hashSimilarity(beforeHash, afterHash) > 0.92
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
  inventory?: DomInventory,
): Promise<SceneCapture> {
  const { page, recordingStartTime } = ctx
  const t = () => Date.now() - recordingStartTime
  const sceneStart = t()
  let clipStart = sceneStart
  let targetElement: ElementBox | null = null
  let elementNotFound = false
  let outcomeKind: SceneCapture['outcomeKind']
  let outcomeScreenshotPath: string | undefined
  let clipEndOverrideMs: number | null = null
  let commitKind: SceneCapture['commitKind']
  let outcomeMs: number | undefined

  const shortLabel = step.element_to_click ? ` → "${sanitizeForLog(step.element_to_click, 40)}"` : ''
  logger.info(`recorder step ${stepIndex}: ${step.action}${shortLabel}`)

  try {
    switch (step.action) {
      case 'navigate': {
        if (!step.navigate_to) {
          clipStart = t()
          elementNotFound = true
          break
        }
        const raw = step.navigate_to.trim()
        // Skip in-page anchors — they don't change what's on screen meaningfully
        if (raw.startsWith('#')) {
          clipStart = t()
          elementNotFound = true
          break
        }
        const targetUrl = raw.startsWith('http')
          ? raw
          : new URL(raw, ctx.productUrl).href

        // Forbidden-URL gate: block navigates back to entry/homepage even
        // when allowedPaths permits the URL (the entry IS in allowedPaths).
        // This is the seed-phase counterpart to the click-time gate, and
        // catches anything BeatRunner navigation might propose too.
        const forbiddenKey = urlKey(targetUrl)
        if (forbiddenKey && ctx.forbiddenRevisits.has(forbiddenKey)) {
          logger.warn(`recorder step ${stepIndex}: navigate_to "${targetUrl}" is forbidden — skipping`)
          clipStart = t()
          elementNotFound = true
          break
        }

        // Only navigate to URLs that exist in the discovered siteMap.
        // This prevents Gemini hallucinations from triggering long 404 waits
        // or landing on dead pages that drag out the recording.
        if (ctx.allowedPaths) {
          const sameOrigin = (() => {
            try { return new URL(targetUrl).origin === ctx.productOrigin } catch { return false }
          })()
          if (!sameOrigin || !forbiddenKey || !ctx.allowedPaths.has(forbiddenKey)) {
            logger.warn(`recorder step ${stepIndex}: navigate_to "${targetUrl}" not in siteMap — skipping`)
            clipStart = t()
            elementNotFound = true
            break
          }
        }

        // Mark the page as "loading" so the dark shim covers any white flash
        // before the next page hydrates. The shim auto-fades when we mark
        // ready post-settle.
        await markPageLoading(page)
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {})
        await dismissPopups(page)
        await pageSettle(page, { networkIdleMs: 4000, settleMs: 800 })
        await markPageReady(page)

        // Post-navigate landing check — if a redirect or auth wall dropped
        // us on a forbidden URL anyway, retreat. Catches SPA route guards
        // that 302 to "/" when an unauthenticated user hits an app route.
        const landed = page.url()
        const landedKey = urlKey(landed)
        if (landedKey && ctx.forbiddenRevisits.has(landedKey)) {
          logger.warn(`recorder step ${stepIndex}: navigate landed on forbidden URL ${landed} — going back`)
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => { })
          await pageSettle(page, { networkIdleMs: 2500, settleMs: 500 })
          elementNotFound = true
        }

        // Reset clipStart to AFTER the page has settled. The white loading
        // transition was captured into the MP4 but no clip references it,
        // which keeps mid-video white flashes out of the final cut.
        clipStart = t()
        break
      }

      case 'click': {
        const locator = await findLocator(page, step.element_to_click)
        if (locator) {
          // Skip disabled buttons immediately — Playwright's click() retries
          // for 3 s before timing out, which freezes the recording. We also
          // catch aria-disabled and CSS-disabled elements that isEnabled misses.
          if (!(await isInteractable(locator, 'click'))) {
            logger.info(`recorder step ${stepIndex}: "${sanitizeForLog(step.element_to_click, 40)}" is disabled — skipping click`)
            elementNotFound = true
            break
          }
          // Pre-click href gate: if this is an anchor pointing at a
          // forbidden URL, refuse the click outright. This is the only
          // hard guard against a planner-proposed "click Home" / "click
          // Logo" silently dropping us back on the entry page mid-demo.
          const elemHref = await locator.evaluate((el) => {
            const a = el as HTMLAnchorElement
            return typeof a.href === 'string' ? a.href : null
          }).catch(() => null)
          if (elemHref) {
            const elemKey = urlKey(elemHref)
            if (elemKey && ctx.forbiddenRevisits.has(elemKey)) {
              logger.info(`recorder step ${stepIndex}: skipping click on forbidden href ${elemHref}`)
              elementNotFound = true
              break
            }
          }
          try {
            const box = await locator.boundingBox()
            if (box) {
              targetElement = {
                x: Math.round(box.x + box.width / 2),
                y: Math.round(box.y + box.height / 2),
                width: Math.round(box.width),
                height: Math.round(box.height),
              }
              // Cursor entrance from off-screen → ease to target → 280 ms hover
              // dwell so CSS :hover states paint → click. This is the
              // intentional-interaction signal that reads as a real demo.
              await cursorEntrance(page, targetElement.x, targetElement.y)
              await easedMoveTo(page, targetElement.x, targetElement.y)
              await page.waitForTimeout(280)
            }
            // If the click triggers a navigation, hide the white flash with
            // the shim. markPageReady runs after settle in the post-action wait.
            await markPageLoading(page)
            await locator.click({ timeout: 3000, delay: 60 })
            await pageSettle(page, { networkIdleMs: 3000, settleMs: 600 })
            await markPageReady(page)
            // Post-click forbidden-landing guard: SPA pushState routes can
            // navigate without surfacing an href on the element we clicked.
            // If we landed on a forbidden URL, retreat with goBack() and
            // mark the scene as a no-op so it isn't kept in the final cut.
            const landed = page.url()
            const landedKey = urlKey(landed)
            if (landedKey && ctx.forbiddenRevisits.has(landedKey)) {
              logger.info(`recorder step ${stepIndex}: click landed on forbidden URL ${landed} — going back`)
              await page.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => { })
              await pageSettle(page, { networkIdleMs: 2500, settleMs: 500 })
              elementNotFound = true
            }
          } catch (clickErr) {
            logger.info(`recorder step ${stepIndex}: click failed (${clickErr instanceof Error ? clickErr.message.split('\n')[0] : String(clickErr)})`)
            elementNotFound = true
          }
        } else {
          // Vision-based fallback: screenshot → Gemini → corrected text → retry
          logger.info(`recorder step ${stepIndex}: "${step.element_to_click}" not found, trying vision fallback`)
          const fallback = await visionClickFallback(page, step.element_to_click ?? '')
          if (fallback.locator) {
            if (!(await isInteractable(fallback.locator, 'click'))) {
              logger.info(`recorder step ${stepIndex}: vision fallback resolved to disabled element — skipping`)
              clipStart = t()
              elementNotFound = true
              break
            }
            try {
              clipStart = t()
              if (fallback.elementBox) {
                targetElement = fallback.elementBox
                await cursorEntrance(page, targetElement.x, targetElement.y)
                await easedMoveTo(page, targetElement.x, targetElement.y)
                await page.waitForTimeout(280)
              }
              await markPageLoading(page)
              await fallback.locator.click({ timeout: 3000, delay: 60 })
              await pageSettle(page, { networkIdleMs: 3000, settleMs: 600 })
              await markPageReady(page)
            } catch {
              elementNotFound = true
            }
          } else {
            logger.warn(`recorder step ${stepIndex}: "${step.element_to_click}" not found even after vision fallback`)
            clipStart = t()
            elementNotFound = true
          }
        }
        break
      }

      case 'type': {
        const locator = await findLocator(page, step.element_to_click)
        if (locator) {
          if (!(await isInteractable(locator, 'type'))) {
            logger.info(`recorder step ${stepIndex}: "${sanitizeForLog(step.element_to_click, 40)}" is read-only/disabled — skipping type`)
            elementNotFound = true
            break
          }
          try {
            const box = await locator.boundingBox()
            if (box) {
              targetElement = {
                x: Math.round(box.x + box.width / 2),
                y: Math.round(box.y + box.height / 2),
                width: Math.round(box.width),
                height: Math.round(box.height),
              }
              await cursorEntrance(page, targetElement.x, targetElement.y)
              await easedMoveTo(page, targetElement.x, targetElement.y)
              await page.waitForTimeout(220)
            }
            await locator.click({ timeout: 3000 })
            // Reject placeholder-style type_text; substitute a realistic value.
            let textToType = step.type_text
            if (looksLikePlaceholder(textToType)) {
              textToType = fallbackTypeText(step.element_to_click, ctx.understanding.product_name)
              logger.info(`recorder step ${stepIndex}: type_text looked like a placeholder, substituting "${sanitizeForLog(textToType)}"`)
            }
            const safeText = sanitizeForType(textToType ?? `Try ${ctx.understanding.product_name}`)
            await typeWithJitter(page, safeText.length > 0 ? safeText : `Try ${ctx.understanding.product_name}`)
            // Fire input/change so React-controlled forms register the value
            // and any "submit"/"go" button enables. Without this, the next
            // click step often sees a disabled CTA.
            await fireReactInputEvents(page)
            await page.waitForTimeout(220)

            // Auto-commit + outcome dwell. The single biggest behaviour change
            // in this rewrite: typing without committing leaves the demo
            // stranded in front of an input field; viewers need to SEE the
            // result of what they typed (search results, AI response, form
            // confirmation). When `skipCommit` is set, the planner has
            // explicitly opted out (e.g. for partial form fields).
            if (step.skipCommit !== true) {
              const before = await samplePageFingerprint(page)
              commitKind = await commitInput(page, locator, inventory)
              logger.info(`recorder step ${stepIndex}: commit fired (${commitKind})`)
              const outcome = await awaitOutcome(page, before, { commitKind })
              outcomeKind = outcome.kind
              outcomeMs = outcome.outcomeMs
              logger.info(`recorder step ${stepIndex}: outcome ${outcome.kind} after ${outcome.outcomeMs}ms (dwell ${outcome.dwellMs}ms)`)

              // Modal popups frequently appear after a commit (e.g. "Sign up
              // to see results"). Dismiss before we capture the outcome frame.
              await dismissPopups(page).catch(() => { })

              // Capture the post-commit reveal screenshot — this becomes the
              // canonical frame for caption regeneration on this scene.
              try {
                const buf = await page.screenshot({ type: 'jpeg', quality: 70 })
                outcomeScreenshotPath = path.join(ctx.outputDir, `scene-${String(stepIndex).padStart(3, '0')}-outcome.jpg`)
                fs.writeFileSync(outcomeScreenshotPath, buf)
              } catch (err) {
                logger.warn(`recorder step ${stepIndex}: outcome screenshot failed`, { err })
              }

              await page.waitForTimeout(outcome.dwellMs)
              clipEndOverrideMs = t()
            } else {
              outcomeKind = 'none'
              commitKind = 'skipped'
              await page.waitForTimeout(450)
            }
          } catch {
            elementNotFound = true
          }
        } else {
          clipStart = t()
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
            clipStart = t()
            elementNotFound = true
          }
        } else {
          clipStart = t()
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
    if (!targetElement) clipStart = t()
    elementNotFound = true
  }

  if (elementNotFound) {
    await fallbackVisualMotion(page, stepIndex)
  }

  const minSceneMs = minimumSceneDurationMs(step.action, elementNotFound)
  const remainingMs = minSceneMs - (t() - clipStart)
  if (remainingMs > 0) {
    await page.waitForTimeout(remainingMs)
  }

  // Capture a reference screenshot mid-scene so the post-recording vision
  // narration pass can describe what is actually on screen for this scene.
  // Failure here is non-fatal — the scene still records, just without a
  // reference frame for narration regen.
  let screenshotPath: string | undefined
  let noveltyHash: string | undefined
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 70 })
    screenshotPath = path.join(ctx.outputDir, `scene-${String(stepIndex).padStart(3, '0')}.jpg`)
    fs.writeFileSync(screenshotPath, buf)
    noveltyHash = perceptualHash(buf)
  } catch (err) {
    logger.warn(`recorder step ${stepIndex}: reference screenshot failed`, { err })
  }

  const sceneEnd = t()
  // For type scenes that successfully committed, pin the clip end to the
  // moment the outcome reveal completed — not the typing-finish moment —
  // so the assembler keeps the post-commit reveal frames in the final cut.
  const clipEnd = clipEndOverrideMs != null ? Math.max(clipEndOverrideMs, sceneEnd) : sceneEnd
  return {
    step: stepIndex,
    action: step.action,
    description: step.description,
    narration: step.narration,
    clips: [{ start: Math.min(clipStart, clipEnd), end: clipEnd }],
    targetElement,
    typeText: step.type_text ?? null,
    elementNotFound,
    pageUrl: page.url(),
    screenshotPath,
    noveltyHash,
    beatStepRole: step.beatStepRole,
    outcomeKind,
    outcomeScreenshotPath,
    commitKind,
    outcomeMs,
  }
}

// ─── Main recorder ────────────────────────────────────────────────────────────

/**
 * Records a product demo by executing the pre-planned seed steps, then
 * extending the session with screenshot-grounded live plans until the kept
 * demo clips reach the requested final video length.
 */
export async function recordProduct(
  productUrl: string,
  understanding: ProductUnderstanding,
  jobId: string,
  _credentials?: { username: string; password: string },
  startUrl?: string,
  siteMap: string[] = [],
  targetVideoLength: VideoLength = DEFAULT_VIDEO_LENGTH_SECONDS,
): Promise<string> {
  const outputDir = path.join(RECORDINGS_DIR, jobId)
  fs.mkdirSync(outputDir, { recursive: true })

  // Count interactive elements from the understanding to inform dynamic duration
  const interactiveCount = understanding.demo_flow.filter(
    (s) => s.action === 'click' || s.action === 'type' || s.action === 'hover',
  ).length

  logger.info(`recorder: starting job ${jobId} for ${productUrl}`)
  const targetDemoMs = targetDemoDurationMs(targetVideoLength, siteMap.length, interactiveCount)
  const maxWallClockMs = Math.min(15 * 60_000, targetDemoMs + 8 * 60_000)
  logger.info(
    `recorder: target final length ${targetVideoLength}s -> ${Math.round(targetDemoMs / 1000)}s demo clips`,
  )

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

  // Seed phase REMOVED. Beats are now the SOLE source of demo footage; the
  // recorder lands on the entry URL, captures a tiny intro-hook (one scroll
  // down, one scroll up, ~7s total) so the video opens with brand context,
  // and then enters the BeatRunner while-loop with the full target budget.
  // `understanding.demo_flow` remains on the type for backward compat (the
  // dashboard / status route may still read it) but is never executed.
  logger.info(`recorder: beats-only mode — proposed_beats=${understanding.proposed_beats?.length ?? 0}`)

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
    // Hard settle gate — wait for networkidle, fonts, and animations to finish
    // before any clip windows open. The dark loading shim covers the recording
    // until this point so the leading frames of recording.mp4 are visually
    // clean even though the file's first ~5s are unused preroll.
    await pageSettle(page, { networkIdleMs: 8000, settleMs: 1500 })
    await markPageReady(page)
    const prerollMs = Date.now() - recordingStartTime
    logger.info(`recorder: entry-page settle complete after ${prerollMs}ms total`)

    // Expand the allow-list with links from the live DOM right after landing.
    // This catches SPA routes that Firecrawl/sitemap never found.
    await expandAllowedPaths(page, allowedPaths, productOrigin)

    const scenes: SceneCapture[] = []
    const visitedUrls: string[] = [page.url()]

    // Pre-seed forbidden URLs BEFORE seed steps run. Locking this in early
    // means a homepage-link click during the seed phase (or by the live
    // planner) gets refused at the gate instead of silently dropping us
    // back on landing. We seed the entry URL and any same-origin alias
    // (apex ↔ www) so cross-subdomain home clicks are blocked too.
    const forbiddenRevisits = new Set<string>()
    const entryKey = urlKey(entryUrl)
    if (entryKey) forbiddenRevisits.add(entryKey)
    try {
      const entryHost = new URL(entryUrl).host
      const altHost = entryHost.startsWith('www.') ? entryHost.slice(4) : `www.${entryHost}`
      const altUrl = entryUrl.replace(entryHost, altHost)
      const altKey = urlKey(altUrl)
      if (altKey) forbiddenRevisits.add(altKey)
    } catch { /* ignore */ }

    const ctx: StepContext = {
      page,
      recordingStartTime,
      scenes,
      visitedUrls,
      productUrl,
      understanding,
      allowedPaths,
      productOrigin,
      prerollMs,
      outputDir,
      entryUrl,
      forbiddenRevisits,
    }

    // ── Execute seed steps, then extend with beat-driven live planning ───────
    let stepCounter = 0
    /** Recent novelty hashes — used to detect stuck/looping content. */
    const recentHashes: string[] = []
    /** Recent viewport-entropy distributions, paired index-wise with recentHashes. */
    const recentEntropies: number[][] = []

    /** Pushes a scene to the manifest and updates novelty signal buffers. */
    function pushScene(scene: SceneCapture): void {
      scenes.push(scene)
      if (scene.noveltyHash) {
        recentHashes.push(scene.noveltyHash)
        if (recentHashes.length > 4) recentHashes.shift()
      }
      if (scene.screenshotPath) {
        try {
          const buf = fs.readFileSync(scene.screenshotPath)
          recentEntropies.push(viewportEntropy(buf))
          if (recentEntropies.length > 4) recentEntropies.shift()
        } catch { /* ignore */ }
      }
    }

    // ── Intro-hook pass ──────────────────────────────────────────────────────
    // A tiny landing-page intro (~7s) so the video opens with brand context
    // before diving into beats. Two scrolls with `beatId: 'intro-hook'` and
    // `beatStepRole: 'open'`. Generates ~7s of footage; the BeatRunner gets
    // ~136s of the ~143s target budget.
    const introScrollDown: DemoStep = {
      step: 1,
      action: 'scroll_down',
      description: 'Reveal the hero section',
      narration: `Meet ${understanding.product_name}.`,
      beatStepRole: 'open',
    }
    const introScrollUp: DemoStep = {
      step: 2,
      action: 'scroll_up',
      description: 'Return to the top',
      narration: understanding.tagline.length < 80 ? understanding.tagline : `${understanding.product_name} — built for what you need.`,
      beatStepRole: 'open',
    }
    const intro1 = await captureStep(ctx, introScrollDown, ++stepCounter)
    intro1.beatId = 'intro-hook'
    pushScene(intro1)
    await handlePageAfterScene(ctx)
    if (capturedClipDurationMs(scenes) < targetDemoMs && Date.now() - recordingStartTime < maxWallClockMs) {
      const intro2 = await captureStep(ctx, introScrollUp, ++stepCounter)
      intro2.beatId = 'intro-hook'
      pushScene(intro2)
      await handlePageAfterScene(ctx)
    }

    // ── Beat-driven live phase ───────────────────────────────────────────────
    // The recorder now runs a queue of BEATS — each beat is one complete
    // open→setup→commit→reveal demonstration of a single capability. Beats
    // come from the model's `proposed_beats` and (when the queue empties)
    // from adaptive `proposeBeat` calls keyed to the current page.
    const beatQueue: DemoBeat[] = (understanding.proposed_beats ?? []).map((b) => ({ ...b, status: 'pending', attempts: 0, steps: [] }))
    const completedBeats: DemoBeat[] = []
    let endReason: 'queue-empty' | 'stuck' | 'live-batch-cap' | 'wall-clock-cap' | 'target-met' = 'target-met'
    logger.info(`recorder: beat queue seeded with ${beatQueue.length} beats from understanding`)

    /** Loop detection: tighter than the prior 0.85 / 3-consecutive thresholds.
     *  We declare "stuck" when the last 2 hashes are >0.78 similar AND the
     *  entropy distributions are within KL < 0.05 of each other. Two signals
     *  guards against a single noisy hash collision. */
    function looksStuck(): boolean {
      if (recentHashes.length < 2) return false
      const a = recentHashes[recentHashes.length - 1]
      const b = recentHashes[recentHashes.length - 2]
      if (hashSimilarity(a, b) <= 0.78) return false
      if (recentEntropies.length < 2) return true // hash-only confirmation
      const ea = recentEntropies[recentEntropies.length - 1]
      const eb = recentEntropies[recentEntropies.length - 2]
      return klDivergence(ea, eb) < 0.05
    }

    /** Validate a planned beat — every commit-bearing goal must produce a
     *  commit step the runtime will actually fire on. Returns a hint string
     *  on failure (used to drive a single re-plan retry). */
    function validatePlanForBeat(steps: DemoStep[], beat: DemoBeat, inv: DomInventory): string | null {
      if (steps.length === 0) return 'plan returned 0 steps — produce at least one'
      const goalsRequiringCommit: DemoBeat['goal'][] = ['search', 'form_submit', 'chat_send', 'configure_and_run']
      if (goalsRequiringCommit.includes(beat.goal)) {
        const hasCommit = steps.some((s) => s.beatStepRole === 'commit' || s.action === 'type')
        if (!hasCommit) return `beat goal "${beat.goal}" requires a commit step — include a type or a click on a Submit/Send/Search button`
      }
      // Every element_to_click must come from the (filtered) inventory.
      const allowedTexts = new Set(inv.items.map((it) => it.text))
      for (const s of steps) {
        if (s.action === 'click' || s.action === 'type' || s.action === 'hover') {
          if (s.element_to_click && !allowedTexts.has(s.element_to_click)) {
            return `step references "${sanitizeForLog(s.element_to_click, 50)}" which is not in the inventory — pick from the listed elements`
          }
        }
      }
      return null
    }

    const MAX_LIVE_BATCHES = 12
    let liveBatch = 0

    /** Execute one beat end-to-end. Returns true when work was captured. */
    async function runOneBeat(beat: DemoBeat): Promise<boolean> {
      beat.status = 'active'
      beat.attempts++
      logger.info(`recorder: running beat ${beat.id} (${beat.goal}) attempt ${beat.attempts} — outcome: ${beat.outcomeDescription}`)

      // Navigate to the beat's target page if specified and allowed.
      if (beat.targetUrl) {
        const key = urlKey(beat.targetUrl)
        const onSamePage = key && urlKey(page.url()) === key
        if (!onSamePage && key && !ctx.forbiddenRevisits.has(key)) {
          const navStep: DemoStep = {
            step: stepCounter + 1,
            action: 'navigate',
            description: `Open ${(() => { try { return new URL(beat.targetUrl!).pathname } catch { return beat.targetUrl! } })()}`,
            narration: `Inside ${understanding.product_name} now.`,
            navigate_to: beat.targetUrl,
            beatStepRole: 'open',
          }
          const navScene = await captureStep(ctx, navStep, ++stepCounter)
          navScene.beatId = beat.id
          pushScene(navScene)
          await handlePageAfterScene(ctx)
        }
      }

      // Scan + filter the inventory. The filter strips items whose
      // resolvedHref points at a forbidden destination, so the planner
      // literally cannot suggest "click Home".
      const rawInventory = await scanDomInventory(page)
      const inventory = filterInventory(rawInventory, ctx.forbiddenRevisits, (u) => urlKey(u) ?? u)
      logger.info(
        `recorder: beat ${beat.id} inventory ${inventory.buttonCount}b/${inventory.linkCount}l/${inventory.inputCount}i/${inventory.searchCount}s ` +
        `(${rawInventory.items.length - inventory.items.length} filtered as forbidden)`,
      )

      // Plan via vision; validate; one retry on rejection.
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 70 })
      let steps = await planBeatSteps(beat, screenshot.toString('base64'), page.url(), understanding.product_name, understanding, inventory)
      let rejection = validatePlanForBeat(steps, beat, inventory)
      if (rejection) {
        logger.info(`recorder: beat ${beat.id} plan rejected (${rejection}) — retrying once`)
        steps = await planBeatSteps(beat, screenshot.toString('base64'), page.url(), understanding.product_name, understanding, inventory, rejection)
        rejection = validatePlanForBeat(steps, beat, inventory)
        if (rejection) {
          logger.info(`recorder: beat ${beat.id} plan rejected twice (${rejection}) — abandoning`)
          beat.status = 'abandoned'
          completedBeats.push(beat)
          return false
        }
      }

      // Execute the planned steps. Auto-commit + outcome dwell live in case
      // 'type' inside captureStep, so the runtime captures the reveal even
      // when the planner only emitted a single type step.
      let producedAchievement = false
      for (const s of steps) {
        if (capturedClipDurationMs(scenes) >= targetDemoMs) break
        if (Date.now() - recordingStartTime >= maxWallClockMs) break
        const scene = await captureStep(ctx, s, ++stepCounter, inventory)
        scene.beatId = beat.id
        pushScene(scene)
        await handlePageAfterScene(ctx)
        if (scene.outcomeKind === 'url' || scene.outcomeKind === 'dom' || scene.outcomeKind === 'network') {
          producedAchievement = true
          beat.outcomeScreenshotPath = scene.outcomeScreenshotPath
        }
      }

      // Beats that don't require a commit (open_feature, navigate_explore)
      // are achieved as long as something visible happened; we approximate
      // that by checking whether at least one step landed without elementNotFound.
      if (!producedAchievement) {
        const trailing = scenes[scenes.length - 1]
        if (trailing?.beatId === beat.id && !trailing.elementNotFound && (beat.goal === 'open_feature' || beat.goal === 'navigate_explore')) {
          producedAchievement = true
        }
      }

      if (producedAchievement) {
        beat.status = 'achieved'
        completedBeats.push(beat)
        logger.info(`recorder: beat ${beat.id} (${beat.goal}) → status=achieved achieved=true attempts=${beat.attempts}`)
        return true
      }

      if (beat.attempts >= 2) {
        beat.status = 'abandoned'
        completedBeats.push(beat)
        logger.info(`recorder: beat ${beat.id} (${beat.goal}) → status=abandoned achieved=false attempts=${beat.attempts}`)
        return false
      }

      // Re-queue for one more attempt.
      beat.status = 'pending'
      logger.info(`recorder: beat ${beat.id} (${beat.goal}) → status=requeued achieved=false attempts=${beat.attempts}`)
      beatQueue.unshift(beat)
      return false
    }

    while (capturedClipDurationMs(scenes) < targetDemoMs) {
      if (Date.now() - recordingStartTime >= maxWallClockMs) {
        logger.warn(`recorder: hit wall-clock cap with ${Math.round(capturedClipDurationMs(scenes) / 1000)}s clips`)
        endReason = 'wall-clock-cap'
        break
      }
      if (liveBatch >= MAX_LIVE_BATCHES) {
        logger.info('recorder: hit live planning batch cap — ending cleanly')
        endReason = 'live-batch-cap'
        break
      }
      if (looksStuck()) {
        logger.info('recorder: novelty + entropy signals say stuck — ending cleanly')
        endReason = 'stuck'
        break
      }

      liveBatch++
      let beat = beatQueue.shift()
      if (!beat) {
        // Adaptive proposal — if the page has any demo-worthy interactives
        // we propose one fresh beat keyed to it. If proposeBeat returns null,
        // there's nothing more to demo and we end cleanly (per plan: "queue
        // empty + no new beat proposed → ending cleanly").
        const inv = await scanDomInventory(page)
        const proposed = await proposeBeat(page.url(), understanding.product_name, understanding, filterInventory(inv, ctx.forbiddenRevisits, (u) => urlKey(u) ?? u))
        if (!proposed) {
          logger.info('recorder: beat queue empty + no new beat proposed → ending cleanly')
          endReason = 'queue-empty'
          break
        }
        beat = proposed
        logger.info(`recorder: adaptively proposed beat ${beat.id} (${beat.goal}) on ${page.url()}`)
      }

      await runOneBeat(beat)
    }

    await page.waitForTimeout(800)

    const wallClockMs = Date.now() - recordingStartTime
    const clipMs = capturedClipDurationMs(scenes)
    logger.info(
      `recorder: ${scenes.length} scenes / ${visitedUrls.length} URLs / ${Math.round(clipMs / 1000)}s clips / ${Math.round(wallClockMs / 1000)}s wall-clock`,
    )
    logger.info(`recorder: URLs visited: ${visitedUrls.join(' -> ')}`)

    // ── Finalise recording ────────────────────────────────────────────────────
    // Closing the context tells Playwright to finish writing the WebM.
    const webmPath = await page.video()!.path()
    await context.close()

    // Convert WebM → CFR MP4. This is an INTERMEDIATE — the final Remotion
    // render does its own re-encode at high quality. Use a fast preset here
    // so the conversion takes ~30 s instead of 4 min for a 100 s recording.
    // The source is screen capture (low-motion, easy to encode).
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
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
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

    const achievedCount = completedBeats.filter((b) => b.status === 'achieved').length
    const abandonedCount = completedBeats.filter((b) => b.status === 'abandoned').length
    const typeScenes = scenes.filter((s) => s.action === 'type')
    const typesTotal = typeScenes.length
    const typesWithOutcome = typeScenes.filter((s) => s.outcomeKind === 'url' || s.outcomeKind === 'dom' || s.outcomeKind === 'network' || s.outcomeKind === 'aria-live').length
    const diagnostics: RecordingDiagnostics = {
      beatsAchieved: achievedCount,
      beatsAbandoned: abandonedCount,
      typesTotal,
      typesWithOutcome,
      endReason,
    }
    logger.info(
      `recorder: beats achieved=${achievedCount}/${completedBeats.length}, types-with-outcome=${typesWithOutcome}/${typesTotal}, endReason=${endReason}`,
    )

    const manifest: RecordingManifest = {
      productUrl: entryUrl,
      productName: understanding.product_name,
      tagline: understanding.tagline,
      totalScenes: scenes.length,
      scenes,
      prerollMs,
      beats: completedBeats,
      diagnostics,
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
