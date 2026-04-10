import fs from 'fs'
import path from 'path'
import os from 'os'
import { chromium, type Page, type ElementHandle } from 'playwright'
import { logger } from '../lib/logger'
import type { ClickEvent, ScrollEvent, ProductUnderstanding, DemoStep } from '../types'

const RECORDINGS_DIR = path.join(os.tmpdir(), 'teaser-recordings')

/** Full HD resolution for crisp, premium output */
const VIDEO_WIDTH = 1920
const VIDEO_HEIGHT = 1080

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/**
 * CSS injected into every page to hide intrusive overlays.
 * Does NOT kill animations — we want sites to look natural.
 */
const POPUP_HIDE_CSS = `
  [class*="cookie"], [class*="Cookie"],
  [id*="cookie"], [id*="Cookie"],
  [class*="consent"], [class*="Consent"],
  [class*="chat-widget"], [class*="intercom"],
  [class*="crisp"], [class*="drift"],
  [class*="gdpr"], [class*="GDPR"],
  [id*="chat-widget"], [id*="intercom-frame"] {
    display: none !important;
  }
`

/**
 * CSS for the animated custom cursor injected into every recorded page.
 * A visible glowing cursor that slides smoothly between targets and
 * pulses on click — all baked into the Playwright recording.
 */
const CUSTOM_CURSOR_CSS = `
  #__teaser_cursor__ {
    position: fixed !important;
    width: 22px !important;
    height: 22px !important;
    border-radius: 50% !important;
    background: rgba(255, 255, 255, 0.92) !important;
    border: 2px solid rgba(255, 255, 255, 1) !important;
    box-shadow:
      0 0 0 3px rgba(99, 102, 241, 0.55),
      0 0 14px rgba(99, 102, 241, 0.45),
      0 2px 8px rgba(0, 0, 0, 0.5) !important;
    pointer-events: none !important;
    z-index: 2147483647 !important;
    transform: translate(-50%, -50%) scale(1) !important;
    transition:
      left 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      top 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      transform 0.15s ease,
      box-shadow 0.15s ease !important;
    left: 960px !important;
    top: 540px !important;
  }
  #__teaser_cursor__.clicking {
    transform: translate(-50%, -50%) scale(0.58) !important;
    box-shadow:
      0 0 0 14px rgba(99, 102, 241, 0.18),
      0 0 28px rgba(99, 102, 241, 0.65),
      0 2px 8px rgba(0, 0, 0, 0.5) !important;
  }
  .teaser-ripple {
    position: fixed !important;
    border-radius: 50% !important;
    background: transparent !important;
    border: 2px solid rgba(255, 255, 255, 0.75) !important;
    pointer-events: none !important;
    z-index: 2147483646 !important;
    transform: translate(-50%, -50%) !important;
    animation: teaser-ripple-anim 0.72s ease-out forwards !important;
  }
  @keyframes teaser-ripple-anim {
    from { width: 0px; height: 0px; opacity: 0.85; }
    to   { width: 110px; height: 110px; opacity: 0; }
  }
  .teaser-trail {
    position: fixed !important;
    border-radius: 50% !important;
    background: rgba(99, 102, 241, 0.5) !important;
    pointer-events: none !important;
    z-index: 2147483644 !important;
    transform: translate(-50%, -50%) !important;
    animation: teaser-trail-anim 0.55s ease-out forwards !important;
  }
  @keyframes teaser-trail-anim {
    0%   { width: 10px; height: 10px; opacity: 0.65; }
    100% { width: 3px;  height: 3px;  opacity: 0; }
  }
`

/**
 * CSS for the keystroke HUD — a pill badge shown at the bottom of the screen
 * whenever the recorder types text into a form field. Baked into the recording.
 */
const KEYSTROKE_HUD_CSS = `
  #__teaser_kbd__ {
    position: fixed !important;
    bottom: 80px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    background: rgba(0, 0, 0, 0.82) !important;
    border: 1px solid rgba(255, 255, 255, 0.18) !important;
    border-radius: 10px !important;
    padding: 10px 24px !important;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace !important;
    font-size: 22px !important;
    color: #ffffff !important;
    letter-spacing: 0.05em !important;
    white-space: nowrap !important;
    opacity: 0 !important;
    transition: opacity 0.18s ease !important;
    pointer-events: none !important;
    z-index: 2147483645 !important;
    backdrop-filter: blur(8px) !important;
    -webkit-backdrop-filter: blur(8px) !important;
    max-width: 900px !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }
  #__teaser_kbd__.visible {
    opacity: 1 !important;
  }
`

/**
 * Init script injected before any page JS runs.
 * Uses a MutationObserver to inject a dark loading overlay as soon as
 * document.body exists — preventing any white flash from being recorded.
 * The overlay is faded out programmatically once the page is ready.
 */
const INIT_OVERLAY_SCRIPT = `
  (function() {
    var OVERLAY_ID = '__teaser_loading__';
    var STYLE_ID   = '__teaser_loading_style__';

    function injectOverlay() {
      if (!document.head && !document.body) return;

      if (document.head && !document.getElementById(STYLE_ID)) {
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent =
          'html,body{background:#080614!important}' +
          '#' + OVERLAY_ID + '{' +
            'position:fixed!important;inset:0!important;' +
            'background:#080614!important;' +
            'z-index:2147483648!important;' +
            'transition:opacity 1.2s ease!important;' +
          '}';
        document.head.prepend(s);
      }

      if (document.body && !document.getElementById(OVERLAY_ID)) {
        var d = document.createElement('div');
        d.id = OVERLAY_ID;
        document.body.prepend(d);
        obs.disconnect();
      }
    }

    var obs = new MutationObserver(injectOverlay);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    injectOverlay();
  })();
`

/**
 * Fades out and removes the loading overlay once the page is ready.
 * Uses a short 0.4s fade so the recording shows minimal dark-screen time.
 */
async function fadeOutOverlay(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const d = document.getElementById('__teaser_loading__') as HTMLElement | null
      const s = document.getElementById('__teaser_loading_style__') as HTMLStyleElement | null
      if (d) {
        d.style.transition = 'opacity 0.4s ease'
        d.style.opacity = '0'
        setTimeout(() => { d.remove(); s?.remove() }, 500)
      }
    })
    await page.waitForTimeout(550)
  } catch {
    // Non-fatal
  }
}

/**
 * Injects the custom cursor and keystroke HUD elements into the page.
 * Idempotent — safe to call after every navigation.
 */
async function injectCustomCursor(page: Page): Promise<void> {
  try {
    await page.addStyleTag({ content: POPUP_HIDE_CSS + CUSTOM_CURSOR_CSS + KEYSTROKE_HUD_CSS })
    await page.evaluate(() => {
      if (!document.getElementById('__teaser_cursor__')) {
        const cursor = document.createElement('div')
        cursor.id = '__teaser_cursor__'
        document.body.appendChild(cursor)
      }
      if (!document.getElementById('__teaser_kbd__')) {
        const hud = document.createElement('div')
        hud.id = '__teaser_kbd__'
        document.body.appendChild(hud)
      }
    })
  } catch {
    // Non-fatal — page may have navigated mid-inject
  }
}

/**
 * Smoothly moves the custom cursor to the given page coordinates and
 * spawns fading trail dots along the movement path for a motion-trail effect.
 * Waits 300ms for the CSS transition to play out in the recording.
 */
async function moveCursorTo(page: Page, x: number, y: number): Promise<void> {
  try {
    await page.evaluate(
      ({ px, py }: { px: number; py: number }) => {
        const cursor = document.getElementById('__teaser_cursor__') as HTMLElement | null
        if (!cursor) return

        const prevLeft = parseFloat(cursor.style.left || '960')
        const prevTop  = parseFloat(cursor.style.top  || '540')
        const dx = px - prevLeft
        const dy = py - prevTop
        const dist = Math.sqrt(dx * dx + dy * dy)

        // Spawn 3 trail dots at 25%, 50%, 75% of the path for long moves
        if (dist > 60) {
          for (let i = 1; i <= 3; i++) {
            const tx = prevLeft + dx * (i / 4)
            const ty = prevTop  + dy * (i / 4)
            const dot = document.createElement('div')
            dot.className = 'teaser-trail'
            dot.style.left = `${tx}px`
            dot.style.top  = `${ty}px`
            dot.style.width  = `${10 - i * 2}px`
            dot.style.height = `${10 - i * 2}px`
            document.body.appendChild(dot)
            setTimeout(() => dot.remove(), 350 + i * 60)
          }
        }

        cursor.style.left = `${px}px`
        cursor.style.top  = `${py}px`
      },
      { px: x, py: y }
    )
    await page.waitForTimeout(300)
  } catch {
    // Non-fatal
  }
}

/**
 * Triggers the click-pulse and ripple animation on the cursor element.
 */
async function triggerClickAnimation(page: Page, x: number, y: number): Promise<void> {
  try {
    await page.evaluate(
      ({ px, py }: { px: number; py: number }) => {
        const cursor = document.getElementById('__teaser_cursor__') as HTMLElement | null
        if (cursor) {
          cursor.classList.add('clicking')
          setTimeout(() => cursor.classList.remove('clicking'), 420)
        }
        const ripple = document.createElement('div')
        ripple.className = 'teaser-ripple'
        ripple.style.left = `${px}px`
        ripple.style.top  = `${py}px`
        document.body.appendChild(ripple)
        setTimeout(() => ripple.remove(), 820)
      },
      { px: x, py: y }
    )
  } catch {
    // Non-fatal
  }
}

/**
 * Shows the keystroke HUD with the given text, then auto-hides after 1.5s.
 * Called before keyboard.type() so the text is visible during the recording.
 */
async function showKeystroke(page: Page, text: string): Promise<void> {
  try {
    await page.evaluate((txt: string) => {
      const hud = document.getElementById('__teaser_kbd__') as HTMLElement | null
      if (!hud) return
      hud.textContent = txt
      hud.classList.add('visible')
      // Clear any pending hide timer
      const prev = (hud as HTMLElement & { __teaser_hide__?: ReturnType<typeof setTimeout> }).__teaser_hide__
      if (prev) clearTimeout(prev)
      ;(hud as HTMLElement & { __teaser_hide__?: ReturnType<typeof setTimeout> }).__teaser_hide__ =
        setTimeout(() => {
          hud.classList.remove('visible')
          setTimeout(() => { hud.textContent = '' }, 200)
        }, 1500)
    }, text)
  } catch {
    // Non-fatal
  }
}

async function findElement(
  page: Page,
  selector: string | undefined
): Promise<{ x: number, y: number } | null> {
  if (!selector) return null

  // Inject a robust client-side fuzzy finder that ignores invisible elements 
  // and returns the exact coordinates of the best visual match.
  try {
    const result = await page.evaluate(
      (targetText: string): { x: number, y: number } | null => {
        targetText = targetText.toLowerCase().trim()

        const elements = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input, select, textarea, label'))
        let bestMatch: HTMLElement | null = null
        let bestScore = -1

        for (const el of elements as HTMLElement[]) {
          const style = window.getComputedStyle(el)
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue
          const rect = el.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0 || rect.top < 0 || rect.left < 0) continue

          const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').toLowerCase().trim()
          if (!text) continue

          if (text === targetText) {
             bestMatch = el
             bestScore = 1000 // Exact match bypass
             break
          }

          if (text.includes(targetText) && targetText.length >= 2) {
             const score = 100 - (text.length - targetText.length)
             if (score > bestScore) {
                 bestScore = score
                 bestMatch = el
             }
          }
        }

        if (bestMatch && bestScore > 0) {
           bestMatch.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' })
           const rect = bestMatch.getBoundingClientRect()
           return {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2)
           }
        }
        return null
      },
      selector
    )

    if (result) {
       logger.info(`findElement: found "${selector}" via fuzzy DOM search at [${result.x}, ${result.y}]`)
       await page.waitForTimeout(300) // allow scroll to settle
       return result
    }
  } catch (e) {
     logger.warn(`findElement: fuzzy DOM search error`, { e })
  }

  // Final fallback using rough Playwright locators mapped to coordinates
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, 'i')
  const locatorStrategies = [
    page.getByRole('button',   { name: re }),
    page.getByRole('link',     { name: re }),
    page.locator('button',         { hasText: re }),
    page.locator('a',              { hasText: re }),
    page.getByText(selector, { exact: false })
  ]

  for (const locator of locatorStrategies) {
    try {
      const first = locator.first()
      await first.waitFor({ state: 'visible', timeout: 800 })
      const box = await first.boundingBox()
      if (box) {
         logger.info(`findElement: found "${selector}" via fallback locator`)
         await first.scrollIntoViewIfNeeded()
         return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
      }
    } catch { continue }
  }

  logger.warn(`findElement: could not find "${selector}" with any strategy`)
  return null
}

/**
 * Common browser launch args (shared between login context and recording context).
 */
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-web-security',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--force-color-profile=srgb',
  '--enable-smooth-scrolling',
  '--font-render-hinting=none',
]

/**
 * Performs login in a SEPARATE non-recording browser context, then saves the
 * full session state (cookies + localStorage) to a JSON file.
 *
 * Key design choices:
 * - Uses a headless browser with NO video recording so login is never captured.
 * - Explicitly bypasses Google/SSO buttons: looks for "sign in with email" toggles
 *   and clicks them to reveal the email/password form.
 * - Uses locator.fill() (not keyboard.type) so credentials are entered reliably
 *   even on autofill-protected inputs.
 * - Returns the path to the saved state file, or null on failure.
 */
async function performLoginAndSaveState(
  productUrl: string,
  credentials: { username: string; password: string },
  stateFilePath: string
): Promise<boolean> {
  logger.info('browserRecorder.login: starting login in non-recording context')
  const browser = await chromium.launch({ headless: true, args: BROWSER_ARGS })

  try {
    const context = await browser.newContext({
      viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      userAgent: USER_AGENT,
    })
    const page = await context.newPage()

    // ── Step 1: Find the login page ──
    // Try to find a login link on the main page first, then fall back to common paths.
    await page.goto(productUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})

    let loginUrl: string | null = null

    // Look for a login/sign-in link in the nav
    const loginLinkLocators = [
      page.getByRole('link', { name: /^log.?in$/i }),
      page.getByRole('link', { name: /^sign.?in$/i }),
      page.getByRole('button', { name: /^log.?in$/i }),
      page.getByRole('button', { name: /^sign.?in$/i }),
    ]
    for (const loc of loginLinkLocators) {
      try {
        await loc.first().waitFor({ state: 'visible', timeout: 2000 })
        const href = await loc.first().getAttribute('href')
        if (href) {
          loginUrl = href.startsWith('http') ? href : new URL(href, productUrl).href
          logger.info(`browserRecorder.login: found login link → ${loginUrl}`)
          break
        }
      } catch { continue }
    }

    // If no login link found, try common paths
    if (!loginUrl) {
      const commonPaths = ['/login', '/signin', '/sign-in', '/auth/login', '/auth/signin', '/account/login', '/user/login']
      for (const p of commonPaths) {
        const url = new URL(p, productUrl).href
        try {
          const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 8000 })
          if (res?.ok()) {
            loginUrl = url
            logger.info(`browserRecorder.login: found login page at ${loginUrl}`)
            break
          }
        } catch { continue }
      }
    }

    if (loginUrl) {
      await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {})
    }

    await page.waitForTimeout(1000)

    // ── Step 2: Bypass Google/SSO — reveal email+password form ──
    // Many sites default to "Continue with Google". Click "sign in with email" to
    // get to the email/password form instead of triggering OAuth.
    const emailTogglePhrases = [
      /sign.?in with email/i,
      /continue with email/i,
      /log.?in with email/i,
      /use email/i,
      /use email.*password/i,
      /email.*password/i,
    ]
    for (const phrase of emailTogglePhrases) {
      try {
        const toggle = page.getByRole('button', { name: phrase })
          .or(page.getByRole('link', { name: phrase }))
          .or(page.getByText(phrase, { exact: false }))
        await toggle.first().waitFor({ state: 'visible', timeout: 2000 })
        await toggle.first().click()
        await page.waitForTimeout(1000)
        logger.info(`browserRecorder.login: clicked email toggle`)
        break
      } catch { continue }
    }

    // ── Step 3: Fill email / username ──
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[autocomplete="email"]',
      'input[autocomplete="username"]',
      'input[name="username"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="username" i]',
      'input[type="text"]',
    ]

    let emailFilled = false
    for (const sel of emailSelectors) {
      try {
        const field = page.locator(sel).first()
        await field.waitFor({ state: 'visible', timeout: 2000 })
        await field.click()
        await field.fill('')
        await field.fill(credentials.username)
        emailFilled = true
        logger.info(`browserRecorder.login: filled email with selector "${sel}"`)
        break
      } catch { continue }
    }

    if (!emailFilled) {
      logger.warn('browserRecorder.login: could not find email field — login skipped')
      return false
    }

    // Some sites show email and password on separate steps (e.g. click Next first)
    // Try to click a "Next" / "Continue" button between the two fields
    const nextButtonPatterns = [/^next$/i, /^continue$/i, /^proceed$/i]
    for (const pattern of nextButtonPatterns) {
      try {
        const btn = page.getByRole('button', { name: pattern }).first()
        await btn.waitFor({ state: 'visible', timeout: 1500 })
        await btn.click()
        await page.waitForTimeout(800)
        logger.info('browserRecorder.login: clicked intermediate Next button')
        break
      } catch { continue }
    }

    // ── Step 4: Fill password ──
    try {
      const passwordField = page.locator('input[type="password"]').first()
      await passwordField.waitFor({ state: 'visible', timeout: 5000 })
      await passwordField.click()
      await passwordField.fill('')
      await passwordField.fill(credentials.password)
      logger.info('browserRecorder.login: filled password')
    } catch {
      logger.warn('browserRecorder.login: could not find password field — login skipped')
      return false
    }

    // ── Step 5: Submit ──
    const submitLocators = [
      page.locator('button[type="submit"]').first(),
      page.getByRole('button', { name: /^log.?in$/i }).first(),
      page.getByRole('button', { name: /^sign.?in$/i }).first(),
      page.getByRole('button', { name: /^continue$/i }).first(),
      page.getByRole('button', { name: /^submit$/i }).first(),
    ]
    for (const btn of submitLocators) {
      try {
        await btn.waitFor({ state: 'visible', timeout: 2000 })
        await btn.click()
        logger.info('browserRecorder.login: submitted login form')
        break
      } catch { continue }
    }

    // Wait for redirect after login
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(2000)

    // ── Step 6: Save session ──
    await context.storageState({ path: stateFilePath })
    logger.info(`browserRecorder.login: session saved → ${stateFilePath}`)
    return true

  } catch (err) {
    logger.warn('browserRecorder.login: login failed', { error: err })
    return false
  } finally {
    await browser.close()
  }
}

/**
 * Executes a single demo step action on the page.
 * Records click coordinates for post-processing zoom effects.
 * Records scroll depth and navigation events for visual overlays.
 * Animates the custom cursor to each target before interacting.
 */
async function executeStep(
  page: Page,
  step: DemoStep,
  stepIndex: number,
  productUrl: string,
  clickEvents: ClickEvent[],
  startTime: number,
  scrollEvents: ScrollEvent[]
): Promise<void> {
  const elapsed = (Date.now() - startTime) / 1000
  const actionName = step.action

  try {
    switch (actionName) {
      case 'scroll_down': {
        await page.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' }))
        await page.waitForTimeout(1500)
        const scrollPct = await page.evaluate(() => {
          const h = document.documentElement.scrollHeight - window.innerHeight
          return h > 0 ? Math.min(1, window.scrollY / h) : 0
        }).catch(() => 0)
        scrollEvents.push({ timestamp: elapsed, scrollPercent: scrollPct })
        break
      }

      case 'scroll_up': {
        await page.evaluate(() => window.scrollBy({ top: -500, behavior: 'smooth' }))
        await page.waitForTimeout(1500)
        const scrollPct = await page.evaluate(() => {
          const h = document.documentElement.scrollHeight - window.innerHeight
          return h > 0 ? Math.min(1, window.scrollY / h) : 0
        }).catch(() => 0)
        scrollEvents.push({ timestamp: elapsed, scrollPercent: scrollPct })
        break
      }

      case 'navigate': {
        // Record the navigation timestamp before the page changes
        clickEvents.push({ x: 0, y: 0, timestamp: elapsed, action: 'navigate' })
        const targetUrl = step.navigate_to?.startsWith('http')
          ? step.navigate_to
          : new URL(step.navigate_to || '', productUrl).href
        
        // Skip navigation to auth-related URLs entirely
        if (/(login|signin|sign-in|signup|sign-up|auth|register|oauth|sso)/i.test(targetUrl)) {
          logger.warn(`browserRecorder: step ${stepIndex} — skipping navigation to auth URL: ${targetUrl}`)
          break
        }
        
        // FREEZE frames during navigation to prevent white/black flash
        // The frame writer will keep repeating the last good frame
        ;(page as any).__teaser_navigating__ = true
        await page.goto(targetUrl, {
          waitUntil: 'networkidle',
          timeout: 20000,
        }).catch(() => {})
        await page.waitForTimeout(1200)
        await fadeOutOverlay(page)
        await injectCustomCursor(page)
        // Wait for page to be visually stable before unfreezing
        await page.waitForTimeout(500)
        ;(page as any).__teaser_navigating__ = false
        break
      }

      case 'click': {
        if (!step.element_to_click) break

        try {
          const target = await findElement(page, step.element_to_click)
          if (target) {
            clickEvents.push({ x: target.x, y: target.y, timestamp: elapsed, action: 'click' })
            await moveCursorTo(page, target.x, target.y)
            await page.waitForTimeout(350)
            await triggerClickAnimation(page, target.x, target.y)
            await page.mouse.click(target.x, target.y, { delay: 150 })
            logger.info(`browserRecorder: step ${stepIndex} — clicked "${step.element_to_click}"`)
          } else {
            logger.warn(`browserRecorder: step ${stepIndex} — could not find "${step.element_to_click}" to click`)
          }

          await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
          await page.waitForTimeout(1500)
          await injectCustomCursor(page)

        } catch (err) {
          logger.warn(`browserRecorder: step ${stepIndex} — click error for "${step.element_to_click}"`, { err })
        }
        break
      }

      case 'hover': {
        const target = await findElement(page, step.element_to_click)
        if (target) {
          clickEvents.push({ x: target.x, y: target.y, timestamp: elapsed, action: 'hover' })
          await moveCursorTo(page, target.x, target.y)
          await page.waitForTimeout(300)
          await page.mouse.move(target.x, target.y)
          await page.waitForTimeout(2000)
        }
        break
      }

      case 'type': {
        const target = await findElement(page, step.element_to_click)
        if (target) {
          clickEvents.push({ x: target.x, y: target.y, timestamp: elapsed, action: 'type' })
          await moveCursorTo(page, target.x, target.y)
          await page.waitForTimeout(300)
          await triggerClickAnimation(page, target.x, target.y)
          await page.mouse.click(target.x, target.y, { delay: 100 })
          
          const textToType = step.type_text ?? 'hello'
          await showKeystroke(page, textToType)
          await page.keyboard.type(textToType, { delay: 75 })
          await page.waitForTimeout(1600)
        }
        break
      }

      case 'wait':
        await page.waitForTimeout(3000)
        break

      default:
        logger.warn(`browserRecorder.executeStep: unknown action "${actionName}"`)
    }
  } catch (error) {
    logger.warn(`browserRecorder.executeStep: step ${stepIndex} (${actionName}) failed, skipping`, { error })
  }
}

/**
 * Records a real product demo at 1080p HD.
 *
 * When credentials are provided, login happens BEFORE recording starts in a
 * separate non-recording browser context. The recording context receives the
 * saved session state (cookies + localStorage) so it opens already logged in —
 * login UI never appears in the video.
 *
 * Uses `understanding.demo_flow` for interactions. VideoScript drives
 * narration/captions only (in the assembler, not here).
 *
 * @returns Path to the recorded .webm video file
 */
export async function recordProduct(
  productUrl: string,
  understanding: ProductUnderstanding,
  jobId: string,
  credentials?: { username: string; password: string }
): Promise<string> {
  const outputDir = path.join(RECORDINGS_DIR, jobId)
  fs.mkdirSync(outputDir, { recursive: true })

  const clickEvents: ClickEvent[]   = []
  const scrollEvents: ScrollEvent[] = []

  // ── Step 0: Login in a separate non-recording context ──────────────────────
  // This must happen BEFORE we create the recording context so the login screen
  // is never captured in the video. We save the session to a file and load it
  // into the recording context so it starts already authenticated.
  let storageStatePath: string | undefined
  if (credentials) {
    const stateFile = path.join(outputDir, 'auth-state.json')
    const ok = await performLoginAndSaveState(productUrl, credentials, stateFile)
    if (ok) {
      storageStatePath = stateFile
      logger.info('browserRecorder: login succeeded — recording context will be pre-authenticated')
    } else {
      logger.warn('browserRecorder: login failed — recording without authentication')
    }
  }

  const browser = await chromium.launch({ headless: true, args: BROWSER_ARGS })

  try {
    const context = await browser.newContext({
      viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      userAgent: USER_AGENT,
      deviceScaleFactor: 1,
      permissions: [],
      // Pre-load the saved session — context opens as the logged-in user
      ...(storageStatePath ? { storageState: storageStatePath } : {}),
    })

    // ─── Inject overlay script BEFORE any page loads ───
    await context.addInitScript(INIT_OVERLAY_SCRIPT)

    const page = await context.newPage()

    // ─── Start CDP Screencast Capture (Decoupled Video) ───
    const framesDir = path.join(outputDir, 'frames')
    fs.mkdirSync(framesDir, { recursive: true })
    
    let isRecording = true
    let isNavigating = false  // When true, freeze the last good frame (prevents white/black flash)
    let lastFrameData: string | null = null
    let frozenFrameData: string | null = null  // The last good frame before navigation
    const client = await context.newCDPSession(page)
    
    client.on('Page.screencastFrame', (payload) => {
      // During navigation, ignore new frames (they're often blank/white)
      if (!isNavigating) {
        lastFrameData = payload.data
        frozenFrameData = payload.data  // Always keep the last known-good frame
      }
      client.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch(() => {})
    })
    
    // Start casting. quality: 85 is great for 1080p, everyNthFrame: 1 guarantees we see all CDP repaints
    await client.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 })
    
    let frameCount = 0
    const frameWriterLoop = async () => {
       while (isRecording) {
          // Use the frozen frame during navigation, or the live frame otherwise
          const dataToWrite = isNavigating ? frozenFrameData : lastFrameData
          if (dataToWrite) {
             frameCount++
             const framePath = path.join(framesDir, `frame_${frameCount.toString().padStart(5, '0')}.jpg`)
             fs.writeFileSync(framePath, Buffer.from(dataToWrite, 'base64'))
          }
          // Pad loop to 30fps (33ms). This writes exactly 30 images a second.
          await new Promise(r => setTimeout(r, 33)) 
       }
    }
    
    // Start writer passively
    frameWriterLoop().catch(e => logger.error('frameWriter loop failed', { e }))

    // Block ads, trackers, large media that slow down rendering
    await page.route('**/*.{mp4,webm,ogg,avi}', (route) => route.abort())
    await page.route('**/analytics**',           (route) => route.abort())
    await page.route('**/tracking**',            (route) => route.abort())
    await page.route('**/ads**',                 (route) => route.abort())

    // ─── Navigate to product (already logged in if credentials were provided) ─
    logger.info(`browserRecorder: navigating to ${productUrl}`)
    const response = await page.goto(productUrl, {
      waitUntil: 'networkidle',
      timeout: 60000,
    })
    if (!response || !response.ok()) {
      throw new Error(`Could not access the product URL. Status: ${response?.status() ?? 'unknown'}`)
    }

    await page.waitForTimeout(800)
    await fadeOutOverlay(page)
    await injectCustomCursor(page)

    // Small pause before interactions so the site is visually stable
    await page.waitForTimeout(800)

    const recordingStartTime = Date.now()

    // ─── Execute Demo Flow ───
    // ALWAYS filter out auth-related steps, regardless of whether credentials were provided.
    // The Gemini prompt should never generate these, but this is a critical safety net.
    const isAuthenticated = !!storageStatePath
    const AUTH_FILTER = /(login|log.?in|sign.?in|signin|sign.?up|signup|register|google|oauth|sso|auth|password|credential|forgot|reset.?password)/i
    const demoSteps = understanding.demo_flow.filter((step) => {
      const combined = [step.description, step.navigate_to, step.element_to_click, step.type_text]
        .filter(Boolean)
        .join(' ')
      return !AUTH_FILTER.test(combined)
    })

    // Also enforce max 3 consecutive scroll_down steps
    const filteredSteps: typeof demoSteps = []
    let consecutiveScrolls = 0
    let totalScrolls = 0
    for (const step of demoSteps) {
      if (step.action === 'scroll_down') {
        consecutiveScrolls++
        totalScrolls++
        if (consecutiveScrolls > 2 || totalScrolls > 3) {
          logger.info(`browserRecorder: skipping excess scroll_down step (consecutive=${consecutiveScrolls}, total=${totalScrolls})`)
          continue
        }
      } else {
        consecutiveScrolls = 0
      }
      filteredSteps.push(step)
    }

    // Hard duration cap: stop recording if it exceeds the max allowed time
    const MAX_RECORDING_SECONDS = 120 // Never record more than 2 minutes of raw footage

    logger.info(`browserRecorder: executing ${filteredSteps.length} demo steps (authenticated: ${isAuthenticated}, maxDuration: ${MAX_RECORDING_SECONDS}s)`)
    let stepIndex = 1
    for (const step of filteredSteps) {
      // Check hard duration cap
      const elapsedSeconds = (Date.now() - recordingStartTime) / 1000
      if (elapsedSeconds > MAX_RECORDING_SECONDS) {
        logger.warn(`browserRecorder: hit ${MAX_RECORDING_SECONDS}s hard cap at step ${stepIndex}, stopping early`)
        break
      }

      // Propagate the isNavigating flag to the frame writer
      if (step.action === 'navigate') {
        isNavigating = true
      }

      logger.info(`browserRecorder: step ${stepIndex}/${filteredSteps.length} — ${step.action}: ${step.description}`)
      await executeStep(page, step, stepIndex, productUrl, clickEvents, recordingStartTime, scrollEvents)
      
      // Unfreeze after navigation completes
      if (step.action === 'navigate') {
        isNavigating = false
      }

      await page.waitForTimeout(1000)
      stepIndex++
    }

    // Final pause to capture the last frame cleanly
    await page.waitForTimeout(3000)
    
    // Stop recording cleanly
    isRecording = false
    await client.send('Page.stopScreencast').catch(() => {})
    await context.close()
  } finally {
    await browser.close()
  }

  const eventsPath = path.join(outputDir, 'click_events.json')
  fs.writeFileSync(eventsPath, JSON.stringify(clickEvents, null, 2), 'utf-8')
  logger.info(`browserRecorder: saved ${clickEvents.length} click events to ${eventsPath}`)

  const scrollEventsPath = path.join(outputDir, 'scroll_events.json')
  fs.writeFileSync(scrollEventsPath, JSON.stringify(scrollEvents, null, 2), 'utf-8')
  logger.info(`browserRecorder: saved ${scrollEvents.length} scroll events to ${scrollEventsPath}`)

  const capturedFramesDir = path.join(outputDir, 'frames')
  const files = fs.readdirSync(capturedFramesDir)
  
  if (files.length === 0) {
    throw new Error('Playwright recording failed — no frames were captured.')
  }
  
  logger.info(`browserRecorder: successfully captured ${files.length} frames`)

  // Return the path to the frames directory, NOT a single video file 
  return path.join(outputDir, 'frames')
}
