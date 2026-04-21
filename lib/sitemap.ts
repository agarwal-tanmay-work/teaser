import { logger } from '@/lib/logger'

const SITEMAP_TIMEOUT_MS = 8_000
const ROBOTS_TIMEOUT_MS = 4_000
/** Hard cap on recursion depth so a rogue sitemap index can't burn the budget. */
const MAX_SITEMAP_DEPTH = 3
/** Hard cap on total URLs returned — we only care about the first ~N meaningful pages. */
const MAX_URLS = 80

/**
 * Extracts every `<loc>...</loc>` entry from a sitemap XML body. Sitemap-index
 * files also use `<loc>` to point at nested sitemaps, so the caller checks the
 * URL shape and recurses when needed.
 */
function parseLocs(xml: string): string[] {
  const out: string[] = []
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1].trim())
  }
  return out
}

async function fetchTextOrNull(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/**
 * Recursively fetches a sitemap URL and every sitemap it references. Returns
 * the flat list of page URLs. Silently stops at `MAX_SITEMAP_DEPTH` or
 * `MAX_URLS`, returning whatever was collected so far.
 */
async function fetchSitemap(
  url: string,
  depth: number,
  seen: Set<string>
): Promise<string[]> {
  if (depth > MAX_SITEMAP_DEPTH) return []
  if (seen.has(url)) return []
  seen.add(url)

  const xml = await fetchTextOrNull(url, SITEMAP_TIMEOUT_MS)
  if (!xml) return []

  const locs = parseLocs(xml)
  const pages: string[] = []
  const nested: string[] = []

  for (const loc of locs) {
    // Sitemap-index entries point at more sitemaps — recurse.
    if (/\.xml(\.gz)?(\?|$)/i.test(loc) || /sitemap/i.test(loc)) {
      nested.push(loc)
    } else {
      pages.push(loc)
    }
  }

  for (const sub of nested) {
    if (pages.length >= MAX_URLS) break
    const more = await fetchSitemap(sub, depth + 1, seen)
    for (const p of more) {
      if (pages.length >= MAX_URLS) break
      pages.push(p)
    }
  }

  return pages
}

/**
 * Discovers every subpage URL of a site by combining:
 *   1. Conventional `/sitemap.xml` (most marketing sites and Next.js apps have this).
 *   2. Every `Sitemap:` directive declared in `/robots.txt`.
 *
 * Returns a deduped, same-origin-only list capped at `MAX_URLS`. Never throws —
 * returns `[]` if nothing is reachable, so callers can cheaply union it with
 * other discovery strategies (Firecrawl map, live Playwright recon).
 */
export async function discoverSitemapUrls(productUrl: string): Promise<string[]> {
  let origin: string
  try {
    origin = new URL(productUrl).origin
  } catch {
    return []
  }

  const seen = new Set<string>()
  const candidates: string[] = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
  ]

  // robots.txt may declare one or more `Sitemap:` URLs — collect those too.
  const robotsBody = await fetchTextOrNull(`${origin}/robots.txt`, ROBOTS_TIMEOUT_MS)
  if (robotsBody) {
    const re = /^\s*sitemap\s*:\s*(\S+)/gim
    let m: RegExpExecArray | null
    while ((m = re.exec(robotsBody)) !== null) {
      candidates.push(m[1].trim())
    }
  }

  const collected: string[] = []
  for (const url of candidates) {
    if (collected.length >= MAX_URLS) break
    const pages = await fetchSitemap(url, 0, seen)
    for (const p of pages) {
      if (collected.length >= MAX_URLS) break
      // Keep only same-origin URLs — cross-domain sitemap entries are almost
      // always CDN assets or i18n variants we don't want to record.
      try {
        if (new URL(p).origin === origin) collected.push(p)
      } catch { /* skip malformed */ }
    }
  }

  const deduped = Array.from(new Set(collected))
  if (deduped.length > 0) {
    logger.info(`sitemap: ${deduped.length} URL(s) discovered from ${origin}`)
  }
  return deduped
}
