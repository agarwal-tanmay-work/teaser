import fs from 'fs'
import path from 'path'
import os from 'os'
import { chromium, type Page } from 'playwright'
import { logger } from '../lib/logger'
import type { DemoStep } from '../types'

const RECORDINGS_DIR = path.join(os.tmpdir(), 'teaser-recordings')

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

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
 */
async function executeStep(
  page: Page,
  step: DemoStep,
  productUrl: string
): Promise<void> {
  try {
    switch (step.action) {
      case 'scroll_down':
        await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }))
        break

      case 'scroll_up':
        await page.evaluate(() => window.scrollBy({ top: -400, behavior: 'smooth' }))
        break

      case 'click': {
        if (!step.element_to_click) break
        const el = step.element_to_click
        const clickSelectors = [
          el,
          `text="${el}"`,
          `button:has-text("${el}")`,
          `[aria-label="${el}"]`,
          `a:has-text("${el}")`,
        ]
        let clicked = false
        for (const selector of clickSelectors) {
          try {
            const handle = await page.waitForSelector(selector, { state: 'visible', timeout: 5000 })
            if (handle) {
              await handle.click()
              clicked = true
              break
            }
          } catch {
            continue
          }
        }
        if (!clicked) {
          logger.warn(`browserRecorder.executeStep: could not find element "${el}" for step ${step.step}`)
        }
        break
      }

      case 'navigate': {
        if (!step.navigate_to) break
        const targetUrl = step.navigate_to.startsWith('http')
          ? step.navigate_to
          : new URL(step.navigate_to, productUrl).href
        await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 })
        break
      }

      case 'wait':
        await page.waitForTimeout(3000)
        break

      default:
        logger.warn(`browserRecorder.executeStep: unknown action "${step.action}"`)
    }
  } catch (error) {
    logger.warn(`browserRecorder.executeStep: step ${step.step} failed, skipping`, { error })
  }
}

/**
 * Records a real product demo using a headless Chromium browser.
 */
export async function recordProduct(
  productUrl: string,
  demoFlow: DemoStep[],
  jobId: string,
  credentials?: { username: string; password: string }
): Promise<string> {
  const outputDir = path.join(RECORDINGS_DIR, jobId)
  fs.mkdirSync(outputDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: USER_AGENT,
      recordVideo: {
        dir: outputDir,
        size: { width: 1280, height: 720 },
      },
    })

    const page = await context.newPage()

    // ─── Initial Load (Fail-Fast) ───
    logger.info(`browserRecorder: navigating to ${productUrl}`)
    const response = await page.goto(productUrl, { waitUntil: 'load', timeout: 60000 })
    if (!response || !response.ok()) {
      throw new Error(`Could not access the product URL. Status: ${response?.status() ?? 'unknown'}`)
    }

    // Wait for the page to settle a bit
    await page.waitForTimeout(5000)

    // Optional login
    if (credentials) {
      await attemptLogin(page, credentials)
      // Re-navigate or wait after login to ensure we're where we need to be
      await page.goto(productUrl, { waitUntil: 'load', timeout: 45000 }).catch(() => {})
    }

    // Initial stabilization pause
    await page.waitForTimeout(5000)

    // Auto-scroll
    await page.evaluate(async () => {
      const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
      const scrollStep = 300
      const maxScroll = document.body.scrollHeight
      for (let y = 0; y < maxScroll; y += scrollStep) {
        window.scrollTo({ top: y, behavior: 'smooth' })
        await delay(800)
      }
      window.scrollTo({ top: 0, behavior: 'smooth' })
      await delay(1500)
    })

    // Execute steps
    for (const step of demoFlow) {
      await executeStep(page, step, productUrl)
      await page.waitForTimeout(3000)
    }

    await page.waitForTimeout(5000)
    await context.close()
  } finally {
    await browser.close()
  }

  const files = fs.readdirSync(outputDir)
  const videoFile = files.find((f) => f.endsWith('.webm'))

  if (!videoFile) {
    throw new Error('Playwright recording failed — no video file was created.')
  }

  return path.join(outputDir, videoFile)
}

