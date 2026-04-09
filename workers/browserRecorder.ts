import fs from 'fs'
import path from 'path'
import os from 'os'
import { chromium, type Page } from 'playwright'
import { logger } from '../lib/logger'
import type { DemoStep } from '../types'

const RECORDINGS_DIR = path.join(os.tmpdir(), 'teaser-recordings')

/**
 * Attempts to log in to a product using provided credentials.
 * Looks for common username/email and password input patterns.
 * Silently skips if login form is not found within 5 seconds.
 */
async function attemptLogin(
  page: Page,
  credentials: { username: string; password: string }
): Promise<void> {
  try {
    // Try to find a username/email field
    const usernameSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[type="text"]',
    ]

    let usernameField = null
    for (const selector of usernameSelectors) {
      try {
        usernameField = await page.waitForSelector(selector, { timeout: 3000 })
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
      timeout: 3000,
    })
    await passwordField.fill(credentials.password)

    // Submit — try common submit selectors
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
          await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {
            // Navigation may not happen on SPAs — continue anyway
          })
          break
        }
      } catch {
        continue
      }
    }
  } catch (error) {
    logger.warn('browserRecorder.attemptLogin: login attempt failed, continuing without auth', {
      error,
    })
  }
}

/**
 * Executes a single demo step action on the page.
 * Wrapped in try/catch so a failed step never crashes the whole recording.
 */
async function executeStep(
  page: Page,
  step: DemoStep,
  productUrl: string
): Promise<void> {
  try {
    switch (step.action) {
      case 'scroll_down':
        await page.evaluate(() =>
          window.scrollBy({ top: 400, behavior: 'smooth' })
        )
        break

      case 'scroll_up':
        await page.evaluate(() =>
          window.scrollBy({ top: -400, behavior: 'smooth' })
        )
        break

      case 'click': {
        if (!step.element_to_click) {
          logger.warn(`browserRecorder.executeStep: step ${step.step} has no element_to_click`)
          break
        }
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
            const handle = await page.$(selector)
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
          logger.warn(
            `browserRecorder.executeStep: could not find element "${el}" for step ${step.step}, skipping`
          )
        }
        break
      }

      case 'navigate': {
        if (!step.navigate_to) {
          logger.warn(`browserRecorder.executeStep: step ${step.step} has no navigate_to`)
          break
        }
        const targetUrl = step.navigate_to.startsWith('http')
          ? step.navigate_to
          : new URL(step.navigate_to, productUrl).href
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 15000 })
        break
      }

      case 'wait':
        await page.waitForTimeout(3000)
        break

      default:
        logger.warn(`browserRecorder.executeStep: unknown action "${step.action as string}" at step ${step.step}`)
    }
  } catch (error) {
    logger.warn(`browserRecorder.executeStep: step ${step.step} failed, skipping`, { error })
  }
}

/**
 * Records a real product demo using a headless Chromium browser.
 * Navigates the product according to the provided demo flow and saves the session
 * as a .webm video file in /tmp/recordings/[jobId]/.
 *
 * Each demo step is wrapped in try/catch so a single failure never aborts the recording.
 *
 * @param productUrl - The product URL to record
 * @param demoFlow - Ordered list of actions to perform during the recording
 * @param jobId - Used to create an isolated temp directory for this recording
 * @param credentials - Optional login credentials if the product requires authentication
 * @returns Absolute path to the recorded .webm file
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
      recordVideo: {
        dir: outputDir,
        size: { width: 1280, height: 720 },
      },
    })

    const page = await context.newPage()

    // Optional login flow before navigating to the product
    if (credentials) {
      await page.goto(productUrl, { waitUntil: 'networkidle', timeout: 30000 })
      await attemptLogin(page, credentials)
    }

    // Navigate to the product and let it fully load
    await page.goto(productUrl, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(2000)

    // Execute each demo step with a pause between steps
    for (const step of demoFlow) {
      await executeStep(page, step, productUrl)
      await page.waitForTimeout(1500)
    }

    // Final pause to capture the last screen state
    await page.waitForTimeout(3000)

    // Closing the context triggers Playwright to write the .webm file
    await context.close()
  } finally {
    await browser.close()
  }

  // Locate the generated .webm file
  const files = fs.readdirSync(outputDir)
  const videoFile = files.find((f) => f.endsWith('.webm'))

  if (!videoFile) {
    throw new Error(
      'Playwright recording failed — no video file was created. Check browser permissions.'
    )
  }

  return path.join(outputDir, videoFile)
}
