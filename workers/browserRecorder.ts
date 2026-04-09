import fs from 'fs'
import path from 'path'
import os from 'os'
import { chromium, type Page, type ElementHandle } from 'playwright'
import { logger } from '../lib/logger'
import type { DemoStep, ClickEvent } from '../types'

const RECORDINGS_DIR = path.join(os.tmpdir(), 'teaser-recordings')

/** Full HD resolution for crisp, premium output */
const VIDEO_WIDTH = 1920
const VIDEO_HEIGHT = 1080

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/**
 * CSS injected into every page to hide intrusive UI overlays.
 * Does NOT kill animations — we want sites to look natural in recordings.
 */
const POPUP_HIDE_CSS = `
  /* Hide cookie banners, modals, chat widgets that obscure the UI */
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
 * Renders a visible, glowing cursor that slides smoothly between interaction
 * targets and pulses on click — all baked into the Playwright recording.
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
`

/**
 * Injects the custom cursor element into the page.
 * Idempotent — safe to call after every navigation.
 */
async function injectCustomCursor(page: Page): Promise<void> {
  try {
    await page.addStyleTag({ content: POPUP_HIDE_CSS + CUSTOM_CURSOR_CSS })
    await page.evaluate(() => {
      if (!document.getElementById('__teaser_cursor__')) {
        const cursor = document.createElement('div')
        cursor.id = '__teaser_cursor__'
        document.body.appendChild(cursor)
      }
    })
  } catch {
    // Non-fatal — page may have navigated mid-inject
  }
}

/**
 * Smoothly moves the custom cursor to the given page coordinates.
 * Waits 300ms for the CSS transition to play out in the recording.
 */
async function moveCursorTo(page: Page, x: number, y: number): Promise<void> {
  try {
    await page.evaluate(
      ({ px, py }: { px: number; py: number }) => {
        const cursor = document.getElementById('__teaser_cursor__') as HTMLElement | null
        if (cursor) {
          cursor.style.left = `${px}px`
          cursor.style.top = `${py}px`
        }
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
        ripple.style.top = `${py}px`
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
 * Attempts to find an element on the page using multiple selector strategies.
 * Tries exact selector, text match, button text, aria-label, and link text.
 */
async function findElement(
  page: Page,
  selector: string | undefined
): Promise<ElementHandle | null> {
  if (!selector) return null

  const strategies = [
    // 1. Direct CSS selector (only useful when Gemini gives a real CSS selector)
    selector,
    // 2. Exact text match
    `text="${selector}"`,
    // 3. Partial text in buttons
    `button:has-text("${selector}")`,
    // 4. Partial text in links
    `a:has-text("${selector}")`,
    // 5. Aria-label match
    `[aria-label="${selector}"]`,
    // 6. Title attribute
    `[title="${selector}"]`,
    // 7. Placeholder text (for inputs)
    `[placeholder="${selector}"]`,
    // 8. Any element with text (broad fallback — longer timeout)
    `*:has-text("${selector}")`,
  ]

  for (let i = 0; i < strategies.length; i++) {
    const strat = strategies[i]
    // Last strategy gets more time — it's the broadest fallback
    const timeout = i === strategies.length - 1 ? 3000 : 2000
    try {
      const el = await page.waitForSelector(strat, { state: 'visible', timeout })
      if (el) {
        logger.info(`findElement: found "${selector}" via strategy "${strat}"`)
        return el
      }
    } catch {
      continue
    }
  }

  logger.warn(`findElement: could not find element "${selector}" with any strategy`)
  return null
}

/**
 * Attempts to log in to a product using provided credentials.
 */
async function attemptLogin(
  page: Page,
  credentials: { username: string; password: string }
): Promise<void> {
  try {
    const usernameSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[type="text"]',
    ]

    let usernameField = null
    for (const selector of usernameSelectors) {
      try {
        usernameField = await page.waitForSelector(selector, { state: 'visible', timeout: 3000 })
        if (usernameField) break
      } catch {
        continue
      }
    }

    if (!usernameField) {
      logger.warn('browserRecorder.attemptLogin: no username field found, skipping login')
      return
    }

    await usernameField.fill(credentials.username)

    const passwordField = await page.waitForSelector('input[type="password"]', {
      state: 'visible',
      timeout: 3000,
    })
    await passwordField.fill(credentials.password)

    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Log in")',
      'button:has-text("Sign in")',
      'button:has-text("Login")',
    ]

    for (const selector of submitSelectors) {
      try {
        const btn = await page.$(selector)
        if (btn) {
          await btn.click()
          await page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => {})
          break
        }
      } catch {
        continue
      }
    }
  } catch (error) {
    logger.warn('browserRecorder.attemptLogin: login attempt failed, continuing without auth', { error })
  }
}

/**
 * Executes a single demo step action on the page.
 * Records click coordinates for post-processing zoom effects.
 * Moves the custom cursor to each target before interacting.
 */
async function executeStep(
  page: Page,
  step: DemoStep,
  productUrl: string,
  clickEvents: ClickEvent[],
  startTime: number
): Promise<void> {
  const elapsed = (Date.now() - startTime) / 1000

  try {
    switch (step.action) {
      case 'scroll_down':
        await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' }))
        await page.waitForTimeout(1400)
        break

      case 'scroll_up':
        await page.evaluate(() => window.scrollBy({ top: -600, behavior: 'smooth' }))
        await page.waitForTimeout(1400)
        break

      case 'click': {
        const el = await findElement(page, step.element_to_click)
        if (el) {
          const box = await el.boundingBox()
          if (box) {
            const centerX = Math.round(box.x + box.width / 2)
            const centerY = Math.round(box.y + box.height / 2)

            clickEvents.push({
              x: centerX,
              y: centerY,
              timestamp: elapsed,
              action: 'click',
            })

            // Animate cursor to target, then click
            await moveCursorTo(page, centerX, centerY)
            await el.scrollIntoViewIfNeeded()
            await page.waitForTimeout(400)
            await triggerClickAnimation(page, centerX, centerY)
            await el.click()
          } else {
            await el.click()
          }

          // Wait for any navigation or content change
          await page.waitForTimeout(2200)
          // Re-inject cursor on the (potentially new) page
          await injectCustomCursor(page)
        } else {
          logger.warn(`browserRecorder: step ${step.step} — click target "${step.element_to_click}" not found, skipping`)
        }
        break
      }

      case 'hover': {
        const el = await findElement(page, step.element_to_click)
        if (el) {
          const box = await el.boundingBox()
          if (box) {
            const centerX = Math.round(box.x + box.width / 2)
            const centerY = Math.round(box.y + box.height / 2)

            clickEvents.push({
              x: centerX,
              y: centerY,
              timestamp: elapsed,
              action: 'hover',
            })

            await moveCursorTo(page, centerX, centerY)
            await el.scrollIntoViewIfNeeded()
            await page.waitForTimeout(300)
            await el.hover()
            // Hold hover to show tooltip/animation
            await page.waitForTimeout(2200)
          }
        }
        break
      }

      case 'type': {
        const el = await findElement(page, step.element_to_click)
        if (el) {
          const box = await el.boundingBox()
          if (box) {
            const centerX = Math.round(box.x + box.width / 2)
            const centerY = Math.round(box.y + box.height / 2)

            clickEvents.push({
              x: centerX,
              y: centerY,
              timestamp: elapsed,
              action: 'type',
            })

            await moveCursorTo(page, centerX, centerY)
            await el.scrollIntoViewIfNeeded()
            await page.waitForTimeout(300)
            await triggerClickAnimation(page, centerX, centerY)
            await el.click()
          }
          const textToType = step.type_text ?? step.description ?? 'hello'
          // Type with realistic human-like delay
          await page.keyboard.type(textToType, { delay: 75 })
          await page.waitForTimeout(1600)
        }
        break
      }

      case 'navigate': {
        if (!step.navigate_to) break
        const targetUrl = step.navigate_to.startsWith('http')
          ? step.navigate_to
          : new URL(step.navigate_to, productUrl).href
        await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 })
        // Re-inject cursor on the new page
        await injectCustomCursor(page)
        await page.waitForTimeout(1800)
        break
      }

      case 'wait':
        await page.waitForTimeout(2200)
        break

      default:
        logger.warn(`browserRecorder.executeStep: unknown action "${step.action}"`)
    }
  } catch (error) {
    logger.warn(`browserRecorder.executeStep: step ${step.step} (${step.action}) failed, skipping`, { error })
  }
}

/**
 * Records a real product demo using a headless Chromium browser at 1080p HD.
 * Executes the full Gemini-generated demo flow with clicks, navigation, hover,
 * and typing. Injects a custom animated cursor so all interactions are visually
 * clear in the recording. Tracks all interaction coordinates for post-processing
 * zoom effects.
 *
 * @returns Path to the recorded .webm video file
 */
export async function recordProduct(
  productUrl: string,
  demoFlow: DemoStep[],
  jobId: string,
  credentials?: { username: string; password: string }
): Promise<string> {
  const outputDir = path.join(RECORDINGS_DIR, jobId)
  fs.mkdirSync(outputDir, { recursive: true })

  const clickEvents: ClickEvent[] = []

  const browser = await chromium.launch({
    headless: true,
    args: [
      // Use software OpenGL for consistent, artifact-free rendering
      '--use-gl=swiftshader',
      // Memory + sandbox
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // Prevent Chrome throttling the headless tab
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      // Allow cross-origin iframe interactions
      '--disable-web-security',
      // Consistent color profile so colors match design
      '--force-color-profile=srgb',
      // Smooth scroll animations in recording
      '--enable-smooth-scrolling',
    ],
  })

  try {
    const context = await browser.newContext({
      viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      userAgent: USER_AGENT,
      deviceScaleFactor: 1,
      recordVideo: {
        dir: outputDir,
        size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      },
      permissions: [],
    })

    const page = await context.newPage()

    // Block heavy resources that cause lag (ads, trackers, large media)
    await page.route('**/*.{mp4,webm,ogg,avi}', (route) => route.abort())
    await page.route('**/analytics**', (route) => route.abort())
    await page.route('**/tracking**', (route) => route.abort())
    await page.route('**/ads**', (route) => route.abort())

    // ─── Initial Load ───
    logger.info(`browserRecorder: navigating to ${productUrl}`)
    const response = await page.goto(productUrl, {
      // 'load' waits for all resources, giving sites time to fully render
      waitUntil: 'load',
      timeout: 60000,
    })
    if (!response || !response.ok()) {
      throw new Error(`Could not access the product URL. Status: ${response?.status() ?? 'unknown'}`)
    }

    // Let the page fully settle, then inject our cursor
    await page.waitForTimeout(2800)
    await injectCustomCursor(page)

    // Optional login
    if (credentials) {
      await attemptLogin(page, credentials)
      await page.goto(productUrl, { waitUntil: 'load', timeout: 45000 }).catch(() => {})
      await injectCustomCursor(page)
    }

    // Brief stabilization pause before recording starts
    await page.waitForTimeout(1500)

    const recordingStartTime = Date.now()

    // ─── Execute Demo Flow ───
    logger.info(`browserRecorder: executing ${demoFlow.length} demo steps`)
    for (const step of demoFlow) {
      logger.info(`browserRecorder: step ${step.step} — ${step.action}: ${step.description}`)
      await executeStep(page, step, productUrl, clickEvents, recordingStartTime)
      // Brief pause between steps for visual clarity
      await page.waitForTimeout(900)
    }

    // Final pause to capture the last frame cleanly
    await page.waitForTimeout(2200)
    await context.close()
  } finally {
    await browser.close()
  }

  // Save click events for post-processing zoom
  const eventsPath = path.join(outputDir, 'click_events.json')
  fs.writeFileSync(eventsPath, JSON.stringify(clickEvents, null, 2), 'utf-8')
  logger.info(`browserRecorder: saved ${clickEvents.length} click events to ${eventsPath}`)

  const files = fs.readdirSync(outputDir)
  const videoFile = files.find((f) => f.endsWith('.webm'))

  if (!videoFile) {
    throw new Error('Playwright recording failed — no video file was created.')
  }

  return path.join(outputDir, videoFile)
}
