import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { createServerClient as createSSRClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase'
import type { ApiResponse } from '@/types'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

export const maxDuration = 600

const ProcessSchema = z.object({
  credentials: z
    .object({ username: z.string(), password: z.string() })
    .optional(),
  start_url: z.string().url().optional(),
})

/**
 * POST /api/videos/process?jobId=xxx
 *
 * Enqueues the video job securely to BullMQ and returns immediately.
 * The heavy lifting (Playwright, FFmpeg, etc) happens in the background worker.
 */
export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse<{ job_id: string }>>> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cookieStore = await cookies()
  const authClient = createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() { /* read-only */ },
      },
    }
  )
  const { data: { session } } = await authClient.auth.getSession()
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })
  }

  // ── Job ID ────────────────────────────────────────────────────────────────
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('jobId')
  if (!jobId) {
    return NextResponse.json({ success: false, error: 'Missing jobId.' }, { status: 400 })
  }

  // ── Credentials from body ─────────────────────────────────────────────────
  const rawBody: unknown = await req.json().catch(() => ({}))
  const { data: parsedBody } = ProcessSchema.safeParse(rawBody)
  const credentials = parsedBody?.credentials
  const start_url = parsedBody?.start_url

  // ── Load job ──────────────────────────────────────────────────────────────
  const db = createServiceClient()
  const { data: job } = await db
    .from('video_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', session.user.id)
    .single()

  if (!job) {
    return NextResponse.json({ success: false, error: 'Job not found.' }, { status: 404 })
  }

  // Don't reprocess
  if (job.status === 'completed' || job.status === 'processing') {
    return NextResponse.json({ success: true, data: { job_id: jobId } })
  }

  // ── Dispatch to BullMQ Worker ────────────────────────────────────────────────
  await db
    .from('video_jobs')
    .update({ status: 'processing', progress: 1, progress_message: 'Job dispatched to background worker...' })
    .eq('id', jobId)

  const jobPayload = JSON.stringify({
    jobId,
    product_url: job.product_url as string,
    description: job.product_description as string | undefined,
    features: job.features_to_highlight as string | undefined,
    video_length: job.video_length as 30 | 60 | 90,
    tone: job.tone as 'professional' | 'conversational' | 'energetic',
    credentials,
    start_url,
  })

  // ── Spawn Background Process ───────────────────────────────────────────────
  // Redirect logs to a file in the project root for diagnostics
  const logFile = path.join(process.cwd(), 'worker.log')
  const out = fs.openSync(logFile, 'a')
  const err = fs.openSync(logFile, 'a')

  const worker = spawn('npx', [
    'ts-node', '--project', 'tsconfig.worker.json',
    '-r', 'tsconfig-paths/register', 'workers/videoProcessor.ts'
  ], {
    env: { ...process.env, JOB_PAYLOAD: jobPayload },
    stdio: ['ignore', out, err],
    windowsHide: true,
    detached: true,
    shell: true, // Required for npx batch file on Windows
  })
  worker.unref()

  return NextResponse.json({ success: true, data: { job_id: jobId } })
}
