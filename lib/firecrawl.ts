import { chromium } from 'playwright'
import { retryWithBackoff } from '@/lib/utils'
import { logger } from '@/lib/logger'

const FIRECRAWL_BASE    = 'https://api.firecrawl.dev/v1'
const SCRAPE_TIMEOUT_MS = 15_000
const MAP_TIMEOUT_MS    = 12_000
const MAX_PAGES         = 8   // scrape up to this many pages per product
const CHARS_PER_PAGE    = 10_000  // max chars kept per page before passing to Gemini
const FIRECRAWL_ATTEMPTS = 2  // retry twice, then fall back to Playwright

const PW_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/**
 * Paths that are not useful for understanding a product.
 * We skip these when choosing which pages to scrape.
 */
const EXCLUDE_PATTERNS = [
  /\/blog(\/|$)/i,
  /\/news(\/|$)/i,
  /\/press(\/|$)/i,
  /\/legal(\/|$)/i,
  /\/privacy/i,
  /\/terms/i,
  /\/cookie/i,
  /\/gdpr/i,
  /\/careers?(\/|$)/i,
  /\/jobs?(\/|$)/i,
  /\/team(\/|$)/i,
  /\/about\/team/i,
  /\/changelog(\/|$)/i,
  /\/status(\/|$)/i,
  /\/docs\//i,
  /\/help\//i,
  /\/support\//i,
  /\/login(\/|$)/i,
  /\/logout(\/|$)/i,
  /\/signup(\/|$)/i,
  /\/register(\/|$)/i,
  /\/auth\//i,
  /\.(xml|json|rss|atom|pdf|zip)$/i,
  /\?/,   // skip query-param URLs (usually dynamic/duplicate content)
  /#/,    // skip anchor links
]

/**
 * Paths that are very likely to contain core product information.
 * High-scoring pages get scraped first.
 */
const PRIORITY_PATTERNS = [
  /\/features?(\/|$)/i,
  /\/pricing(\/|$)/i,
  /\/product(\/|$)/i,
  /\/dashboard(\/|$)/i,
  /\/app(\/|$)/i,
  /\/how-it-works(\/|$)/i,
  /\/solutions?(\/|$)/i,
  /\/platform(\/|$)/i,
  /\/demo(\/|$)/i,
  /\/tour(\/|$)/i,
  /\/overview(\/|$)/i,
  /\/use-cases?(\/|$)/i,
  /\/why(\/|$)/i,
  /\/what-is(\/|$)/i,
  // Social-proof pages — testimonials and case studies give the script
  // real specificity (customer names, outcomes, numbers) instead of
  // generic marketing hype.
  /\/customers?(\/|$)/i,
  /\/case-stud(y|ies)(\/|$)/i,
  /\/testimonials?(\/|$)/i,
  /\/reviews?(\/|$)/i,
  /\/stories(\/|$)/i,
  /\/showcase(\/|$)/i,
  /\/integrations?(\/|$)/i,
]

/**
 * Scores a URL for crawl priority. Higher is better. -1 means skip entirely.
 */
function scoreUrl(url: string, baseUrl: string): number {
  try {
    const base = new URL(baseUrl)
    const u    = new URL(url)

    // Skip URLs on different domains
    if (u.hostname !== base.hostname) return -1

    const path = u.pathname
    if (EXCLUDE_PATTERNS.some((p) => p.test(path) || p.test(url))) return -1

    // Main URL scores highest
    if (url === baseUrl || path === base.pathname) return 100

    let score = 50
    if (PRIORITY_PATTERNS.some((p) => p.test(path))) score += 40
    // Prefer shorter paths (closer to root = more likely to be a key page)
    score -= (path.split('/').length - 1) * 8
    return Math.max(0, score)
  } catch {
    return -1
  }
}

/**
 * Scrapes a single URL via Firecrawl and returns its markdown content.
 * Short timeout + small retry count — if Firecrawl is degraded, the caller
 * (`crawlSite`) falls back to a Playwright scrape rather than hanging.
 */
export async function scrapeUrl(url: string): Promise<string> {
  return retryWithBackoff(async () => {
    let response: Response
    try {
      response = await fetch(`${FIRECRAWL_BASE}/scrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY ?? ''}`,
        },
        body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
        signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
      })
    } catch (error) {
      logger.error('scrapeUrl: network error', { url, error })
      throw new Error('Could not access this URL. Please check it is publicly accessible.')
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      logger.error('scrapeUrl: non-OK response from Firecrawl', { status: response.status, body: body.slice(0, 300) })
      throw new Error('Could not access this URL. Please check it is publicly accessible.')
    }

    const data = (await response.json()) as { success: boolean; data?: { markdown?: string } }

    if (!data.success || !data.data?.markdown) {
      logger.error('scrapeUrl: Firecrawl returned no markdown', { url })
      throw new Error('Could not extract content from this URL. Please check it is publicly accessible.')
    }

    return data.data.markdown
  }, FIRECRAWL_ATTEMPTS)
}

/**
 * Playwright-based fallback scraper. Works for ANY publicly accessible URL
 * that loads in a real Chromium browser — no external API dependency.
 *
 * Launches a single headless browser, visits the main URL, extracts readable
 * content + discovers same-origin links, then visits the top `maxPages - 1`
 * most-demo-worthy links (features/pricing/product/app-ish). Returns a
 * markdown-ish combined document in the same shape `crawlSite` emits from
 * Firecrawl, so downstream Gemini prompts don't need to know which source
 * produced the content.
 */
async function playwrightCrawl(
  productUrl: string,
  maxPages: number,
  onProgress?: (message: string) => Promise<void>
): Promise<string> {
  logger.info(`playwrightCrawl: launching browser for ${productUrl}`)
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: PW_USER_AGENT,
    })
    context.setDefaultTimeout(20_000)
    context.setDefaultNavigationTimeout(25_000)
    const page = await context.newPage()

    if (onProgress) await onProgress('Loading your site in a browser...')

    // Step 1: visit main URL and extract content + same-origin links
    try {
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    } catch (err) {
      logger.warn('playwrightCrawl: main URL goto failed', { err })
    }

    const mainExtracted = await extractPageContent(page, productUrl)
    if (!mainExtracted) {
      throw new Error('Could not access this URL. Please check it is publicly accessible.')
    }

    if (onProgress) await onProgress('Read main page. Exploring other pages...')

    // Step 2: pick top same-origin links to visit
    const extraSlots = Math.max(0, maxPages - 1)
    const candidates = mainExtracted.links
      .map((u: string) => ({ url: u, score: scoreUrl(u, productUrl) }))
      .filter((u) => u.score >= 0 && u.url !== productUrl)
      .sort((a, b) => b.score - a.score)
      .slice(0, extraSlots)
      .map((u) => u.url)

    const pages: Array<{ url: string; content: string }> = [
      { url: productUrl, content: mainExtracted.content },
    ]

    // Step 3: visit each candidate in the same context (reuses cookies, session)
    for (const linkUrl of candidates) {
      try {
        await page.goto(linkUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
        await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {})
        const extracted = await extractPageContent(page, linkUrl)
        if (extracted && extracted.content.length > 200) {
          pages.push({ url: linkUrl, content: extracted.content })
          if (onProgress) await onProgress(`Read ${pages.length} pages so far...`)
        }
      } catch (err) {
        logger.warn(`playwrightCrawl: failed to scrape ${linkUrl}`, { err })
      }
    }

    logger.info(`playwrightCrawl: scraped ${pages.length} page(s) via Playwright`)
    return pages
      .map(({ url, content }) => `### PAGE: ${url}\n\n${content.slice(0, CHARS_PER_PAGE)}`)
      .join('\n\n---\n\n')
  } finally {
    await browser.close()
  }
}

/**
 * Extracts readable content + same-origin links from a currently-loaded page.
 * Returns markdown-shaped content (title, description, headings, body text)
 * and a list of discovered links for crawling.
 */
async function extractPageContent(
  page: import('playwright').Page,
  url: string
): Promise<{ content: string; links: string[] } | null> {
  try {
    const data = await page.evaluate(() => {
      const title = document.title || ''
      const meta =
        (document.querySelector('meta[name="description"]') as HTMLMetaElement | null)?.content ||
        (document.querySelector('meta[property="og:description"]') as HTMLMetaElement | null)?.content ||
        ''
      const h1s = Array.from(document.querySelectorAll('h1'))
        .map((h) => (h as HTMLElement).innerText.trim())
        .filter(Boolean)
        .slice(0, 5)
      const h2s = Array.from(document.querySelectorAll('h2'))
        .map((h) => (h as HTMLElement).innerText.trim())
        .filter(Boolean)
        .slice(0, 12)
      const h3s = Array.from(document.querySelectorAll('h3'))
        .map((h) => (h as HTMLElement).innerText.trim())
        .filter(Boolean)
        .slice(0, 12)
      const bodyText = ((document.body as HTMLElement | null)?.innerText ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 8_000)
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h && h.startsWith(location.origin))
      return { title, meta, h1s, h2s, h3s, bodyText, links }
    })

    const sections: string[] = []
    if (data.title) sections.push(`# ${data.title}`)
    if (data.meta) sections.push(`> ${data.meta}`)
    if (data.h1s.length) sections.push(`## Main headings\n${data.h1s.map((h) => `- ${h}`).join('\n')}`)
    if (data.h2s.length) sections.push(`## Subheadings\n${data.h2s.map((h) => `- ${h}`).join('\n')}`)
    if (data.h3s.length) sections.push(`## Sections\n${data.h3s.map((h) => `- ${h}`).join('\n')}`)
    if (data.bodyText) sections.push(`## Content\n${data.bodyText}`)

    return {
      content: sections.join('\n\n'),
      links: Array.from(new Set(data.links)).slice(0, 60),
    }
  } catch (err) {
    logger.warn('extractPageContent: evaluate failed', { url, err })
    return null
  }
}

/**
 * Uses Firecrawl's map endpoint to discover all URLs on a domain.
 * Returns an empty array if the map call fails — callers should fall back to scrapeUrl.
 */
async function mapSiteUrls(productUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${FIRECRAWL_BASE}/map`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY ?? ''}`,
      },
      body: JSON.stringify({ url: productUrl, limit: 50 }),
      signal: AbortSignal.timeout(MAP_TIMEOUT_MS),
    })

    if (!response.ok) {
      logger.warn('mapSiteUrls: non-OK response', { status: response.status })
      return []
    }

    const data = (await response.json()) as { success: boolean; links?: string[] }
    return data.success && Array.isArray(data.links) ? data.links : []
  } catch (err) {
    logger.warn('mapSiteUrls: failed, will scrape main URL only', { error: err })
    return []
  }
}

export interface CrawlResult {
  /** Multi-page markdown content for Gemini to read. */
  content: string
  /**
   * Every unique subpage URL discovered on the domain, scored and sorted best-first.
   * Excludes login/auth/legal pages. These are passed to Gemini so it can reference
   * only real, verified URLs in `navigate_to` steps — not hallucinated paths.
   */
  siteMap: string[]
}

/**
 * Discovers and scrapes the most important pages of a product website.
 *
 * Strategy:
 * 1. Use Firecrawl's map endpoint to discover all site URLs
 * 2. Score and rank URLs — prioritise /features, /pricing, /dashboard, etc.
 *    Skip /blog, /legal, /docs, login pages, and query-param URLs
 * 3. Scrape the top MAX_PAGES URLs in parallel
 * 4. Return scraped content + full sorted URL list so Gemini can reference
 *    real URLs in navigate_to steps
 *
 * Falls back to a single-page Playwright scrape if mapping fails.
 */
export async function crawlSite(
  productUrl: string,
  onProgress?: (message: string) => Promise<void>
): Promise<CrawlResult> {
  if (onProgress) await onProgress('Mapping website structure...')
  logger.info(`crawlSite: mapping ${productUrl}`)

  // Step 1: discover URLs
  const allUrls = await mapSiteUrls(productUrl)
  logger.info(`crawlSite: discovered ${allUrls.length} URLs`)

  // Step 2: score, filter, and pick the best pages
  const scored = allUrls
    .map((url) => ({ url, score: scoreUrl(url, productUrl) }))
    .filter((u) => u.score >= 0)
    .sort((a, b) => b.score - a.score)

  // Always include the main URL; fill remaining slots from the scored list
  const mainUrl = productUrl
  const otherUrls = scored
    .filter((u) => u.url !== mainUrl)
    .slice(0, MAX_PAGES - 1)
    .map((u) => u.url)

  const urlsToScrape = [mainUrl, ...otherUrls]
  logger.info(`crawlSite: scraping ${urlsToScrape.length} pages`, { urls: urlsToScrape })

  // Step 3: scrape all pages in parallel; don't let one failure block the rest
  let completed = 0
  const results = await Promise.allSettled(
    urlsToScrape.map(async (url) => {
      try {
        const markdown = await scrapeUrl(url)
        completed++
        if (onProgress) {
          await onProgress(`Reading content... (${completed}/${urlsToScrape.length} pages)`)
        }
        return { url, content: markdown.slice(0, CHARS_PER_PAGE) }
      } catch (err) {
        logger.warn(`crawlSite: failed to scrape ${url}`, { error: err })
        return null
      }
    })
  )

  // Step 4: assemble into a single document with clear page separators
  const pages: Array<{ url: string; content: string }> = []
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      pages.push(result.value)
    }
  }

  if (pages.length === 0) {
    logger.warn('crawlSite: Firecrawl returned nothing — falling back to Playwright')
    if (onProgress) await onProgress('Scraping service degraded — using direct browser fetch...')
    try {
      const content = await playwrightCrawl(productUrl, MAX_PAGES, onProgress)
      return { content, siteMap: [productUrl] }
    } catch (err) {
      logger.error('crawlSite: Playwright fallback also failed', { err })
      throw new Error('Could not access this URL. Please check it is publicly accessible.')
    }
  }

  logger.info(`crawlSite: successfully scraped ${pages.length}/${urlsToScrape.length} pages`)
  if (onProgress) await onProgress(`Successfully read ${pages.length} pages. Finalizing analysis...`)

  // Full sorted URL list — passed to Gemini so it only references real URLs in navigate_to steps.
  const siteMap = scored.map((u) => u.url)
  if (!siteMap.includes(productUrl)) siteMap.unshift(productUrl)

  logger.info(`crawlSite: site map — ${siteMap.length} URLs discovered`)

  const combined = pages
    .map(({ url, content }) => `### PAGE: ${url}\n\n${content}`)
    .join('\n\n---\n\n')

  return { content: combined, siteMap }
}
