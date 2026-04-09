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
 * CSS injected into every page to eliminate jank and lag in recordings.
 * Forces instant transitions and disables heavy animations that cause
 * frame drops in Playwright's video capture.
 */
const ANTI_LAG_CSS = `
  *, *::before, *::after {
    animation-duration: 0.01s !important;
    animation-delay: 0s !important;
    transition-duration: 0.01s !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
  }
  /* Hide cookie banners, modals, chat widgets that obscure the UI */
  [class*="cookie"], [class*="Cookie"],
  [id*="cookie"], [id*="Cookie"],
  [class*="consent"], [class*="Consent"],
  [class*="chat-widget"], [class*="intercom"],
  [class*="crisp"], [class*="drift"] {
    display: none !important;
  }
`

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
    // 1. Direct CSS selector
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
    // 8. Any element with text
    `*:has-text("${selector}")`,
  ]

  for (const strat of strategies) {
    try {
      const el = await page.waitForSelector(strat, { state: 'visible', timeout: 4000 })
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
        await page.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' }))
        await page.waitForTimeout(1200)
        break

      case 'scroll_up':
        await page.evaluate(() => window.scrollBy({ top: -500, behavior: 'smooth' }))
        await page.waitForTimeout(1200)
        break

      case 'click': {
        const el = await findElement(page, step.element_to_click)
        if (el) {
          // Get bounding box for zoom tracking
          const box = await el.boundingBox()
          if (box) {
            clickEvents.push({
              x: Math.round(box.x + box.width / 2),
              y: Math.round(box.y + box.height / 2),
              timestamp: elapsed,
              action: 'click',
            })
          }
          // Scroll element into view first
          await el.scrollIntoViewIfNeeded()
          await page.waitForTimeout(500)
          await el.click()
          // Wait for any navigation or content change
          await page.waitForTimeout(2000)
          // Re-inject anti-lag CSS in case page changed
          await page.addStyleTag({ content: ANTI_LAG_CSS }).catch(() => {})
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
            clickEvents.push({
              x: Math.round(box.x + box.width / 2),
              y: Math.round(box.y + box.height / 2),
              timestamp: elapsed,
              action: 'hover',
            })
          }
          await el.scrollIntoViewIfNeeded()
          await page.waitForTimeout(300)
          await el.hover()
          // Hold hover to show tooltip/animation
          await page.waitForTimeout(2000)
        }
        break
      }

      case 'type': {
        const el = await findElement(page, step.element_to_click)
        if (el) {
          const box = await el.boundingBox()
          if (box) {
            clickEvents.push({
              x: Math.round(box.x + box.width / 2),
              y: Math.round(box.y + box.height / 2),
              timestamp: elapsed,
              action: 'type',
            })
          }
          await el.scrollIntoViewIfNeeded()
          await page.waitForTimeout(300)
          await el.click()
          const textToType = step.type_text ?? step.description ?? 'hello'
          // Type with realistic human-like delay
          await page.keyboard.type(textToType, { delay: 80 })
          await page.waitForTimeout(1500)
        }
        break
      }

      case 'navigate': {
        if (!step.navigate_to) break
        const targetUrl = step.navigate_to.startsWith('http')
          ? step.navigate_to
          : new URL(step.navigate_to, productUrl).href
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        // Re-inject anti-lag CSS on new page
        await page.addStyleTag({ content: ANTI_LAG_CSS }).catch(() => {})
        await page.waitForTimeout(1500)
        break
      }

      case 'wait':
        await page.waitForTimeout(2000)
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
 * and typing. Tracks all interaction coordinates for post-processing zoom effects.
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
      '--disable-gpu-compositing',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
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
      // Disable media autoplay for cleaner recordings
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
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    if (!response || !response.ok()) {
      throw new Error(`Could not access the product URL. Status: ${response?.status() ?? 'unknown'}`)
    }

    // Inject anti-lag CSS immediately
    await page.addStyleTag({ content: ANTI_LAG_CSS }).catch(() => {})

    // Wait for page to be fully interactive (shorter than before)
    await page.waitForTimeout(2500)

    // Optional login
    if (credentials) {
      await attemptLogin(page, credentials)
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
      await page.addStyleTag({ content: ANTI_LAG_CSS }).catch(() => {})
    }

    // Brief stabilization pause
    await page.waitForTimeout(1500)

    const recordingStartTime = Date.now()

    // ─── Execute Demo Flow ───
    // No more auto-scroll — the Gemini demo_flow drives ALL interactions
    logger.info(`browserRecorder: executing ${demoFlow.length} demo steps`)
    for (const step of demoFlow) {
      logger.info(`browserRecorder: step ${step.step} — ${step.action}: ${step.description}`)
      await executeStep(page, step, productUrl, clickEvents, recordingStartTime)
      // Brief pause between steps for visual clarity
      await page.waitForTimeout(1000)
    }

    // Final pause to capture the last frame cleanly
    await page.waitForTimeout(2000)
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
