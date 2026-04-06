import { retryWithBackoff } from '@/lib/utils'
import { logger } from '@/lib/logger'

const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v1/scrape'
const TIMEOUT_MS = 30_000

/**
 * Scrapes a URL using the Firecrawl API and returns the cleaned markdown content.
 * Applies a 30-second timeout and retries up to 3 times with backoff.
 * @param url - The publicly accessible URL to scrape
 * @throws Error if the URL is unreachable or the API call fails after all retries
 */
export async function scrapeUrl(url: string): Promise<string> {
  return retryWithBackoff(async () => {
    let response: Response
    try {
      response = await fetch(FIRECRAWL_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY ?? ''}`,
        },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
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
      logger.error('scrapeUrl: Firecrawl returned no markdown content', { url })
      throw new Error('Could not extract content from this URL. Please check it is publicly accessible.')
    }

    return data.data.markdown
  })
}
