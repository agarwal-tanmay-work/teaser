import { config } from 'dotenv'
config({ path: '.env.local' })

import { Worker, type Job } from 'bullmq'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createServiceClient } from '../lib/supabase'
import { generateVoiceover } from '../lib/elevenlabs'
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
  // Parse port from URL (Upstash TLS uses 6380, not 6379)
  const parsed = restUrl ? new URL(restUrl) : null
  const host = parsed?.hostname ?? '127.0.0.1'
  // Upstash often requires explicit IPv4 and servername for direct TCP connections
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
}

/**
 * Updates the progress, message, and status of a video job in Supabase.
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
  }
}



/**
 * BullMQ worker that processes video generation jobs end-to-end.
 *
 * Stages:
 *   Stage 1 (0-15%):  Product understanding via Firecrawl + Gemini
 *   Stage 2 (15-35%): Script generation via Gemini
 *   Stage 3 (35-55%): Browser recording via Playwright
 *   Stage 4 (55-70%): Voiceover generation via ElevenLabs
 *   Stage 5 (70-90%): Video assembly via FFmpeg
 *   Stage 6 (90-100%): Upload to Supabase Storage + cleanup
 *
 * On any failure: logs the error, marks the job as 'failed' in Supabase, rethrows.
 */
const _redisConn = buildRedisConnection()

export async function processJob(jobData: WorkerJobData) {
  const { jobId, product_url, description, tone, video_length, credentials } = jobData
  const supabase = createServiceClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const voiceoverPath = path.join(os.tmpdir(), 'teaser-voiceovers', `${jobId}.mp3`)
  let recordingPath = ''
  let finalVideoPath = ''

  try {
    // ─── STAGE 1: Product Understanding (0 → 15%) ─────────────────────────
    await updateProgress(jobId, 5, 'Analyzing your product...')

    // Direct call instead of fetchInternal loop
    const scrapedContent = await crawlSite(product_url, async (msg) => {
      await updateProgress(jobId, 5, msg)
    })

    const understanding = await understandProduct(product_url, scrapedContent, description, video_length)

    await supabase
      .from('video_jobs')
      .update({ product_understanding: understanding })
      .eq('id', jobId)

    await updateProgress(jobId, 15, 'Got it. Writing your script...')

    // ─── STAGE 2: Script Generation (15 → 35%) ────────────────────────────
    const script = await generateScript(understanding, tone, video_length)

    await supabase
      .from('video_jobs')
      .update({ script })
      .eq('id', jobId)

    await updateProgress(jobId, 35, 'Script ready. Opening your product in our browser...')

      // ─── STAGE 3: Browser Recording (35 → 55%) ────────────────────────────
      recordingPath = await recordProduct(
        product_url,
        understanding,
        jobId,
        credentials
      )

      await updateProgress(jobId, 55, 'Demo recorded. Preparing video...')

      // ─── STAGE 4: Voiceover — TEMPORARILY DISABLED (Gemini TTS quota exceeded) ──
      // To re-enable: uncomment the lines below and remove the silent-audio block.
      //
      // fs.mkdirSync(path.join(os.tmpdir(), 'teaser-voiceovers'), { recursive: true })
      // const fullScript = script.segments.map((s) => s.narration).join(' ')
      // await generateVoiceover(fullScript, tone, voiceoverPath)
      //
      // ── Temporary: generate 90s of silence as stand-in voiceover ─────────
      {
        const { getFfmpegPath } = await import('../lib/ffmpegUtils')
        const { spawn } = await import('child_process')
        fs.mkdirSync(path.join(os.tmpdir(), 'teaser-voiceovers'), { recursive: true })
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

      await updateProgress(jobId, 70, 'Editing your video...')

    // ─── STAGE 5: Video Assembly (70 → 90%) ───────────────────────────────
    finalVideoPath = await assembleVideo({
      recordingPath,
      voiceoverPath,
      script,
      understanding,
      videoLength: video_length,
      jobId,
    })

      await updateProgress(jobId, 90, 'Almost done. Uploading your video...')

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

      // Cleanup all temp files
      const recordingDir = path.join(os.tmpdir(), 'teaser-recordings', jobId)
      if (fs.existsSync(recordingDir)) {
        fs.rmSync(recordingDir, { recursive: true, force: true })
      }
      if (fs.existsSync(voiceoverPath)) {
        fs.rmSync(voiceoverPath, { force: true })
      }
      if (fs.existsSync(finalVideoPath)) {
        fs.rmSync(finalVideoPath, { force: true })
      }

      logger.info(`videoProcessor: job ${jobId} completed successfully`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred'
      logger.error(`videoProcessor: job ${jobId} failed`, { error })

      await supabase
        .from('video_jobs')
        .update({ status: 'failed', error_message: message })
        .eq('id', jobId)

      // Best-effort cleanup on failure
      const recordingDir = path.join(os.tmpdir(), 'teaser-recordings', jobId)
      if (fs.existsSync(recordingDir)) {
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
// This allows us to bypass BullMQ entirely and run jobs without Redis via spawn
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
