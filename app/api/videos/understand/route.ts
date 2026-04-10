import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { crawlSite } from '@/lib/firecrawl'
import { understandProduct } from '@/lib/gemini'
import { logger } from '@/lib/logger'
import type { ApiResponse, ProductUnderstanding } from '@/types'

const UnderstandSchema = z.object({
  product_url: z.string().url(),
  description: z.string().optional(),
  video_length: z.number().optional().default(60),
})

/**
 * POST /api/videos/understand
 * Internal route called by the video pipeline worker.
 * Scrapes the product URL with Firecrawl and analyses it with Gemini.
 * Returns a structured ProductUnderstanding object.
 */
export async function POST(
  req: NextRequest
): Promise<NextResponse<ApiResponse<ProductUnderstanding>>> {
  try {
    const body: unknown = await req.json()
    const parsed = UnderstandSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
        { status: 400 }
      )
    }

    const { product_url, description, video_length } = parsed.data

    let scrapedContent: string
    try {
      scrapedContent = await crawlSite(product_url)
    } catch (error) {
      logger.error('videos/understand: crawl failed', { product_url, error })
      return NextResponse.json(
        {
          success: false,
          error:
            'Could not access this URL. Please check it is publicly accessible.',
        },
        { status: 400 }
      )
    }

    let understanding: ProductUnderstanding
    try {
      understanding = await understandProduct(product_url, scrapedContent, description, video_length)
    } catch (error) {
      logger.error('videos/understand: Gemini analysis failed', { product_url, error })
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to analyse the product. Please try again.',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, data: understanding })
  } catch (error) {
    logger.error('videos/understand: unexpected error', { error })
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
