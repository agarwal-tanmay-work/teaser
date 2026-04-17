import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { chromium, type Page } from 'playwright'
import { logger } from '../lib/logger'
import { identifyElementOnPage, planPageInteractions } from '../lib/gemini'
import { getFfmpegPath } from '../lib/ffmpegUtils'
import type { ProductUnderstanding, DemoStep, SceneCapture, RecordingManifest, ElementBox } from '../types'

const RECORDINGS_DIR = path.join(os.tmpdir(), 'teaser-recordings')

/** Full HD resolution for crisp, premium output */
const VIDEO_WIDTH = 1920
const VIDEO_HEIGHT = 1080

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/**
 * CSS injected into every page to hide intrusive overlays.
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
 * Common browser launch args.
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
  '--font-render-hinting=none',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  `--window-size=${VIDEO_WIDTH},${VIDEO_HEIGHT}`,
]

/**
 * Script injected to render a custom mouse cursor visible in screenshots/screencast.
 */
const CURSOR_SCRIPT = `
  if (!window.__injectedCursor) {
    const cursor = document.createElement('div');
    cursor.id = 'teaser-demo-cursor';
    cursor.style.cssText = 'position: fixed; top: 0; left: 0; width: 24px; height: 24px; z-index: 2147483647; pointer-events: none; transform: translate(-50%, -50%); transition: transform 0.1s ease-out;';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.style.filter = 'drop-shadow(0px 2px 4px rgba(0,0,0,0.4))';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.24c.45 0 .67-.54.35-.85L6.35 2.85a.5.5 0 0 0-.85.35Z');
    path.setAttribute('fill', '#111');
    path.setAttribute('stroke', '#FFF');
    path.setAttribute('stroke-width', '1.2');
    path.setAttribute('stroke-linejoin', 'round');

    svg.appendChild(path);
    cursor.appendChild(svg);
    document.documentElement.appendChild(cursor);

    window.__injectedCursor = cursor;

    document.addEventListener('mousemove', (e) => {
      window.__injectedCursor.style.transform = \`translate(\${e.clientX}px, \${e.clientY}px)\`;
    }, { capture: true, passive: true });
  }
`

/**
 * Narrowed auth URL pattern — blocks the *act of logging in* (login/signup forms,
 * oauth flows, password resets) but allows post-login product URLs like /app,
 * /dashboard, /auth/callback, /account (which are the actual product interior).
 */
const AUTH_URL_PATTERN = /\/(log[-_]?in|sign[-_]?in|sign[-_]?up|register|forgot|reset|password|oauth|sso)(\?|$|\/)/i

/** Max Gemini Vision calls for element-finding fallback per recording session. */
const MAX_VISION_CALLS = 12

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Converts a Windows path to forward-slash format for FFmpeg arguments. */
function toFfPath(p: string): string {
  return p.replace(/\\/g, '/')
}

/** Spawns an FFmpeg process and waits for it to complete, with a hard timeout. */
function spawnFfmpegLocal(ffmpegPath: string, args: string[], timeoutMs = 300_000): Promise<void> {
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
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/** Returns true if the URL is a login/signup/oauth destination we should skip. */
function isAuthUrl(url: string): boolean {
  return AUTH_URL_PATTERN.test(url)
}

// ─── Element Finding (Locator-First + Vision Fallback) ───────────────────────

/**
 * Locator chain that native Playwright uses (auto-waits, auto-scrolls, handles href).
 * Returns the first visible locator matching the selector text, or null.
 */
async function findLocator(page: Page, selector: string | undefined) {
  if (!selector) return null
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^\\s*${escaped}\\s*$`, 'i')
  const looseRe = new RegExp(escaped, 'i')

  const strategies = [
    page.getByRole('link', { name: re }),
    page.getByRole('button', { name: re }),
    page.getByRole('menuitem', { name: re }),
    page.getByRole('tab', { name: re }),
    page.getByRole('link', { name: looseRe }),
    page.getByRole('button', { name: looseRe }),
    page.getByPlaceholder(looseRe),
    page.getByLabel(looseRe),
    page.locator('a', { hasText: looseRe }),
    page.locator('button', { hasText: looseRe }),
    page.getByText(looseRe, { exact: false }),
  ]

  for (const locator of strategies) {
    try {
      const first = locator.first()
      await first.waitFor({ state: 'visible', timeout: 1200 })
      const box = await first.boundingBox()
      if (box && box.width > 0 && box.height > 0) {
        return first
      }
    } catch { continue }
  }
  return null
}

/**
 * Gets the bounding box of a selector, using findLocator + vision fallback.
 * Used for cursor animation and manifest metadata — does NOT perform the click.
 */
async function findElementBox(
  page: Page,
  selector: string | undefined,
  description: string,
  visionBudget: { used: number }
): Promise<ElementBox | null> {
  const locator = await findLocator(page, selector)
  if (locator) {
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 2000 })
      await page.waitForTimeout(200)
      const box = await locator.boundingBox()
      if (box && box.width > 0 && box.height > 0) {
        return {
          x: Math.round(box.x + box.width / 2),
          y: Math.round(box.y + box.height / 2),
          width: Math.round(box.width),
          height: Math.round(box.height),
        }
      }
    } catch { /* fallthrough */ }
  }

  // Vision fallback
  if (visionBudget.used >= MAX_VISION_CALLS) {
    logger.warn(`findElementBox: vision budget exhausted (${MAX_VISION_CALLS})`)
    return null
  }
  visionBudget.used++
  try {
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 50 })
    const visionText = await identifyElementOnPage(screenshot.toString('base64'), description, page.url())
    if (visionText && visionText !== selector) {
      const vLocator = await findLocator(page, visionText)
      if (vLocator) {
        try {
          await vLocator.scrollIntoViewIfNeeded({ timeout: 2000 })
          const box = await vLocator.boundingBox()
          if (box && box.width > 0 && box.height > 0) {
            logger.info(`findElementBox: vision identified "${visionText}"`)
            return {
              x: Math.round(box.x + box.width / 2),
              y: Math.round(box.y + box.height / 2),
              width: Math.round(box.width),
              height: Math.round(box.height),
            }
          }
        } catch { /* fallthrough */ }
      }
    }
  } catch (err) {
    logger.warn('findElementBox: vision call failed', { err })
  }
  return null
}

// ─── Login ─────────────────────────────────────────────────────────────────

/**
 * Performs login in a separate non-recording browser context and saves the auth state.
 *
 * Returns the post-login landing URL — typically the product dashboard — which we use
 * as the recording start URL so the video shows the actual product, not the marketing
 * homepage.
 */
async function performLoginAndSaveState(
  productUrl: string,
  credentials: { username: string; password: string },
  stateFilePath: string
): Promise<{ success: boolean; dashboardUrl: string | null }> {
  logger.info('browserRecorder.login: starting login in separate context')
  const browser = await chromium.launch({ headless: true, args: BROWSER_ARGS })

  try {
    const context = await browser.newContext({
      viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      userAgent: USER_AGENT,
    })
    context.setDefaultTimeout(15000)
    context.setDefaultNavigationTimeout(30000)
    const page = await context.newPage()

    await page.goto(productUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})

    let loginUrl: string | null = null
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
          break
        }
      } catch { continue }
    }

    if (!loginUrl) {
      const commonPaths = ['/login', '/signin', '/sign-in', '/auth/login', '/auth/signin', '/account/login']
      for (const p of commonPaths) {
        const url = new URL(p, productUrl).href
        try {
          const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 8000 })
          if (res?.ok()) { loginUrl = url; break }
        } catch { continue }
      }
    }

    if (loginUrl) {
      await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {})
    }

    await page.waitForTimeout(1000)

    const emailTogglePhrases = [/sign.?in with email/i, /continue with email/i, /use email/i]
    for (const phrase of emailTogglePhrases) {
      try {
        const toggle = page.getByRole('button', { name: phrase })
          .or(page.getByRole('link', { name: phrase }))
          .or(page.getByText(phrase, { exact: false }))
        await toggle.first().waitFor({ state: 'visible', timeout: 2000 })
        await toggle.first().click()
        await page.waitForTimeout(1000)
        break
      } catch { continue }
    }

    const emailSelectors = [
      'input[type="email"]', 'input[name="email"]', 'input[autocomplete="email"]',
      'input[autocomplete="username"]', 'input[name="username"]',
      'input[placeholder*="email" i]', 'input[placeholder*="username" i]', 'input[type="text"]',
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
        break
      } catch { continue }
    }
    if (!emailFilled) { logger.warn('login: could not find email field'); return { success: false, dashboardUrl: null } }

    for (const pattern of [/^next$/i, /^continue$/i, /^proceed$/i]) {
      try {
        const btn = page.getByRole('button', { name: pattern }).first()
        await btn.waitFor({ state: 'visible', timeout: 1500 })
        await btn.click()
        await page.waitForTimeout(800)
        break
      } catch { continue }
    }

    try {
      const passwordField = page.locator('input[type="password"]').first()
      await passwordField.waitFor({ state: 'visible', timeout: 5000 })
      await passwordField.click()
      await passwordField.fill('')
      await passwordField.fill(credentials.password)
    } catch {
      logger.warn('login: could not find password field')
      return { success: false, dashboardUrl: null }
    }

    const submitLocators = [
      page.locator('button[type="submit"]').first(),
      page.getByRole('button', { name: /^log.?in$/i }).first(),
      page.getByRole('button', { name: /^sign.?in$/i }).first(),
      page.getByRole('button', { name: /^continue$/i }).first(),
    ]
    for (const btn of submitLocators) {
      try {
        await btn.waitFor({ state: 'visible', timeout: 2000 })
        await btn.click()
        break
      } catch { continue }
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(2000)

    const postLoginUrl = page.url()
    const dashboardUrl = postLoginUrl !== productUrl ? postLoginUrl : null
    if (dashboardUrl) {
      logger.info(`login: post-login URL detected → ${dashboardUrl}`)
    }

    await context.storageState({ path: stateFilePath })
    logger.info(`login: session saved → ${stateFilePath}`)
    return { success: true, dashboardUrl }
  } catch (err) {
    logger.warn('login: failed', { error: err })
    return { success: false, dashboardUrl: null }
  } finally {
    await browser.close()
  }
}

// ─── Step Execution ──────────────────────────────────────────────────────────

/**
 * Context shared by executeAndCapture across a single recording session.
 */
interface StepContext {
  recordingStartTime: number
  visionBudget: { used: number }
  hasCredentials: boolean
  /** When credentials are present, authed product URLs (/app, /dashboard, /auth/callback) are allowed. */
}

/**
 * Executes a single demo step and records clip timestamps.
 *
 * Scroll actions use a smooth JS easing animation (1.2 s) so CDP screencast
 * captures every intermediate frame — the result looks buttery smooth in the video.
 *
 * Click actions use Playwright's native locator.click() which handles auto-waits,
 * auto-scroll, and href navigation naturally — much more reliable than mouse.click
 * at coordinates.
 */
async function executeAndCapture(
  page: Page,
  step: DemoStep,
  stepIndex: number,
  productUrl: string,
  ctx: StepContext
): Promise<SceneCapture> {
  const clips: { start: number; end: number }[] = []
  let targetElement: ElementBox | null = null
  let elementNotFound = false
  const getT = () => Date.now() - ctx.recordingStartTime

  try {
    const actionStart = getT()

    switch (step.action) {
      case 'navigate': {
        const targetUrl = step.navigate_to?.startsWith('http')
          ? step.navigate_to
          : new URL(step.navigate_to || '', productUrl).href

        // With credentials present, authed URLs (/app, /dashboard) are part of the demo.
        // Without credentials, still block all auth-form URLs to avoid recording login screens.
        if (!ctx.hasCredentials && isAuthUrl(targetUrl)) {
          logger.warn(`step ${stepIndex}: blocking auth navigation to ${targetUrl}`)
          break
        }

        logger.info(`step ${stepIndex}: navigating to ${targetUrl}`)
        await page.goto(targetUrl, { waitUntil: 'load', timeout: 25000 }).catch(() => {})
        await page.addStyleTag({ content: POPUP_HIDE_CSS }).catch(() => {})
        clips.push({ start: actionStart, end: getT() })
        break
      }

      case 'click': {
        const urlBefore = page.url()
        const scrollBefore = await page.evaluate(() => window.scrollY).catch(() => 0)
        const beforeShot = await page.screenshot({ type: 'jpeg', quality: 20 }).catch(() => null)

        // Prefer Playwright's native locator — handles href navigation, auto-waits, scroll.
        const locator = await findLocator(page, step.element_to_click)
        if (locator) {
          try {
            await locator.scrollIntoViewIfNeeded({ timeout: 2000 })
            const box = await locator.boundingBox()
            if (box) {
              targetElement = {
                x: Math.round(box.x + box.width / 2),
                y: Math.round(box.y + box.height / 2),
                width: Math.round(box.width),
                height: Math.round(box.height),
              }
              // Animate cursor toward the target before clicking
              await page.mouse.move(targetElement.x, targetElement.y, { steps: 20 })
              await page.waitForTimeout(200)
            }
            const preAction = getT()
            await locator.click({ timeout: 5000, delay: 120 })
            clips.push({ start: Math.max(0, preAction - 300), end: getT() + 200 })
          } catch (clickErr) {
            logger.warn(`step ${stepIndex}: locator.click failed`, { err: clickErr })
            elementNotFound = true
          }
        } else {
          // Vision fallback: identify element text then re-try locator
          targetElement = await findElementBox(page, step.element_to_click, step.description, ctx.visionBudget)
          if (targetElement) {
            const preAction = getT()
            await page.mouse.move(targetElement.x, targetElement.y, { steps: 20 })
            await page.waitForTimeout(200)
            await page.mouse.click(targetElement.x, targetElement.y, { delay: 120 })
            clips.push({ start: Math.max(0, preAction - 300), end: getT() + 200 })
          } else {
            elementNotFound = true
          }
        }

        if (elementNotFound) {
          logger.warn(`step ${stepIndex}: "${step.element_to_click}" not found after locator + vision`)
          clips.push({ start: actionStart, end: getT() + 500 })
          break
        }

        // URL-sanity: did anything actually change? If not, keep the action clip
        // but shorten the dwell — a small-change click is still content (e.g. a
        // tooltip, a subtle menu reveal) and is far better than zero scenes.
        await page.waitForTimeout(500)
        const urlAfter = page.url()
        const scrollAfter = await page.evaluate(() => window.scrollY).catch(() => 0)
        let shortenedDwell = false
        if (urlBefore === urlAfter && Math.abs(scrollBefore - scrollAfter) < 10 && beforeShot) {
          try {
            const afterShot = await page.screenshot({ type: 'jpeg', quality: 20 })
            const sizeDiff = Math.abs(afterShot.length - beforeShot.length) / Math.max(beforeShot.length, 1)
            if (sizeDiff < 0.02) {
              logger.warn(`step ${stepIndex}: click had no visible effect — shortening dwell`)
              shortenedDwell = true
            }
          } catch { /* non-fatal */ }
        }
        if (shortenedDwell) {
          // Skip the long dwell and the networkidle wait; return what we have.
          return {
            step: stepIndex,
            action: step.action,
            description: step.description,
            narration: step.narration,
            clips,
            targetElement,
            typeText: step.type_text ?? null,
            elementNotFound: false,
            pageUrl: page.url(),
          }
        }
        break
      }

      case 'type': {
        const locator = await findLocator(page, step.element_to_click)
        if (locator) {
          try {
            await locator.scrollIntoViewIfNeeded({ timeout: 2000 })
            const box = await locator.boundingBox()
            if (box) {
              targetElement = {
                x: Math.round(box.x + box.width / 2),
                y: Math.round(box.y + box.height / 2),
                width: Math.round(box.width),
                height: Math.round(box.height),
              }
              await page.mouse.move(targetElement.x, targetElement.y, { steps: 20 })
              await page.waitForTimeout(150)
            }
            const preAction = getT()
            await locator.click({ timeout: 5000 })
            await page.keyboard.type(step.type_text ?? 'hello world', { delay: 70 })
            await page.waitForTimeout(300)
            clips.push({ start: Math.max(0, preAction - 300), end: getT() })
          } catch (typeErr) {
            logger.warn(`step ${stepIndex}: type failed`, { err: typeErr })
            elementNotFound = true
          }
        } else {
          targetElement = await findElementBox(page, step.element_to_click, step.description, ctx.visionBudget)
          if (targetElement) {
            const preAction = getT()
            await page.mouse.move(targetElement.x, targetElement.y, { steps: 20 })
            await page.mouse.click(targetElement.x, targetElement.y, { delay: 100 })
            await page.keyboard.type(step.type_text ?? 'hello world', { delay: 70 })
            await page.waitForTimeout(300)
            clips.push({ start: Math.max(0, preAction - 300), end: getT() })
          } else {
            elementNotFound = true
          }
        }
        if (elementNotFound) {
          clips.push({ start: actionStart, end: getT() + 500 })
        }
        break
      }

      case 'hover': {
        targetElement = await findElementBox(page, step.element_to_click, step.description, ctx.visionBudget)
        if (targetElement) {
          const preAction = getT()
          await page.mouse.move(targetElement.x, targetElement.y, { steps: 25 })
          await page.waitForTimeout(1000)
          clips.push({ start: Math.max(0, preAction - 200), end: getT() })
        } else {
          elementNotFound = true
          clips.push({ start: actionStart, end: getT() + 500 })
        }
        break
      }

      case 'scroll_down':
      case 'scroll_up': {
        const preAction = getT()
        const scrollAmount = step.action === 'scroll_down' ? 700 : -700
        await page.evaluate((amount: number) => {
          return new Promise<void>((resolve) => {
            const start = window.scrollY
            const target = Math.max(0, Math.min(
              start + amount,
              document.body.scrollHeight - window.innerHeight
            ))
            const duration = 1200
            const startTime = performance.now()
            const ease = (t: number) =>
              t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
            const tick = (now: number) => {
              const progress = Math.min((now - startTime) / duration, 1)
              window.scrollTo(0, start + (target - start) * ease(progress))
              if (progress < 1) requestAnimationFrame(tick)
              else resolve()
            }
            requestAnimationFrame(tick)
          })
        }, scrollAmount)
        await page.waitForTimeout(400)
        clips.push({ start: preAction, end: getT() })
        break
      }

      case 'wait': {
        clips.push({ start: actionStart, end: actionStart + 2000 })
        await page.waitForTimeout(2000)
        break
      }

      default: {
        clips.push({ start: actionStart, end: actionStart + 1000 })
        await page.waitForTimeout(1000)
      }
    }

    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    await page.addStyleTag({ content: POPUP_HIDE_CSS }).catch(() => {})

    // Dwell clip — viewer absorbs the result
    const resultStart = getT()
    let displayMs: number
    switch (step.action) {
      case 'navigate': displayMs = 5000; break
      case 'click':    displayMs = 4000; break
      case 'type':     displayMs = 3000; break
      default:         displayMs = 2500
    }
    await page.waitForTimeout(displayMs)
    clips.push({ start: resultStart, end: getT() })

  } catch (error) {
    logger.warn(`step ${stepIndex} (${step.action}) failed`, { error })
  }

  return {
    step: stepIndex,
    action: step.action,
    description: step.description,
    narration: step.narration,
    clips,
    targetElement,
    typeText: step.type_text ?? null,
    elementNotFound,
    pageUrl: page.url(),
  }
}

// ─── Main Recorder ───────────────────────────────────────────────────────────

/**
 * Records a product demo using Playwright's built-in recordVideo.
 *
 * Architecture:
 * - Text-plan spine: `understanding.demo_flow` provides the itinerary (real URLs
 *   from Firecrawl-scraped content). Each `navigate` step goes directly to that URL.
 * - Per-page vision: after each navigate, `planPageInteractions()` decides 2-4
 *   in-page clicks/scrolls/types based on what's actually on the page.
 * - No vision-driven navigation: Gemini Vision never picks URLs, eliminating
 *   404s from hallucinated paths and anchor clicks that don't change the page.
 *
 * Recording: Chrome native tab capture via Playwright recordVideo at ~25fps,
 * re-encoded to smooth 30fps H.264 MP4 via FFmpeg with lanczos scaling.
 */
export async function recordProduct(
  productUrl: string,
  understanding: ProductUnderstanding,
  jobId: string,
  credentials?: { username: string; password: string },
  startUrl?: string
): Promise<string> {
  const outputDir = path.join(RECORDINGS_DIR, jobId)
  fs.mkdirSync(outputDir, { recursive: true })

  let storageStatePath: string | undefined
  let detectedDashboardUrl: string | null = null

  if (credentials) {
    const stateFile = path.join(outputDir, 'auth-state.json')
    const loginResult = await performLoginAndSaveState(productUrl, credentials, stateFile)
    if (loginResult.success) {
      storageStatePath = stateFile
      detectedDashboardUrl = loginResult.dashboardUrl
      logger.info('recorder: login succeeded — browser will start pre-authenticated')
    } else {
      logger.warn('recorder: login failed — recording without authentication')
    }
  }

  const browser = await chromium.launch({ headless: true, args: BROWSER_ARGS })

  try {
    const context = await browser.newContext({
      viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      userAgent: USER_AGENT,
      deviceScaleFactor: 1,
      permissions: [],
      recordVideo: {
        dir: outputDir,
        size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      },
      ...(storageStatePath ? { storageState: storageStatePath } : {}),
    })

    const page = await context.newPage()
    const recordingStartTime = Date.now()

    context.setDefaultTimeout(15000)
    context.setDefaultNavigationTimeout(30000)

    await page.route('**/*.{mp4,webm,ogg,avi}', (route) => route.abort())
    await page.addInitScript(CURSOR_SCRIPT)

    // ── Navigate to the recording start URL ──
    // Priority: explicit startUrl > post-login dashboard URL > product marketing URL
    const recordingUrl = startUrl ?? detectedDashboardUrl ?? productUrl
    logger.info(`recorder: navigating to ${recordingUrl}`)

    await page.goto(recordingUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(async () => {
      await page.goto(recordingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    })
    await page.addStyleTag({ content: POPUP_HIDE_CSS }).catch(() => {})
    await page.waitForTimeout(1500)

    // ── Click-driven discovery ──
    // No guessed URLs. The recording walks the product by clicking visible links
    // Gemini picks from screenshots. Each new page is discovered only by clicking
    // something real on the previous page, so 404s from hallucinated URLs are
    // impossible and each subpage gets meaningful per-page interaction before we
    // navigate away.
    const hasCredentials = !!storageStatePath
    const visionBudget = { used: 0 }
    const ctx: StepContext = { recordingStartTime, visionBudget, hasCredentials }

    const visitedUrls: string[] = [recordingUrl]
    const scenes: SceneCapture[] = []
    let sceneIdx = 0

    // Guaranteed landing-page dwell. A scroll-down + scroll-up pair captures the
    // hero section regardless of whether vision succeeds — guarantees the final
    // video always has at least ~8s of real product content.
    sceneIdx++
    const introScroll = await executeAndCapture(
      page,
      {
        step: sceneIdx,
        action: 'scroll_down',
        description: 'Scroll to reveal the hero section',
        narration: `Here's ${understanding.product_name}.`,
      },
      sceneIdx,
      productUrl,
      ctx
    )
    scenes.push(introScroll)

    sceneIdx++
    const introScrollUp = await executeAndCapture(
      page,
      {
        step: sceneIdx,
        action: 'scroll_up',
        description: 'Return to the top of the landing page',
        narration: understanding.tagline || `${understanding.product_name} — at a glance.`,
      },
      sceneIdx,
      productUrl,
      ctx
    )
    scenes.push(introScrollUp)

    const MAX_SCENES = 22
    const MAX_PAGES = 5

    // Walk the product by click-driven discovery: plan actions on the current
    // page (allowing a final nav click), execute them, and when the URL changes
    // the loop continues on the new page with a fresh vision pass.
    while (sceneIdx < MAX_SCENES && visitedUrls.length < MAX_PAGES) {
      const urlBefore = page.url()
      const sceneIdxBefore = sceneIdx
      const isLastPage = visitedUrls.length >= MAX_PAGES - 1

      sceneIdx = await playPageInteractions(
        page,
        understanding,
        visitedUrls,
        productUrl,
        ctx,
        sceneIdx,
        scenes,
        !isLastPage,  // allowNavigation: false on the last page
      )

      // Vision returned nothing — page is exhausted or Gemini is down
      if (sceneIdx === sceneIdxBefore) {
        logger.info('recorder: vision produced no further steps — ending session')
        break
      }

      const urlAfter = page.url()
      const normalizedAfter = normalizeUrl(urlAfter)
      const alreadyVisited = visitedUrls.some((u) => normalizeUrl(u) === normalizedAfter)

      if (urlAfter !== urlBefore && !alreadyVisited) {
        visitedUrls.push(urlAfter)
        logger.info(`recorder: discovered new page via click → ${urlAfter} (page ${visitedUrls.length}/${MAX_PAGES})`)
        await page.addStyleTag({ content: POPUP_HIDE_CSS }).catch(() => {})
      } else if (urlAfter !== urlBefore && alreadyVisited) {
        logger.info(`recorder: click looped back to a visited page — ending session`)
        break
      } else {
        logger.info(`recorder: URL did not change after this page's actions — ending session`)
        break
      }
    }

    // ── Emergency safety net ──
    // If every scene failed to produce a real clip (vision down + navigate
    // failed + all clicks rejected), synthesize scroll scenes on the current
    // page so the video isn't just intro + placeholder + outro.
    const productiveSceneCount = scenes.filter((s) => s.clips.some((c) => c.end - c.start >= 800)).length
    if (productiveSceneCount === 0) {
      logger.warn('recorder: zero productive scenes — generating emergency safety clips')
      for (let i = 0; i < 3; i++) {
        sceneIdx++
        const action: DemoStep['action'] = i % 2 === 0 ? 'scroll_down' : 'scroll_up'
        const safetyScene = await executeAndCapture(
          page,
          {
            step: sceneIdx,
            action,
            description: i === 0 ? 'Scroll through the product page' : 'Continue exploring the page',
            narration: i === 0
              ? `Take a closer look at ${understanding.product_name}.`
              : `${understanding.product_name} makes it simple.`,
          },
          sceneIdx,
          productUrl,
          ctx
        )
        scenes.push(safetyScene)
      }
    }

    logger.info(`recorder: ${scenes.length} scenes recorded across ${visitedUrls.length} URL(s): ${visitedUrls.join(', ')}`)
    await page.waitForTimeout(1500)

    const videoObj = page.video()
    await context.close()

    if (!videoObj) {
      throw new Error('Playwright recordVideo returned no video object — check browser launch args')
    }

    const webmPath = await videoObj.path()
    if (!webmPath || !fs.existsSync(webmPath)) {
      throw new Error(`recordVideo file not found at: ${webmPath ?? 'null'}`)
    }

    logger.info(`recorder: WebM recorded (${Math.round(fs.statSync(webmPath).size / 1024 / 1024)} MB) — converting to MP4`)

    // Re-encode preserving wall-clock time. Playwright's recordVideo produces a
    // variable-rate WebM whose PTS timeline is correct but sparse. `fps=30` as a
    // filter was previously compressing content (fast-forward effect); using
    // `-fps_mode cfr -r 30` tells FFmpeg to synthesize 30fps constant-rate output
    // while respecting the source PTS — duration stays identical to real time.
    const recordingMp4 = path.join(outputDir, 'recording.mp4')
    await spawnFfmpegLocal(
      getFfmpegPath(),
      [
        '-i', toFfPath(webmPath),
        '-vf', 'scale=1920:1080:flags=lanczos',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-fps_mode', 'cfr',
        '-r', '30',
        '-g', '30',
        '-video_track_timescale', '30000',
        '-y', toFfPath(recordingMp4),
      ],
      300_000
    )

    fs.rmSync(webmPath, { force: true })

    logger.info(`recorder: recording.mp4 saved (${Math.round(fs.statSync(recordingMp4).size / 1024 / 1024)} MB)`)

    const manifest: RecordingManifest = {
      productUrl: recordingUrl,
      productName: understanding.product_name,
      tagline: understanding.tagline,
      totalScenes: scenes.length,
      scenes,
    }
    const manifestPath = path.join(outputDir, 'manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
    logger.info(`recorder: manifest saved → ${manifestPath}`)

    return outputDir
  } finally {
    await browser.close()
  }
}

/**
 * Runs per-page vision planning and executes returned steps. Returns the updated
 * scene index so the caller can continue numbering.
 *
 * Actions execute in order on the live page. If one of the clicks navigates to
 * a new URL mid-plan, subsequent actions execute against the new page (which is
 * usually fine for the final nav step but becomes noise for anything after).
 * To keep plans coherent, we stop executing the plan as soon as the URL changes.
 */
async function playPageInteractions(
  page: Page,
  understanding: ProductUnderstanding,
  visitedUrls: string[],
  productUrl: string,
  ctx: StepContext,
  sceneIdx: number,
  scenes: SceneCapture[],
  allowNavigation: boolean = true,
): Promise<number> {
  try {
    const startUrl = page.url()
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 })
    const pageSteps = await planPageInteractions(
      screenshot.toString('base64'),
      startUrl,
      understanding.product_name,
      understanding,
      visitedUrls,
      allowNavigation,
    )
    for (const pageStep of pageSteps) {
      sceneIdx++
      logger.info(`recorder: in-page step ${sceneIdx} — ${pageStep.action}: ${pageStep.description}`)
      const scene = await executeAndCapture(page, pageStep, sceneIdx, productUrl, ctx)
      scenes.push(scene)
      // Stop the plan once the URL changes — remaining steps were planned
      // against the previous page's screenshot and won't match what's visible now.
      if (page.url() !== startUrl) {
        logger.info(`recorder: URL changed mid-plan, stopping remaining steps for this page`)
        break
      }
    }
  } catch (err) {
    logger.warn('recorder: in-page vision planning failed', { err })
  }
  return sceneIdx
}

/** Normalizes a URL for deduplication (strips trailing slash, fragment, www). */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    let href = u.toString()
    if (href.endsWith('/')) href = href.slice(0, -1)
    return href.replace(/^https?:\/\/www\./, 'https://')
  } catch {
    return url
  }
}
