import { NextResponse } from 'next/server'
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
 * GET /api/videos/list
 * Returns all video generation jobs for the authenticated user, newest first.
 */
export async function GET(): Promise<NextResponse<ApiResponse<VideoJob[]>>> {
  try {
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

    const { data: jobs, error } = await supabase
      .from('video_jobs')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('videos/list: supabase error', { error })
      return NextResponse.json(
        { success: false, error: 'Failed to load your videos.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, data: (jobs ?? []) as VideoJob[] })
  } catch (error) {
    logger.error('videos/list: unexpected error', { error })
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
