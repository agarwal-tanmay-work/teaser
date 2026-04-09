import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { createServerClient as createSSRClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase'
import { scrapeUrl } from '@/lib/firecrawl'
import { understandProduct, generateScript } from '@/lib/gemini'
import { generateVoiceover } from '@/lib/elevenlabs'
import { logger } from '@/lib/logger'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ProductUnderstanding, VideoScript, ApiResponse } from '@/types'

// Long-running route — allow up to 10 minutes
export const maxDuration = 600

const ProcessSchema = z.object({
  credentials: z
    .object({ username: z.string(), password: z.string() })
    .optional(),
})

/**
 * Updates the job progress and message in Supabase via the service client.
 * Called at every pipeline stage transition.
 */
async function updateProgress(
  jobId: string,
  progress: number,
  message: string
): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('video_jobs')
    .update({ progress, progress_message: message, status: 'processing' })
    .eq('id', jobId)
  if (error) {
    logger.warn(`process [${jobId}]: progress update failed`, { error: error.message })
  }
}

/**
 * POST /api/videos/process
 * Runs the full video generation pipeline for the given job ID.
 * Called fire-and-forget from VideoForm after the job record is created.
 *
 * Stages:
 *   0–15%  Scrape + understand product (Firecrawl + Gemini)
 *   15–35% Record demo (Playwright)
 *   35–55% Generate script (Gemini)
 *   55–70% Generate voiceover (ElevenLabs)
 *   70–90% Assemble video (FFmpeg)
 *   90–100% Upload to Supabase Storage
 */
export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse<{ job_id: string }>>> {
  const cookieStore = await cookies()
  const supabase = createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() { /* Read-only */ },
      },
    }
  )

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })
  }

  // Parse jobId from URL
  const url = new URL(req.url)
  const jobId = url.searchParams.get('jobId')
  if (!jobId) {
    return NextResponse.json({ success: false, error: 'Missing jobId.' }, { status: 400 })
  }

  // Parse credentials from body
  const body: unknown = await req.json().catch(() => ({}))
  const parsed = ProcessSchema.safeParse(body)
  const credentials = parsed.success ? parsed.data.credentials : undefined

  // Fetch the job — must belong to the current user
  const serviceClient = createServiceClient()
  const { data: job, error: jobError } = await serviceClient
    .from('video_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', session.user.id)
    .single()

  if (jobError ?? !job) {
    return NextResponse.json({ success: false, error: 'Job not found.' }, { status: 404 })
  }

  // Guard: don't reprocess an already-running or finished job
  if (job.status === 'processing' || job.status === 'completed') {
    return NextResponse.json({ success: true, data: { job_id: jobId } })
  }

  // Run pipeline asynchronously — respond immediately so the client isn't blocked
  // We use a separate async IIFE so we can return the response right away
  // while the pipeline continues running in the Node.js event loop.
  void runPipeline(jobId, job.product_url as string, {
    description: job.product_description as string | undefined,
    video_length: job.video_length as 30 | 60 | 90,
    tone: job.tone as 'professional' | 'conversational' | 'energetic',
    features: job.features_to_highlight as string | undefined,
    credentials,
  })

  return NextResponse.json({ success: true, data: { job_id: jobId } })
}

interface PipelineOptions {
  description?: string
  video_length: 30 | 60 | 90
  tone: 'professional' | 'conversational' | 'energetic'
  features?: string
  credentials?: { username: string; password: string }
}

/**
 * Runs all 6 pipeline stages end-to-end and updates Supabase at each transition.
 * On failure, marks the job as 'failed' with a human-readable error message.
 */
async function runPipeline(
  jobId: string,
  productUrl: string,
  opts: PipelineOptions
): Promise<void> {
  const { description, video_length, tone, credentials } = opts
  const supabase = createServiceClient()

  const voiceoverDir = path.join(os.tmpdir(), 'teaser-voiceovers')
  const voiceoverPath = path.join(voiceoverDir, `${jobId}.mp3`)
  let recordingPath = ''

  try {
    // ── Stage 1: Scrape + understand (0 → 15%) ────────────────────────────────
    await updateProgress(jobId, 5, 'Reading your product...')

    const scrapedContent = await scrapeUrl(productUrl)
    const understanding: ProductUnderstanding = await understandProduct(
      productUrl,
      scrapedContent,
      description
    )

    await supabase.from('video_jobs').update({ product_understanding: understanding }).eq('id', jobId)
    await updateProgress(jobId, 15, 'Got it. Planning the demo recording...')

    // ── Stage 2: Browser recording (15 → 35%) ─────────────────────────────────
    await updateProgress(jobId, 20, 'Opening your product in our browser...')

    // Dynamic import so playwright is only loaded when needed
    const { recordProduct } = await import('@/workers/browserRecorder')
    recordingPath = await recordProduct(productUrl, understanding.demo_flow, jobId, credentials)

    await updateProgress(jobId, 35, 'Demo recorded. Writing your script...')

    // ── Stage 3: Script (35 → 55%) ────────────────────────────────────────────
    const script: VideoScript = await generateScript(understanding, tone, video_length)
    await supabase.from('video_jobs').update({ script }).eq('id', jobId)
    await updateProgress(jobId, 55, 'Script done. Generating your voiceover...')

    // ── Stage 4: Voiceover (55 → 70%) ─────────────────────────────────────────
    fs.mkdirSync(voiceoverDir, { recursive: true })
    const fullScript = script.segments.map((s) => s.narration).join(' ')
    await generateVoiceover(fullScript, tone, voiceoverPath)
    await updateProgress(jobId, 70, 'Voiceover done. Editing your video...')

    // ── Stage 5: Assemble (70 → 90%) ──────────────────────────────────────────
    const { assembleVideo } = await import('@/workers/videoAssembler')
    const finalVideoPath = await assembleVideo({
      recordingPath,
      voiceoverPath,
      script,
      understanding,
      videoLength: video_length,
      jobId,
    })
    await updateProgress(jobId, 90, 'Almost done. Uploading your video...')

    // ── Stage 6: Upload (90 → 100%) ───────────────────────────────────────────
    const videoBuffer = fs.readFileSync(finalVideoPath)
    const { error: uploadError } = await supabase.storage
      .from('videos')
      .upload(`${jobId}/final.mp4`, videoBuffer, { contentType: 'video/mp4', upsert: true })

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

    const { data: urlData } = supabase.storage.from('videos').getPublicUrl(`${jobId}/final.mp4`)

    await supabase.from('video_jobs').update({
      status: 'completed',
      progress: 100,
      progress_message: 'Your video is ready!',
      final_video_url: urlData.publicUrl,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId)

    // Cleanup
    if (recordingPath && fs.existsSync(path.dirname(recordingPath))) {
      fs.rmSync(path.dirname(recordingPath), { recursive: true, force: true })
    }
    if (fs.existsSync(voiceoverPath)) fs.rmSync(voiceoverPath, { force: true })
    if (fs.existsSync(finalVideoPath)) fs.rmSync(finalVideoPath, { force: true })

    logger.info(`process [${jobId}]: completed successfully`)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred.'
    logger.error(`process [${jobId}]: failed`, { error })

    await supabase.from('video_jobs').update({
      status: 'failed',
      error_message: message,
    }).eq('id', jobId)

    // Best-effort cleanup
    if (recordingPath && fs.existsSync(path.dirname(recordingPath))) {
      fs.rmSync(path.dirname(recordingPath), { recursive: true, force: true })
    }
    if (fs.existsSync(voiceoverPath)) fs.rmSync(voiceoverPath, { force: true })
  }
}
