import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { createServerClient as createSSRClient } from '@supabase/ssr'
import { logger } from '@/lib/logger'
import type { ApiResponse, VideoCreateResponse } from '@/types'

const CreateVideoSchema = z.object({
  product_url: z
    .string()
    .url('Please enter a valid URL.')
    .refine((url) => url.startsWith('https://') || url.startsWith('http://'), 'URL must start with http:// or https://'),
  description: z.string().max(10000).optional(),
  video_length: z.number().int().min(60).max(300),
  tone: z.enum(['professional', 'conversational', 'energetic']),
  features: z.string().max(10000).optional(),
})

/**
 * Creates an authenticated Supabase client using request cookies.
 */
async function getAuthClient() {
  const cookieStore = await cookies()
  return createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() { /* Read-only in route handlers */ },
      },
    }
  )
}

/**
 * POST /api/videos/create
 * Inserts a video job into Supabase and returns the job ID immediately.
 * Processing is triggered client-side via /api/videos/process/[jobId].
 * Requires an authenticated session.
 */
export async function POST(
  req: NextRequest
): Promise<NextResponse<ApiResponse<VideoCreateResponse>>> {
  try {
    const supabase = await getAuthClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'You must be logged in to generate a video.' },
        { status: 401 }
      )
    }

    const body: unknown = await req.json()
    const parsed = CreateVideoSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
        { status: 400 }
      )
    }

    const { product_url, description, video_length, tone, features } = parsed.data

    // Insert the job — status starts as 'pending'
    const { data: inserted, error: insertError } = await supabase
      .from('video_jobs')
      .insert({
        user_id: session.user.id,
        product_url,
        product_description: description,
        video_length,
        tone,
        features_to_highlight: features,
        status: 'pending',
        progress: 0,
        progress_message: 'Queued — starting soon...',
      })
      .select('id')
      .single()

    if (insertError ?? !inserted) {
      logger.error('videos/create: insert error', { error: insertError?.message })
      return NextResponse.json(
        { success: false, error: 'Something went wrong. Please try again.' },
        { status: 500 }
      )
    }

    const jobId = inserted.id as string

    // Return immediately — client will trigger /api/videos/process/[jobId]
    return NextResponse.json({ success: true, data: { job_id: jobId } }, { status: 201 })
  } catch (error) {
    logger.error('videos/create: unexpected error', { error })
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
