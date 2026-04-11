import fs from 'fs'
import path from 'path'
import os from 'os'
import { chromium, type Page } from 'playwright'
import { logger } from '../lib/logger'
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
  `--window-size=${VIDEO_WIDTH},${VIDEO_HEIGHT}`,
]

/**
 * Script injected to render a custom mouse cursor.
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

// ─── Element Finding (Multi-Strategy) ────────────────────────────────────────

async function findElement(
  page: Page,
  selector: string | undefined
): Promise<ElementBox | null> {
  if (!selector) return null

  // ── Strategy 1: Playwright locators ──
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, 'i')
  const locatorStrategies = [
    page.getByRole('button', { name: re }),
    page.getByRole('link', { name: re }),
    page.getByRole('menuitem', { name: re }),
    page.getByRole('tab', { name: re }),
    page.locator('button', { hasText: re }),
    page.locator('a', { hasText: re }),
    page.getByPlaceholder(re),
    page.getByLabel(re),
  ]

  for (const locator of locatorStrategies) {
    try {
      const first = locator.first()
      await first.waitFor({ state: 'visible', timeout: 1500 })
      await first.scrollIntoViewIfNeeded()
      await page.waitForTimeout(300)
      const box = await first.boundingBox()
      if (box && box.width > 0 && box.height > 0) {
        logger.info(`findElement: found "${selector}" via Playwright locator`)
        return {
          x: Math.round(box.x + box.width / 2),
          y: Math.round(box.y + box.height / 2),
          width: Math.round(box.width),
          height: Math.round(box.height)
        }
      }
    } catch { continue }
  }

  // ── Strategy 2: DOM fuzzy search ──
  try {
    const result = await page.evaluate(
      (targetText: string): ElementBox | null => {
        targetText = targetText.toLowerCase().trim()

        const elements = Array.from(document.querySelectorAll(
          'button, a, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input, select, textarea, label, [class*="btn"], [class*="cta"]'
        ))
        let bestMatch: HTMLElement | null = null
        let bestScore = -1

        for (const el of elements as HTMLElement[]) {
          const style = window.getComputedStyle(el)
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue
          const rect = el.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) continue

          const text = (
            el.innerText ||
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            el.getAttribute('title') ||
            ''
          ).toLowerCase().trim()
          if (!text) continue

          // Exact match
          if (text === targetText) {
            bestMatch = el
            bestScore = 1000
            break
          }

          // Contains match
          if (text.includes(targetText) && targetText.length >= 2) {
            const score = 100 - (text.length - targetText.length)
            if (score > bestScore) {
              bestScore = score
              bestMatch = el
            }
          }

          if (targetText.includes(text) && text.length >= 3) {
            const score = 80 - (targetText.length - text.length)
            if (score > bestScore) {
              bestScore = score
              bestMatch = el
            }
          }
        }

        if (bestMatch && bestScore > 0) {
          bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
          const rect = bestMatch.getBoundingClientRect()
          return {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        }
        return null
      },
      selector
    )

    if (result) {
      logger.info(`findElement: found "${selector}" via DOM fuzzy search at [${result.x}, ${result.y}]`)
      await page.waitForTimeout(500)
      return result
    }
  } catch (e) {
    logger.warn(`findElement: DOM search error`, { e })
  }

  // ── Strategy 3: getByText fallback ──
  try {
    const textLocator = page.getByText(selector, { exact: false }).first()
    await textLocator.waitFor({ state: 'visible', timeout: 2000 })
    await textLocator.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    const box = await textLocator.boundingBox()
    if (box && box.width > 0 && box.height > 0) {
      logger.info(`findElement: found "${selector}" via getByText fallback`)
      return {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
        width: Math.round(box.width),
        height: Math.round(box.height)
      }
    }
  } catch { /* non-fatal */ }

  logger.warn(`findElement: could not find "${selector}" with any strategy`)
  return null
}

/**
 * Captures a simplified text-based representation of the current page for Gemini.
 */
async function getPageState(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const nodes: string[] = []
    function walk(el: Element, depth: number) {
      if (depth > 10) return
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return
      
      const tag = el.tagName.toLowerCase()
      const text = (el as HTMLElement).innerText?.trim() || ''
      const role = el.getAttribute('role') || ''
      const alt = el.getAttribute('alt') || ''
      const ph = el.getAttribute('placeholder') || ''
      
      if (['button', 'a', 'input', 'select', 'textarea', 'label'].includes(tag) || role) {
        nodes.push(`${'  '.repeat(depth)}[${tag}]${role ? ' role='+role : ''}${text ? ' text="'+text+'"' : ''}${alt ? ' alt="'+alt+'"' : ''}${ph ? ' placeholder="'+ph+'"' : ''}`)
      }
      
      for (const child of Array.from(el.children)) {
        walk(child, depth + 1)
      }
    }
    walk(document.body, 0)
    return nodes.join('\n')
  })
}

// ─── Login ─────────────────────────────────────────

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

    const emailTogglePhrases = [/sign.?in with email/i, /continue with email/i, /log.?in with email/i, /use email/i]
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
    if (!emailFilled) { logger.warn('login: could not find email field'); return false }

    const nextButtonPatterns = [/^next$/i, /^continue$/i, /^proceed$/i]
    for (const pattern of nextButtonPatterns) {
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
      return false
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

    await context.storageState({ path: stateFilePath })
    logger.info(`login: session saved → ${stateFilePath}`)
    return true
  } catch (err) {
    logger.warn('login: failed', { error: err })
    return false
  } finally {
    await browser.close()
  }
}

// ─── Step Execution ──────────────────────────────────────────────────────────

async function executeAndCapture(
  page: Page,
  step: DemoStep,
  stepIndex: number,
  productUrl: string,
  recordingStartTime: number
): Promise<SceneCapture> {
  const clips: { start: number; end: number }[] = []
  let targetElement: ElementBox | null = null
  let elementNotFound = false
  
  const getRelativeTime = () => Date.now() - recordingStartTime

  try {
    // 1. Action Phase (Curated clip for the interaction)
    const actionStartTime = getRelativeTime()

    switch (step.action) {
      case 'navigate': {
        const targetUrl = step.navigate_to?.startsWith('http')
          ? step.navigate_to
          : new URL(step.navigate_to || '', productUrl).href

        if (/(login|signin|sign-in|signup|sign-up|auth|register|oauth|sso)/i.test(targetUrl)) {
          logger.warn(`step ${stepIndex}: skipping auth URL: ${targetUrl}`)
          break
        }

        const navOk = await page.evaluate((url) => {
           if (window.location.href === url) return true;
           window.location.href = url;
           return true;
        }, targetUrl).catch(() => false);
        
        if (!navOk) {
          await page.goto(targetUrl, { waitUntil: 'load', timeout: 20000 }).catch(() => {})
        }
        
        // Navigation is mostly "loading", so we just mark finishing action.
        clips.push({ start: actionStartTime, end: getRelativeTime() })
        break
      }

      case 'click': {
        targetElement = await findElement(page, step.element_to_click)
        if (targetElement) {
          // Pre-action buffer
          const preAction = getRelativeTime()
          await page.mouse.move(targetElement.x, targetElement.y, { steps: 20 })
          await page.waitForTimeout(200)
          await page.mouse.click(targetElement.x, targetElement.y, { delay: 150 })
          
          clips.push({ start: Math.max(0, preAction - 300), end: getRelativeTime() + 200 })
        } else {
          elementNotFound = true
          logger.warn(`step ${stepIndex}: element "${step.element_to_click}" not found`)
          clips.push({ start: actionStartTime, end: getRelativeTime() + 500 })
        }
        break
      }

      case 'type': {
        targetElement = await findElement(page, step.element_to_click)
        if (targetElement) {
          const preAction = getRelativeTime()
          await page.mouse.move(targetElement.x, targetElement.y, { steps: 20 })
          await page.waitForTimeout(100)
          await page.mouse.click(targetElement.x, targetElement.y, { delay: 100 })
          
          const textToType = step.type_text ?? 'hello world'
          await page.keyboard.type(textToType, { delay: 60 })
          await page.waitForTimeout(300)
          
          clips.push({ start: Math.max(0, preAction - 300), end: getRelativeTime() })
        } else {
          elementNotFound = true
          clips.push({ start: actionStartTime, end: getRelativeTime() + 500 })
        }
        break
      }

      case 'hover': {
        targetElement = await findElement(page, step.element_to_click)
        if (targetElement) {
          const preAction = getRelativeTime()
          await page.mouse.move(targetElement.x, targetElement.y, { steps: 25 })
          await page.waitForTimeout(1000)
          clips.push({ start: Math.max(0, preAction - 200), end: getRelativeTime() })
        } else {
          elementNotFound = true
          clips.push({ start: actionStartTime, end: getRelativeTime() + 500 })
        }
        break
      }

      case 'scroll_down':
      case 'scroll_up': {
        const preAction = getRelativeTime()
        const amount = step.action === 'scroll_down' ? 600 : -600
        await page.evaluate((top) => window.scrollBy({ top, behavior: 'smooth' }), amount)
        await page.waitForTimeout(1200)
        clips.push({ start: preAction, end: getRelativeTime() })
        break
      }

      case 'wait': {
        clips.push({ start: actionStartTime, end: actionStartTime + 2000 })
        await page.waitForTimeout(2000)
        break
      }

      default: {
        clips.push({ start: actionStartTime, end: actionStartTime + 1000 })
        await page.waitForTimeout(1000)
      }
    }

    // 2. Result Phase (Capture the "Outcome" after any network/loading finishes)
    // This allows us to jump-cut from a click directly to the result.
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    await page.addStyleTag({ content: POPUP_HIDE_CSS }).catch(() => {})
    
    const resultStartTime = getRelativeTime()
    // Show the result for 2-3 seconds depending on action
    const displayDuration = step.action === 'navigate' ? 4000 : 2500
    await page.waitForTimeout(displayDuration)
    
    clips.push({ start: resultStartTime, end: getRelativeTime() })

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

import { analyzePageState } from '../lib/gemini'

/**
 * Records a continuous product demo using Playwright native video recording.
 */
export async function recordProduct(
  productUrl: string,
  understanding: ProductUnderstanding,
  jobId: string,
  credentials?: { username: string; password: string }
): Promise<string> {
  const outputDir = path.join(RECORDINGS_DIR, jobId)
  const videoDir = path.join(outputDir, 'video')
  fs.mkdirSync(outputDir, { recursive: true })
  fs.mkdirSync(videoDir, { recursive: true })

  // ── Login in separate context (never captured) ──
  let storageStatePath: string | undefined
  if (credentials) {
    const stateFile = path.join(outputDir, 'auth-state.json')
    const ok = await performLoginAndSaveState(productUrl, credentials, stateFile)
    if (ok) {
      storageStatePath = stateFile
      logger.info('recorder: login succeeded — browser will be pre-authenticated')
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
        dir: videoDir,
        size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT }
      },
      ...(storageStatePath ? { storageState: storageStatePath } : {}),
    })

    const page = await context.newPage()
    
    context.setDefaultTimeout(15000)
    context.setDefaultNavigationTimeout(30000)

    // Block heavy media that slows rendering
    await page.route('**/*.{mp4,webm,ogg,avi}', (route) => route.abort())

    // ── Inject Cursor ──
    await page.addInitScript(CURSOR_SCRIPT)

    // ── Navigate to product ──
    logger.info(`recorder: navigating to ${productUrl}`)
    
    // We start absolute timing
    const recordingStartTime = Date.now()
    
    const response = await page.goto(productUrl, {
      waitUntil: 'networkidle',
      timeout: 60000,
    })
    if (!response || !response.ok()) {
      throw new Error(`Could not access product URL. Status: ${response?.status() ?? 'unknown'}`)
    }

    await page.addStyleTag({ content: POPUP_HIDE_CSS }).catch(() => {})
    await page.waitForTimeout(2000)

    // ── Filter out auth-related steps ──
    const AUTH_FILTER = /(login|log.?in|sign.?in|signin|sign.?up|signup|register|google|oauth|sso|auth|password|credential|forgot|reset.?password)/i
    const demoSteps = understanding.demo_flow.filter((step) => {
      const combined = [step.description, step.navigate_to, step.element_to_click, step.type_text]
        .filter(Boolean)
        .join(' ')
      return !AUTH_FILTER.test(combined)
    })

    const filteredSteps: typeof demoSteps = []
    let consecutiveScrolls = 0
    let totalScrolls = 0
    for (const step of demoSteps) {
      if (step.action === 'scroll_down' || step.action === 'scroll_up') {
        consecutiveScrolls++
        totalScrolls++
        if (consecutiveScrolls > 2 || totalScrolls > 4) continue
      } else {
        consecutiveScrolls = 0
      }
      filteredSteps.push(step)
    }

    const scenes: SceneCapture[] = []
    logger.info(`recorder: executing ${filteredSteps.length} demo steps`)

    let currentSteps = [...filteredSteps]

    for (let i = 0; i < currentSteps.length; i++) {
      const step = currentSteps[i]
      const stepIndex = i + 1

      logger.info(`recorder: step ${stepIndex}/${currentSteps.length} — ${step.action}: ${step.description}`)

      // Dynamic Observation: If we just navigated or reached a milestone, observe the page to refine future steps
      if (step.action === 'navigate' || i === 0 || (i > 0 && currentSteps[i-1].action === 'click')) {
        try {
          // Extra wait for SPAs to settle
          await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
          
          const snapshot = await getPageState(page)
          const analysis = await analyzePageState(page.url(), snapshot, currentSteps.slice(i))
          
          if (analysis.corrections && analysis.corrections.length > 0) {
            logger.info(`recorder: gemini provided ${analysis.corrections.length} corrections for upcoming steps`)
            for (const correction of analysis.corrections) {
              const targetIdx = currentSteps.findIndex(s => s.step === correction.step_index)
              if (targetIdx !== -1) {
                logger.info(`recorder: correcting step ${correction.step_index}: "${currentSteps[targetIdx].element_to_click}" -> "${correction.new_element_text}"`)
                currentSteps[targetIdx].element_to_click = correction.new_element_text
              }
            }
          }
        } catch (err) {
          logger.warn('recorder: dynamic observation failed, continuing with original plan', { err })
        }
      }

      const scene = await executeAndCapture(page, step, stepIndex, productUrl, recordingStartTime)
      scenes.push(scene)
    }

    await page.waitForTimeout(2000) // End buffer

    // Explicitly grab the video path assigned by Playwright before closing context
    const videoPath = await page.video()?.path()
    if (!videoPath) {
      throw new Error('Playwright failed to generate a video recording.')
    }

    await context.close()

    // Move video file to a known name
    const finalVideoPath = path.join(outputDir, 'recording.webm')
    fs.renameSync(videoPath, finalVideoPath)

    const manifest: RecordingManifest = {
      productUrl,
      productName: understanding.product_name,
      tagline: understanding.tagline,
      totalScenes: scenes.length,
      scenes,
    }

    const manifestPath = path.join(outputDir, 'manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
    logger.info(`recorder: saved manifest with ${scenes.length} steps → ${manifestPath}`)

    return outputDir
  } finally {
    await browser.close()
  }
}
