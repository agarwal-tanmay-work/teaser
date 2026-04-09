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

/**
 * Allow up to 10 minutes — the pipeline is long-running.
 * The client fires this request non-awaited so the browser never waits for it.
 */
export const maxDuration = 600

const ProcessSchema = z.object({
  credentials: z
    .object({ username: z.string(), password: z.string() })
    .optional(),
})

/** Writes progress + message to Supabase using the service role key (bypasses RLS). */
async function updateProgress(jobId: string, progress: number, message: string): Promise<void> {
  const supabase = createServiceClient()
  await supabase
    .from('video_jobs')
    .update({ progress, progress_message: message, status: 'processing' })
    .eq('id', jobId)
}

/** Marks a job as failed with a human-readable message. */
async function markFailed(jobId: string, message: string): Promise<void> {
  const supabase = createServiceClient()
  await supabase
    .from('video_jobs')
    .update({ status: 'failed', error_message: message })
    .eq('id', jobId)
}

/**
 * POST /api/videos/process?jobId=xxx
 *
 * Runs the full video pipeline and AWAITS it before returning.
 * Called as a fire-and-forget fetch from VideoForm — the client never
 * waits for this response. Progress is communicated via Supabase polling.
 *
 * Stages:
 *   5%   Reading product (Firecrawl)
 *   15%  Understanding product (Gemini)
 *   20%  Recording demo (Playwright)
 *   35%  Writing script (Gemini)
 *   55%  Generating voiceover (ElevenLabs)
 *   70%  Assembling video (FFmpeg)
 *   90%  Uploading to Supabase Storage
 *   100% Done
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

  // ── Run pipeline (AWAITED — this is the critical fix) ─────────────────────
  // The client fires this fetch without awaiting the response, so holding the
  // connection open here is safe. The pipeline updates Supabase at each stage
  // and the ProgressTracker reads from Supabase independently.
  await runPipeline(jobId, job.product_url as string, {
    description: job.product_description as string | undefined,
    video_length: job.video_length as 30 | 60 | 90,
    tone: job.tone as 'professional' | 'conversational' | 'energetic',
    credentials,
  })

  return NextResponse.json({ success: true, data: { job_id: jobId } })
}

interface PipelineOptions {
  description?: string
  video_length: 30 | 60 | 90
  tone: 'professional' | 'conversational' | 'energetic'
  credentials?: { username: string; password: string }
}

async function runPipeline(jobId: string, productUrl: string, opts: PipelineOptions): Promise<void> {
  const { description, video_length, tone, credentials } = opts
  const db = createServiceClient()

  const voiceoverDir = path.join(os.tmpdir(), 'teaser-voiceovers')
  const voiceoverPath = path.join(voiceoverDir, `${jobId}.mp3`)
  let recordingPath = ''

  try {
    logger.info(`pipeline [${jobId}]: starting for ${productUrl}`)

    // ── Stage 1: Scrape (0 → 10%) ─────────────────────────────────────────
    await updateProgress(jobId, 3, 'Reading your product website...')
    let scrapedContent: string
    try {
      scrapedContent = await scrapeUrl(productUrl)
    } catch {
      throw new Error(
        'Could not scrape your product URL. Make sure it is publicly accessible and the FIRECRAWL_API_KEY is set.'
      )
    }

    // ── Stage 1b: Understand (10 → 15%) ───────────────────────────────────
    await updateProgress(jobId, 10, 'Analysing your product with AI...')
    let understanding: ProductUnderstanding
    try {
      understanding = await understandProduct(productUrl, scrapedContent, description)
    } catch {
      throw new Error(
        'Failed to analyse your product. Check that GEMINI_API_KEY is set correctly.'
      )
    }
    await db.from('video_jobs').update({ product_understanding: understanding }).eq('id', jobId)
    await updateProgress(jobId, 15, 'Product understood. Planning the demo...')

    // ── Stage 2: Record (15 → 35%) ────────────────────────────────────────
    await updateProgress(jobId, 20, 'Opening your product in a real browser...')
    try {
      const { recordProduct } = await import('@/workers/browserRecorder')
      recordingPath = await recordProduct(productUrl, understanding.demo_flow, jobId, credentials)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        msg.includes('Executable') || msg.includes('browser') || msg.includes('chromium')
          ? 'Playwright browser not found. Run: npx playwright install chromium'
          : `Browser recording failed: ${msg}`
      )
    }
    await updateProgress(jobId, 35, 'Demo recorded. Writing the script...')

    // ── Stage 3: Script (35 → 55%) ────────────────────────────────────────
    await updateProgress(jobId, 40, 'Writing your video script with AI...')
    let script: VideoScript
    try {
      script = await generateScript(understanding, tone, video_length)
    } catch {
      throw new Error(
        'Failed to generate the video script. Check that GEMINI_API_KEY is set correctly.'
      )
    }
    await db.from('video_jobs').update({ script }).eq('id', jobId)
    await updateProgress(jobId, 55, 'Script ready. Generating voiceover...')

    // ── Stage 4: Voiceover (55 → 70%) ─────────────────────────────────────
    await updateProgress(jobId, 58, 'Converting script to natural voice...')
    fs.mkdirSync(voiceoverDir, { recursive: true })
    const fullScript = script.segments.map((s) => s.narration).join(' ')
    try {
      await generateVoiceover(fullScript, tone, voiceoverPath)
    } catch {
      throw new Error(
        'Voiceover generation failed. Check that ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are set correctly.'
      )
    }
    await updateProgress(jobId, 70, 'Voiceover done. Editing the video...')

    // ── Stage 5: Assemble (70 → 90%) ──────────────────────────────────────
    await updateProgress(jobId, 73, 'Running FFmpeg — adding captions, intro, outro...')
    let finalVideoPath: string
    try {
      const { assembleVideo } = await import('@/workers/videoAssembler')
      finalVideoPath = await assembleVideo({
        recordingPath,
        voiceoverPath,
        script,
        understanding,
        videoLength: video_length,
        jobId,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        msg.toLowerCase().includes('ffmpeg') || msg.toLowerCase().includes('spawn')
          ? 'FFmpeg not found. Install it: winget install ffmpeg (then restart your terminal)'
          : `Video assembly failed: ${msg}`
      )
    }
    await updateProgress(jobId, 90, 'Video assembled. Uploading...')

    // ── Stage 6: Upload (90 → 100%) ───────────────────────────────────────
    const videoBuffer = fs.readFileSync(finalVideoPath)
    const { error: uploadError } = await db.storage
      .from('videos')
      .upload(`${jobId}/final.mp4`, videoBuffer, { contentType: 'video/mp4', upsert: true })

    if (uploadError) {
      throw new Error(
        uploadError.message.includes('Bucket not found')
          ? 'Supabase "videos" storage bucket not found. Create it in your Supabase dashboard → Storage.'
          : `Upload failed: ${uploadError.message}`
      )
    }

    const { data: urlData } = db.storage.from('videos').getPublicUrl(`${jobId}/final.mp4`)

    await db.from('video_jobs').update({
      status: 'completed',
      progress: 100,
      progress_message: 'Your video is ready!',
      final_video_url: urlData.publicUrl,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId)

    // Cleanup temp files
    try {
      if (recordingPath) fs.rmSync(path.dirname(recordingPath), { recursive: true, force: true })
      if (fs.existsSync(voiceoverPath)) fs.rmSync(voiceoverPath, { force: true })
      if (fs.existsSync(finalVideoPath)) fs.rmSync(finalVideoPath, { force: true })
    } catch { /* non-critical */ }

    logger.info(`pipeline [${jobId}]: completed successfully`)

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred.'
    logger.error(`pipeline [${jobId}]: failed — ${message}`)
    await markFailed(jobId, message)

    // Cleanup on failure
    try {
      if (recordingPath) fs.rmSync(path.dirname(recordingPath), { recursive: true, force: true })
      if (fs.existsSync(voiceoverPath)) fs.rmSync(voiceoverPath, { force: true })
    } catch { /* non-critical */ }
  }
}
