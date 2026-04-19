import { config } from 'dotenv'
config({ path: '.env.local' })

import { Worker, type Job } from 'bullmq'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createServiceClient } from '../lib/supabase'
import { logger } from '../lib/logger'
import { crawlSite } from '../lib/firecrawl'
import { understandProduct, generateScript } from '../lib/gemini'
import { recordProduct } from './browserRecorder'
import { assembleVideo } from './videoAssembler'
import type {
  ApiResponse,
  ProductUnderstanding,
  VideoScript,
  VideoTone,
  VideoLength,
} from '../types'
import type { VideoJobQueueData } from '../lib/queue'

/** Upstash Redis connection derived from REST credentials (must run after dotenv.config). */
function buildRedisConnection(): { host: string; port: number; password: string; tls: object; family: number } {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL ?? ''
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? ''
  if (!restUrl || !token) {
    logger.warn('videoProcessor: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set — worker will fail to connect')
  }
  const parsed = restUrl ? new URL(restUrl) : null
  const host = parsed?.hostname ?? '127.0.0.1'
  return { host, port: 6379, password: token, tls: { servername: host }, family: 4 }
}

/** Shape of the data stored on each BullMQ job. */
interface WorkerJobData {
  jobId: string
  product_url: string
  description?: string
  tone: VideoTone
  video_length: VideoLength
  features?: string
  credentials?: { username: string; password: string }
  start_url?: string
}

/**
 * Updates the progress, message, and status of a video job in Supabase.
 * Logs every write so we can confirm the frontend should be seeing the change.
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
    logger.warn(`updateProgress [${jobId}]: supabase update failed`, { error: error.message })
  } else {
    logger.info(`progress [${jobId}]: ${progress}% — ${message}`)
  }
}

/**
 * BullMQ worker that processes video generation jobs end-to-end.
 *
 * Stages:
 *   Stage 1 (0-15%):  Product understanding via Firecrawl + Gemini
 *   Stage 2 (15-35%): Script generation via Gemini (narration tied to demo flow)
 *   Stage 3 (35-60%): Screenshot-based browser capture via Playwright
 *   Stage 4 (60-70%): Silent audio generation (TTS disabled for now)
 *   Stage 5 (70-90%): Video composition via Remotion + FFmpeg
 *   Stage 6 (90-100%): Upload to Supabase Storage + cleanup
 */
const _redisConn = buildRedisConnection()

export async function processJob(jobData: WorkerJobData) {
  const { jobId, product_url, description, features, tone, video_length, credentials, start_url } = jobData
  const supabase = createServiceClient()

  logger.info(`videoProcessor: job ${jobId} starting${start_url ? ` (demo start URL: ${start_url})` : ''}`)

  const voiceoverPath = path.join(os.tmpdir(), 'teaser-voiceovers', `${jobId}.mp3`)
  let recordingDir = ''
  let finalVideoPath = ''

  // Master timeout (30 mins)
  const timeoutId = setTimeout(async () => {
    logger.error(`videoProcessor: job ${jobId} timed out after 30 minutes`)
    await supabase.from('video_jobs').update({ status: 'failed', error_message: 'Generation timed out. Please try again.' }).eq('id', jobId)
    process.exit(1)
  }, 30 * 60 * 1000)

  try {
    // ─── STAGE 1: Product Understanding (0 → 15%) ─────────────────────────
    await updateProgress(jobId, 5, 'Analyzing your product...')

    const { content: scrapedContent, siteMap } = await crawlSite(product_url, async (msg) => {
      await updateProgress(jobId, 5, msg)
    })

    logger.info(`videoProcessor: ${jobId} — site map: ${siteMap.length} URLs discovered`)

    const understanding = await understandProduct(product_url, scrapedContent, description, video_length, features, siteMap)

    await supabase
      .from('video_jobs')
      .update({ product_understanding: understanding })
      .eq('id', jobId)

    await updateProgress(jobId, 15, 'Product analyzed. Writing your script...')

    logger.info(`videoProcessor: ${jobId} — understood product: ${understanding.product_name} (${understanding.demo_flow.length} demo steps)`)

    // ─── STAGE 2: Script Generation (15 → 35%) ────────────────────────────
    const script = await generateScript(understanding, tone, video_length)

    await supabase
      .from('video_jobs')
      .update({ script })
      .eq('id', jobId)

    await updateProgress(jobId, 35, 'Script ready. Recording your product demo...')

    logger.info(`videoProcessor: ${jobId} — script generated: ${script.segments.length} segments, ${script.total_duration}s`)

    // ─── STAGE 3: Vision-Guided Browser Recording (35 → 60%) ───────────────
    recordingDir = await recordProduct(
      product_url,
      understanding,
      jobId,
      credentials,
      start_url,
      siteMap,
    )

    await updateProgress(jobId, 60, 'Demo recorded. Composing your video...')

    // ─── STAGE 4: Silent Audio (TTS disabled to save credits) ──────────────
    {
      const { getFfmpegPath } = await import('../lib/ffmpegUtils')
      const { spawn } = await import('child_process')
      fs.mkdirSync(path.join(os.tmpdir(), 'teaser-voiceovers'), { recursive: true })
      await new Promise<void>((resolve, reject) => {
        const p = spawn(getFfmpegPath(), [
          '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
          '-t', String(video_length + 10), // extra padding
          '-c:a', 'libmp3lame', '-b:a', '128k',
          '-y', voiceoverPath,
        ])
        p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`silence gen failed: ${code}`)))
        p.on('error', reject)
      })
    }

    await updateProgress(jobId, 70, 'Composing your video...')

    // ─── STAGE 5: Video Composition via Remotion (70 → 90%) ────────────────
    await updateProgress(jobId, 70, 'Composing your video (this may take a few minutes)...')
    
    finalVideoPath = await assembleVideo({
      recordingDir,
      voiceoverPath,
      jobId,
      productUrl: product_url,
    })
    
    await updateProgress(jobId, 85, 'Video rendered. Applying finishing touches...')

    await updateProgress(jobId, 90, 'Almost done. Uploading...')

    // ─── STAGE 6: Upload + Cleanup (90 → 100%) ────────────────────────────
    const videoBuffer = fs.readFileSync(finalVideoPath)

    const { error: uploadError } = await supabase.storage
      .from('videos')
      .upload(`${jobId}/final.mp4`, videoBuffer, {
        contentType: 'video/mp4',
        upsert: true,
      })

    if (uploadError) {
      throw new Error(`Upload to Supabase Storage failed: ${uploadError.message}`)
    }

    const { data: urlData } = supabase.storage
      .from('videos')
      .getPublicUrl(`${jobId}/final.mp4`)

    await supabase
      .from('video_jobs')
      .update({
        status: 'completed',
        progress: 100,
        progress_message: 'Your video is ready!',
        final_video_url: urlData.publicUrl,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    // Cleanup
    if (recordingDir && fs.existsSync(recordingDir)) {
      fs.rmSync(recordingDir, { recursive: true, force: true })
    }
    if (fs.existsSync(voiceoverPath)) {
      fs.rmSync(voiceoverPath, { force: true })
    }
    if (fs.existsSync(finalVideoPath)) {
      fs.rmSync(finalVideoPath, { force: true })
    }

    clearTimeout(timeoutId)
    logger.info(`videoProcessor: job ${jobId} completed successfully`)
  } catch (error: unknown) {
    clearTimeout(timeoutId)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    logger.error(`videoProcessor: job ${jobId} failed`, { error })

    await supabase
      .from('video_jobs')
      .update({ status: 'failed', error_message: message })
      .eq('id', jobId)

    // Best-effort cleanup
    if (recordingDir && fs.existsSync(recordingDir)) {
      fs.rmSync(recordingDir, { recursive: true, force: true })
    }
    if (fs.existsSync(voiceoverPath)) {
      fs.rmSync(voiceoverPath, { force: true })
    }
    if (finalVideoPath && fs.existsSync(finalVideoPath)) {
      fs.rmSync(finalVideoPath, { force: true })
    }

    throw error
  }
}

// ── Background CLI Execution ──────────────────────────────────────────────────
if (require.main === module) {
  const jobPayload = process.env.JOB_PAYLOAD
  if (jobPayload) {
    logger.info('Teaser video processor running via CLI')
    const jobData = JSON.parse(jobPayload) as WorkerJobData
    processJob(jobData).then(() => process.exit(0)).catch((err) => {
      logger.error('CLI Job failed', { error: err })
      process.exit(1)
    })
  } else {
    // If no JOB_PAYLOAD, run as BullMQ worker
    const worker = new Worker<VideoJobQueueData>(
      'video-generation',
      async (job: Job<WorkerJobData>) => processJob(job.data),
      { connection: _redisConn, concurrency: 2 }
    )
    worker.on('completed', (job) => logger.info(`videoProcessor: job ${job.id ?? 'unknown'} completed`))
    worker.on('failed', (job, err) => logger.error(`videoProcessor: job ${job?.id ?? 'unknown'} failed`, { error: err.message }))
    logger.info('Teaser video processor Worker started')
  }
}
