import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient as createSSRClient } from '@supabase/ssr'
import { logger } from '@/lib/logger'
import type { ApiResponse, VideoJob } from '@/types'

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
 * GET /api/videos/status/[jobId]
 * Returns the current state of a video generation job.
 * Only returns jobs owned by the authenticated user.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<NextResponse<ApiResponse<VideoJob>>> {
  try {
    const { jobId } = await params
    const supabase = await getAuthClient()

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'You must be logged in.' },
        { status: 401 }
      )
    }

    const { data: job, error } = await supabase
      .from('video_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', session.user.id)
      .single()

    if (error ?? !job) {
      return NextResponse.json(
        { success: false, error: 'Video not found.' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: job as VideoJob })
  } catch (error) {
    logger.error('videos/status: unexpected error', { error })
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
