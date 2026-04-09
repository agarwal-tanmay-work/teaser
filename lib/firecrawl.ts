import { retryWithBackoff } from '@/lib/utils'
import { logger } from '@/lib/logger'

const FIRECRAWL_BASE    = 'https://api.firecrawl.dev/v1'
const SCRAPE_TIMEOUT_MS = 20_000
const MAP_TIMEOUT_MS    = 15_000
const MAX_PAGES         = 8   // scrape up to this many pages per product
const CHARS_PER_PAGE    = 6_000  // max chars kept per page before passing to Gemini

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
 * Scrapes a single URL and returns its markdown content.
 * Applies a 20-second timeout and retries up to 3 times with backoff.
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
  })
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

/**
 * Discovers and scrapes the most important pages of a product website.
 *
 * Strategy:
 * 1. Use Firecrawl's map endpoint to discover all site URLs
 * 2. Score and rank URLs — prioritise /features, /pricing, /dashboard, etc.
 *    Skip /blog, /legal, /docs, login pages, and query-param URLs
 * 3. Scrape the top MAX_PAGES URLs in parallel
 * 4. Return all content concatenated with URL headers so Gemini knows which
 *    page each section came from and can use the real URLs in navigate_to fields
 *
 * Falls back to a single-page scrape if mapping fails.
 *
 * @returns Multi-page markdown content string
 */
export async function crawlSite(productUrl: string): Promise<string> {
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
  const results = await Promise.allSettled(
    urlsToScrape.map(async (url) => {
      try {
        const markdown = await scrapeUrl(url)
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
    throw new Error('Could not retrieve any content from this product URL.')
  }

  logger.info(`crawlSite: successfully scraped ${pages.length}/${urlsToScrape.length} pages`)

  const combined = pages
    .map(({ url, content }) => `### PAGE: ${url}\n\n${content}`)
    .join('\n\n---\n\n')

  return combined
}
