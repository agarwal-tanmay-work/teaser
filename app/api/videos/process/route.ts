import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { createServerClient as createSSRClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase'
import { crawlSite } from '@/lib/firecrawl'
import { understandProduct, generateScript } from '@/lib/gemini'
import { generateVoiceover } from '@/lib/tts'
import { logger } from '@/lib/logger'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ProductUnderstanding, VideoScript, ApiResponse } from '@/types'
import { validateFfmpeg } from '@/workers/videoAssembler'

/**
 * Performs a fast check of all critical dependencies before the heavy pipeline starts.
 * Rejects with a clear error if any dependency is missing.
 */
async function performPreFlightCheck(): Promise<void> {
  // 1. Check Gemini
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is missing in your .env.local file.')
  }
  
  // 2. Check Firecrawl
  if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error('FIRECRAWL_API_KEY is missing. Please add it to your .env.local file.')
  }

  // 3. Check FFmpeg (absolute path or standard)
  try {
    await validateFfmpeg()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`FFmpeg Pre-flight check failed: ${msg}. Make sure FFmpeg is installed and accessible.`)
  }
}

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
 *   20%  Writing script (Gemini)
 *   35%  Recording demo (Playwright)
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
  let voiceoverPath = path.join(voiceoverDir, `${jobId}.mp3`)
  let recordingPath = ''
  let finalVideoPath = ''

  try {
    logger.info(`pipeline [${jobId}]: starting for ${productUrl}`)
    
    // ── Pre-flight Check (0 → 2%) ──────────────────────────────────────────
    await updateProgress(jobId, 1, 'Checking system readiness (AI, FFmpeg)...')
    await performPreFlightCheck()
    await updateProgress(jobId, 2, 'System ready. Moving to scraping...')

    // ── Stage 1: Crawl (0 → 10%) ──────────────────────────────────────────
    // crawlSite discovers and scrapes multiple pages (landing page + features,
    // pricing, dashboard, etc.) so Gemini has full product knowledge and can
    // generate navigate_to steps with real, verified URLs.
    await updateProgress(jobId, 3, 'Discovering and reading your product pages...')
    let scrapedContent: string
    try {
      scrapedContent = await crawlSite(productUrl)
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
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Failed to analyse your product: ${detail}`
      )
    }
    await db.from('video_jobs').update({ product_understanding: understanding }).eq('id', jobId)
    await updateProgress(jobId, 15, 'Product understood. Planning the demo...')

    // ── Stage 2: Script (15 → 35%) ────────────────────────────────────────
    await updateProgress(jobId, 20, 'Writing your video script with AI...')
    let script: VideoScript
    try {
      script = await generateScript(understanding, tone, video_length)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Failed to generate the video script: ${detail}`
      )
    }
    await db.from('video_jobs').update({ script }).eq('id', jobId)
    await updateProgress(jobId, 35, 'Script ready. Opening your product in a real browser...')

    // ── Stage 3: Record (35 → 55%) ────────────────────────────────────────
    try {
      const { recordProduct } = await import('@/workers/browserRecorder')
      // Pass `understanding` (not `script`) — demo_flow has reliable click/navigate
      // actions. VideoScript drives narration/captions in the assembler only.
      recordingPath = await recordProduct(productUrl, understanding, jobId, credentials)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        msg.includes('Executable') || msg.includes('browser') || msg.includes('chromium')
          ? 'Playwright browser not found. Run: npx playwright install chromium'
          : `Browser recording failed: ${msg}`
      )
    }
    await updateProgress(jobId, 55, 'Demo recorded. Preparing video...')

    // ── Stage 4: Voiceover — TEMPORARILY DISABLED (Gemini TTS quota exceeded) ──
    // generateVoiceover() is disabled until quota is restored. A silent MP3 is
    // written in its place so the assembler pipeline continues unchanged.
    // To re-enable: uncomment the block below and remove the silent-audio block.
    //
    // await updateProgress(jobId, 58, 'Converting script to natural voice...')
    // fs.mkdirSync(voiceoverDir, { recursive: true })
    // const fullScript = script.segments.map((s) => s.narration).join(' ')
    // try {
    //   voiceoverPath = await generateVoiceover(fullScript, tone, voiceoverPath)
    // } catch (err) {
    //   const detail = err instanceof Error ? err.message : String(err)
    //   throw new Error(`Voiceover generation failed: ${detail}`)
    // }
    //
    // ── Temporary: generate 90s of silence as a stand-in voiceover ──────────
    {
      const { getFfmpegPath } = await import('@/workers/videoAssembler')
      const { spawn } = await import('child_process')
      fs.mkdirSync(voiceoverDir, { recursive: true })
      await new Promise<void>((resolve, reject) => {
        const p = spawn(getFfmpegPath(), [
          '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
          '-t', '90',
          '-c:a', 'libmp3lame', '-b:a', '128k',
          '-y', voiceoverPath,
        ])
        p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`silence gen failed: ${code}`)))
        p.on('error', reject)
      })
    }
    await updateProgress(jobId, 70, 'Assembling video...')

    // ── Stage 5: Assemble (70 → 90%) ──────────────────────────────────────
    await updateProgress(jobId, 73, 'Initializing video engine...')
    try {
      const { assembleVideo } = await import('@/workers/videoAssembler')
      
      // Sub-stages for progress feel
      setTimeout(() => updateProgress(jobId, 75, 'Converting recording to MP4...'), 1000)
      setTimeout(() => updateProgress(jobId, 80, 'Creating branding & intro...'), 5000)
      setTimeout(() => updateProgress(jobId, 85, 'Mixing audio & captions...'), 10000)

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
      logger.error(`pipeline [${jobId}]: assembly failed`, { error: msg })
      throw new Error(
        msg.toLowerCase().includes('ffmpeg') || msg.toLowerCase().includes('spawn') || msg.toLowerCase().includes('enoent')
          ? `FFmpeg Error: ${msg}. (Binary path: ${path.join(os.tmpdir(), 'debug-ffmpeg-path.txt')})`
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

    // Cleanup temp files safely
    try { if (recordingPath) fs.rmSync(path.dirname(recordingPath), { recursive: true, force: true }) } catch {}
    try { if (voiceoverPath && fs.existsSync(voiceoverPath)) fs.rmSync(voiceoverPath, { force: true }) } catch {}
    try { if (typeof finalVideoPath !== 'undefined' && finalVideoPath && fs.existsSync(finalVideoPath)) fs.rmSync(finalVideoPath, { force: true }) } catch {}

    logger.info(`pipeline [${jobId}]: completed successfully`)

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred.'
    logger.error(`pipeline [${jobId}]: failed — ${message}`)
    await markFailed(jobId, message)

    // Cleanup on failure
    try { if (recordingPath) fs.rmSync(path.dirname(recordingPath), { recursive: true, force: true }) } catch {}
    try { if (voiceoverPath && fs.existsSync(voiceoverPath)) fs.rmSync(voiceoverPath, { force: true }) } catch {}
  }
}
