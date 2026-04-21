import { chromium, type Page } from 'playwright'
import { logger } from '@/lib/logger'
import { discoverSitemapUrls } from '@/lib/sitemap'
import type { InteractiveInventory, InteractiveElement } from '@/types'

// ─── Configuration ────────────────────────────────────────────────────────────

const PAGE_LOAD_TIMEOUT = 15_000
const HYDRATION_WAIT = 2_500
const MAX_SUBPAGES_TO_VISIT = 5

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/**
 * Paths to skip during recon — login / auth / legal pages produce noise and
 * add nothing to the demo flow.
 */
const SKIP_PATTERNS: RegExp[] = [
  new RegExp('/login', 'i'),
  new RegExp('/logout', 'i'),
  new RegExp('/signup', 'i'),
  new RegExp('/register', 'i'),
  new RegExp('/auth/', 'i'),
  new RegExp('/password', 'i'),
  new RegExp('/reset', 'i'),
  new RegExp('/forgot', 'i'),
  new RegExp('/legal', 'i'),
  new RegExp('/privacy', 'i'),
  new RegExp('/terms', 'i'),
  new RegExp('/cookie', 'i'),
  new RegExp('/gdpr', 'i'),
  new RegExp('/careers?(/|$)', 'i'),
  new RegExp('/jobs?(/|$)', 'i'),
  new RegExp('/blog(/|$)', 'i'),
  new RegExp('/news(/|$)', 'i'),
  new RegExp('/press(/|$)', 'i'),
  new RegExp('/changelog(/|$)', 'i'),
  new RegExp('/status(/|$)', 'i'),
  new RegExp('/docs/', 'i'),
  new RegExp('/help/', 'i'),
  new RegExp('/support/', 'i'),
  new RegExp('\\.(xml|json|rss|atom|pdf|zip|png|jpg|svg|ico)$', 'i'),
  /[?#]/,
]

/**
 * Higher-priority paths get visited first during recon — these are the pages
 * most likely to contain demo-worthy interactions.
 */
const PRIORITY_PATHS: RegExp[] = [
  new RegExp('/features?(/|$)', 'i'),
  new RegExp('/pricing(/|$)', 'i'),
  new RegExp('/product(/|$)', 'i'),
  new RegExp('/dashboard(/|$)', 'i'),
  new RegExp('/app(/|$)', 'i'),
  new RegExp('/how-it-works(/|$)', 'i'),
  new RegExp('/solutions?(/|$)', 'i'),
  new RegExp('/platform(/|$)', 'i'),
  new RegExp('/demo(/|$)', 'i'),
  new RegExp('/tour(/|$)', 'i'),
  new RegExp('/overview(/|$)', 'i'),
  new RegExp('/use-cases?(/|$)', 'i'),
  new RegExp('/integrations?(/|$)', 'i'),
  new RegExp('/customers?(/|$)', 'i'),
  new RegExp('/showcase(/|$)', 'i'),
]

/** Scores a discovered URL for visit priority. -1 = skip. */
function scoreReconUrl(href: string, origin: string): number {
  try {
    const u = new URL(href)
    if (u.origin !== origin) return -1
    const p = u.pathname
    if (SKIP_PATTERNS.some((re) => re.test(p) || re.test(href))) return -1
    // Root scores highest
    if (p === '/' || p === '') return 100
    let score = 50
    if (PRIORITY_PATHS.some((re) => re.test(p))) score += 40
    // Prefer shorter paths (closer to root = more important)
    score -= (p.split('/').filter(Boolean).length - 1) * 10
    return Math.max(0, score)
  } catch {
    return -1
  }
}

// ─── DOM extraction ───────────────────────────────────────────────────────────

interface PageExtraction {
  links: Array<{ href: string; text: string }>
  buttons: Array<{ text: string }>
  inputs: Array<{ text: string }>
}

/**
 * Runs inside the browser page — extracts every same-origin link, visible
 * button, and input field with label or placeholder text.
 */
async function extractInteractiveElements(page: Page): Promise<PageExtraction> {
  return page.evaluate(() => {
    const origin = location.origin

    // ── Links ──────────────────────────────────────────────────────────
    const anchors = Array.from(document.querySelectorAll('a[href]'))
    const links: Array<{ href: string; text: string }> = []
    for (const a of anchors) {
      const el = a as HTMLAnchorElement
      const href = el.href
      if (!href || !href.startsWith(origin)) continue
      const text = (el.innerText || el.getAttribute('aria-label') || '').trim()
      if (!text || text.length > 80) continue
      // Skip invisible elements
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      links.push({ href, text })
    }

    // ── Buttons ────────────────────────────────────────────────────────
    const btns = Array.from(document.querySelectorAll('button, [role="button"]'))
    const buttons: Array<{ text: string }> = []
    for (const b of btns) {
      const el = b as HTMLElement
      const text = (el.innerText || el.getAttribute('aria-label') || '').trim()
      if (!text || text.length > 60) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      // Skip disabled buttons
      if (el.hasAttribute('disabled')) continue
      buttons.push({ text })
    }

    // ── Inputs ─────────────────────────────────────────────────────────
    const inputEls = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'))
    const inputs: Array<{ text: string }> = []
    for (const inp of inputEls) {
      const el = inp as HTMLInputElement
      const type = el.getAttribute('type') ?? 'text'
      if (['hidden', 'submit', 'button', 'image', 'file', 'checkbox', 'radio'].includes(type)) continue
      const text = (el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || '').trim()
      if (!text) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      inputs.push({ text })
    }

    return { links, buttons, inputs }
  })
}

// ─── Main recon function ──────────────────────────────────────────────────────

/**
 * Performs live Playwright reconnaissance on a product site.
 *
 * This is the primary subpage-discovery mechanism — it opens the site in a
 * real browser, lets JS hydrate, and extracts every real same-origin link and
 * interactive element. SPAs that render their nav with React/Vue/Svelte are
 * fully supported because Playwright executes JS.
 *
 * Discovery sources combined:
 * 1. `/sitemap.xml` + `/robots.txt` (via `discoverSitemapUrls`)
 * 2. Live DOM extraction from the root page
 * 3. Live DOM extraction from up to 5 high-priority subpages
 *
 * The returned `InteractiveInventory` is fed to Gemini so it can only
 * reference real, verified click targets and navigation URLs — killing
 * hallucinated element text and invented subpage paths.
 *
 * @param productUrl - The product's root URL
 * @param onProgress - Optional progress callback
 * @returns Deduped inventory of subpages and interactive elements
 */
export async function reconSite(
  productUrl: string,
  onProgress?: (msg: string) => Promise<void>,
): Promise<InteractiveInventory> {
  let origin: string
  try {
    origin = new URL(productUrl).origin
  } catch {
    return { subpages: [productUrl], elements: [] }
  }

  if (onProgress) await onProgress('Scanning site structure...')

  // ── 1. Sitemap discovery (fast, HTTP-only, runs in parallel) ────────────
  const sitemapPromise = discoverSitemapUrls(productUrl).catch(() => [] as string[])

  // ── 2. Live browser recon ──────────────────────────────────────────────
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  const allLinks = new Map<string, string>() // href → visible text
  const allElements: InteractiveElement[] = []
  const visitedRecon = new Set<string>()

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: USER_AGENT,
    })
    context.setDefaultTimeout(12_000)
    const page = await context.newPage()

    // Block heavy assets to speed up recon — we only need the DOM
    await page.route('**/*.{mp4,webm,ogg,avi,mp3,wav,woff2,woff,ttf,eot}', (route) => route.abort())
    await page.route('**/*.{png,jpg,jpeg,gif,svg,webp,ico}', (route) => route.abort())

    /**
     * Visits a single page, extracts links + interactive elements, and
     * merges results into the running inventory.
     */
    const visitPage = async (url: string): Promise<void> => {
      const trailingSlashRe = /\/+$/
      const normalized = url.replace(trailingSlashRe, '') || '/'
      if (visitedRecon.has(normalized)) return
      visitedRecon.add(normalized)

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT })
        // Give JS frameworks time to hydrate — critical for SPAs
        await page.waitForLoadState('networkidle', { timeout: HYDRATION_WAIT }).catch(() => {})
        await page.waitForTimeout(800)

        const extracted = await extractInteractiveElements(page)

        // Merge links
        for (const link of extracted.links) {
          const key = link.href.replace(trailingSlashRe, '') || '/'
          if (!allLinks.has(key)) {
            allLinks.set(key, link.text)
          }
          // Also register as an interactive element (clickable nav link)
          allElements.push({
            text: link.text,
            role: 'link',
            href: link.href,
            foundOn: url,
          })
        }

        // Merge buttons
        for (const btn of extracted.buttons) {
          allElements.push({
            text: btn.text,
            role: 'button',
            foundOn: url,
          })
        }

        // Merge inputs
        for (const inp of extracted.inputs) {
          allElements.push({
            text: inp.text,
            role: 'input',
            foundOn: url,
          })
        }

        logger.info(`recon: ${url} -> ${extracted.links.length} links, ${extracted.buttons.length} buttons, ${extracted.inputs.length} inputs`)
      } catch (err) {
        logger.warn(`recon: failed to visit ${url}`, { err })
      }
    }

    // Visit root page
    await visitPage(productUrl)
    if (onProgress) await onProgress('Scanned landing page. Exploring subpages...')

    // Pick top subpages to visit — score them by demo-worthiness
    const subpageCandidates = Array.from(allLinks.entries())
      .map(([href, text]) => ({ href, text, score: scoreReconUrl(href, origin) }))
      .filter((c) => c.score >= 0 && c.href !== productUrl && c.href !== `${origin}/`)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SUBPAGES_TO_VISIT)

    for (const candidate of subpageCandidates) {
      await visitPage(candidate.href)
      if (onProgress) {
        await onProgress(`Explored ${visitedRecon.size} pages...`)
      }
    }

    await context.close()
  } finally {
    await browser.close()
  }

  // ── 3. Merge with sitemap URLs ─────────────────────────────────────────
  const sitemapUrls = await sitemapPromise
  const trailingSlashRe = /\/+$/
  for (const sUrl of sitemapUrls) {
    const key = sUrl.replace(trailingSlashRe, '') || '/'
    if (!allLinks.has(key)) {
      try {
        const u = new URL(sUrl)
        if (u.origin === origin) {
          allLinks.set(key, u.pathname)
        }
      } catch { /* skip malformed */ }
    }
  }

  // ── 4. Build final inventory ───────────────────────────────────────────
  // Dedup subpages — score and sort best-first
  const subpages = Array.from(allLinks.keys())
    .map((href) => ({ href, score: scoreReconUrl(href, origin) }))
    .filter((u) => u.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((u) => u.href)

  // Dedup elements by text (case-insensitive)
  const seenTexts = new Set<string>()
  const dedupedElements: InteractiveElement[] = []
  for (const el of allElements) {
    const key = `${el.role}::${el.text.toLowerCase()}`
    if (seenTexts.has(key)) continue
    seenTexts.add(key)
    dedupedElements.push(el)
  }

  logger.info(
    `recon complete: ${subpages.length} subpages, ${dedupedElements.length} interactive elements ` +
    `(${dedupedElements.filter((e) => e.role === 'link').length} links, ` +
    `${dedupedElements.filter((e) => e.role === 'button').length} buttons, ` +
    `${dedupedElements.filter((e) => e.role === 'input').length} inputs)`,
  )

  return { subpages, elements: dedupedElements }
}
