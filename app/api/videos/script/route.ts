import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { generateScript } from '@/lib/gemini'
import { logger } from '@/lib/logger'
import type { ApiResponse, VideoScript } from '@/types'

const ScriptSchema = z.object({
  product_understanding: z.object({
    product_name: z.string(),
    tagline: z.string(),
    core_value_prop: z.string(),
    target_audience: z.string(),
    top_5_features: z.array(z.string()),
    brand_tone: z.string(),
    product_category: z.string(),
    problem_being_solved: z.string(),
    key_pages_to_visit: z.array(z.string()),
    demo_flow: z.array(
      z.object({
        step: z.number(),
        action: z.enum(['scroll_down', 'scroll_up', 'click', 'navigate', 'wait', 'hover', 'type']),
        description: z.string(),
        narration: z.string().optional(),
        element_to_click: z.string().optional(),
        navigate_to: z.string().optional(),
        type_text: z.string().optional(),
      })
    ),
  }),
  tone: z.enum(['professional', 'conversational', 'energetic']),
  video_length: z.union([z.literal(30), z.literal(60), z.literal(90)]),
})

/**
 * POST /api/videos/script
 * Internal route called by the video pipeline worker.
 * Generates a professional narration script using Gemini
 * based on the product understanding and desired tone/length.
 */
export async function POST(
  req: NextRequest
): Promise<NextResponse<ApiResponse<VideoScript>>> {
  try {
    const body: unknown = await req.json()
    const parsed = ScriptSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
        { status: 400 }
      )
    }

    const { product_understanding, tone, video_length } = parsed.data

    let script: VideoScript
    try {
      script = await generateScript(product_understanding as any, tone, video_length)
    } catch (error) {
      logger.error('videos/script: Gemini script generation failed', { error })
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to generate the video script. Please try again.',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, data: script })
  } catch (error) {
    logger.error('videos/script: unexpected error', { error })
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
