import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { createServerClient as createSSRClient } from '@supabase/ssr'
import { addVideoJob } from '@/lib/queue'
import { logger } from '@/lib/logger'
import type { ApiResponse, VideoCreateResponse } from '@/types'

const CreateVideoSchema = z.object({
  product_url: z
    .string()
    .url('Please enter a valid URL.')
    .refine((url) => url.startsWith('https://'), 'URL must start with https://'),
  description: z.string().max(300).optional(),
  video_length: z.union([z.literal(30), z.literal(60), z.literal(90)]),
  tone: z.enum(['professional', 'conversational', 'energetic']),
  features: z.string().max(500).optional(),
  credentials: z
    .object({ username: z.string(), password: z.string() })
    .optional(),
})

/**
 * Creates an authenticated Supabase client using request cookies.
 * Used inside API route handlers that need session access.
 */
async function getAuthClient() {
  const cookieStore = await cookies()
  return createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // Read-only in route handlers
        },
      },
    }
  )
}

/**
 * POST /api/videos/create
 * Creates a new video generation job and enqueues it for processing.
 * Requires an authenticated session.
 */
export async function POST(
  req: NextRequest
): Promise<NextResponse<ApiResponse<VideoCreateResponse>>> {
  try {
    const supabase = await getAuthClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()

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

    const { product_url, description, video_length, tone, features, credentials } =
      parsed.data

    // Check URL is publicly reachable
    try {
      await fetch(product_url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            'This URL is not publicly accessible. Please check the link and try again.',
        },
        { status: 400 }
      )
    }

    // Insert the job into Supabase
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

    // Enqueue the job
    await addVideoJob({
      jobId,
      product_url,
      description,
      video_length,
      tone,
      features,
      credentials,
    })

    return NextResponse.json({ success: true, data: { job_id: jobId } }, { status: 201 })
  } catch (error) {
    logger.error('videos/create: unexpected error', { error })
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
