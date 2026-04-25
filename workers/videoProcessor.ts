import { config } from 'dotenv'
config({ path: '.env.local' })

import { Worker, type Job } from 'bullmq'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createServiceClient } from '../lib/supabase'
import { logger } from '../lib/logger'
import { crawlSite } from '../lib/firecrawl'
import { reconSite } from '../lib/recon'
import { understandProduct, generateScript, polishRecordedNarrations, regenerateNarrationsFromVision } from '../lib/gemini'
import { ffprobeDurationMs } from '../lib/ffmpegUtils'
import { recordProduct } from './browserRecorder'
import {
  createSkyvernTask,
  waitForTaskCompletion,
  downloadTaskVideo,
  getSceneCaptures,
  resetSceneCaptures,
  buildNavigationGoal,
  buildManifestFromCaptures,
  buildSyntheticManifest,
} from '../lib/skyvern'
import { assembleVideo } from './videoAssembler'
import type {
  RecordingManifest,
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

const INTRO_OUTRO_SECONDS = 7
const MIN_FINAL_VIDEO_SECONDS = 60
const MAX_FINAL_VIDEO_SECONDS = 300

function targetDemoDurationMs(videoLength: VideoLength): number {
  const finalSeconds = Math.max(
    MIN_FINAL_VIDEO_SECONDS,
    Math.min(MAX_FINAL_VIDEO_SECONDS, videoLength),
  )
  return Math.max(30_000, (finalSeconds - INTRO_OUTRO_SECONDS) * 1000)
}

function manifestClipDurationMs(manifest: { scenes: Array<{ clips: Array<{ start: number; end: number }> }> }): number {
  return manifest.scenes.reduce((total, scene) => {
    return total + scene.clips.reduce((sceneTotal, clip) => {
      return sceneTotal + Math.max(0, clip.end - clip.start)
    }, 0)
  }, 0)
}

function skyvernStepBudgets(videoLength: VideoLength): number[] {
  const base = Math.max(30, Math.ceil(videoLength / 4))
  return [base, Math.max(26, base - 8), Math.max(22, base - 14)]
}

function isInsufficientSkyvernFootage(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('Skyvern recording too short') || message.includes('Skyvern manifest too short')
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

  // Master timeout (60 mins)
  const timeoutId = setTimeout(async () => {
    logger.error(`videoProcessor: job ${jobId} timed out after 60 minutes`)
    await supabase.from('video_jobs').update({ status: 'failed', error_message: 'Generation timed out. Please try again.' }).eq('id', jobId)
    process.exit(1)
  }, 60 * 60 * 1000)

  try {
    // ─── STAGE 1: Product Understanding (0 → 15%) ─────────────────────────
    await updateProgress(jobId, 5, 'Analyzing your product...')

    const { content: scrapedContent, siteMap } = await crawlSite(product_url, async (msg) => {
      await updateProgress(jobId, 5, msg)
    })

    logger.info(`videoProcessor: ${jobId} — site map: ${siteMap.length} URLs discovered`)

    // ─── Live Playwright Reconnaissance ──────────────────────────────
    // Opens the site in a real browser, lets JS hydrate, and extracts
    // every real link + button + input. This is the primary fix for SPAs
    // where Firecrawl's /map endpoint returns only the root URL.
    await updateProgress(jobId, 8, 'Scanning interactive elements...')
    const inventory = await reconSite(product_url, async (msg) => {
      await updateProgress(jobId, 10, msg)
    })
    logger.info(`videoProcessor: ${jobId} — recon: ${inventory.subpages.length} subpages, ${inventory.elements.length} interactive elements`)

    // Merge siteMap with recon-discovered subpages for the widest possible
    // navigate allow-list. Deduplicate to avoid double-counting.
    const mergedSiteMap = Array.from(new Set([...siteMap, ...inventory.subpages]))
    logger.info(`videoProcessor: ${jobId} — merged site map: ${mergedSiteMap.length} URLs`)

    const understanding = await understandProduct(product_url, scrapedContent, description, video_length, features, mergedSiteMap, inventory)

    await supabase
      .from('video_jobs')
      .update({ product_understanding: understanding })
      .eq('id', jobId)

    await updateProgress(jobId, 15, 'Product analyzed. Writing your script...')

    logger.info(`videoProcessor: ${jobId} — understood product: ${understanding.product_name} (${understanding.demo_flow.length} demo steps)`)

    // ─── STAGE 2: Script Generation (15 → 35%) ────────────────────────────
    const script = await generateScript(understanding, tone, video_length)

    // The Remotion captions are driven by the scene narrations written into
    // the recording manifest. Keep the initial planned flow aligned with the
    // polished script instead of the rough analysis narration.
    for (let i = 0; i < understanding.demo_flow.length && i < script.segments.length; i++) {
      const narration = script.segments[i]?.narration
      if (narration) understanding.demo_flow[i].narration = narration
    }

    await supabase
      .from('video_jobs')
      .update({ script })
      .eq('id', jobId)

    await updateProgress(jobId, 35, 'Script ready. Recording your product demo...')

    logger.info(`videoProcessor: ${jobId} — script generated: ${script.segments.length} segments, ${script.total_duration}s`)

    // ─── STAGE 3: Vision-Guided Browser Recording (35 → 60%) ───────────────
    const useSkyvern = process.env.USE_SKYVERN === 'true'

    if (useSkyvern) {
      // ── Skyvern-powered recording ─────────────────────────────────────
      logger.info(`videoProcessor: ${jobId} — using Skyvern for recording`)

      const skyvernDir = path.join(os.tmpdir(), 'teaser-recordings', jobId)
      fs.mkdirSync(skyvernDir, { recursive: true })
      recordingDir = skyvernDir

      const maxSkyvernAttempts = 3
      const stepBudgets = skyvernStepBudgets(video_length)
      const targetDemoMs = targetDemoDurationMs(video_length)
      let skyvernSucceeded = false
      let lastSkyvernError: unknown = null

      for (let attempt = 1; attempt <= maxSkyvernAttempts; attempt++) {
        const maxSteps = stepBudgets[attempt - 1] ?? 15
        const retryLabel = attempt > 1 ? ` (retry ${attempt}/${maxSkyvernAttempts})` : ''
        try {
          await resetSceneCaptures()
          const navigationGoal = `${buildNavigationGoal(understanding, start_url, video_length)}

RETRY POLICY:
- Keep actions concise and deterministic.
- Avoid repeatedly targeting the same element if previous attempts failed.
- Prefer visible top-navigation links to discover new pages, then spend time demonstrating each page.
- Do not stop early just because 3 pages or 5 interactions are complete. The target is a real ${video_length}-second demo.`

          await updateProgress(jobId, 38, `AI agent navigating your product...${retryLabel}`)
          const task = await createSkyvernTask(
            start_url ?? product_url,
            navigationGoal,
            maxSteps,
          )

          await updateProgress(jobId, 42, `AI agent exploring features...${retryLabel}`)
          await waitForTaskCompletion(task.run_id, 45 * 60 * 1000)

          await updateProgress(jobId, 52, `Downloading recording...${retryLabel}`)
          const recordingPath = path.join(skyvernDir, 'recording.mp4')
          await downloadTaskVideo(task.run_id, recordingPath)

          const captures = await getSceneCaptures()
          const recordingDurationMs = await ffprobeDurationMs(recordingPath)
          logger.info(
            `videoProcessor: ${jobId} — Skyvern recording duration: ${Math.round((recordingDurationMs ?? 0) / 1000)}s`,
          )

          if (!recordingDurationMs || recordingDurationMs < targetDemoMs) {
            throw new Error(
              `Skyvern recording too short: ${Math.round((recordingDurationMs ?? 0) / 1000)}s recorded, ${Math.round(targetDemoMs / 1000)}s required`,
            )
          }

          // If scene captures endpoint returned nothing but we have a recording,
          // generate a synthetic manifest from the video duration.
          let manifest: RecordingManifest
          if (captures.length === 0 && fs.existsSync(recordingPath) && fs.statSync(recordingPath).size > 0) {
            logger.info(`videoProcessor: ${jobId} — no scene captures from API, generating synthetic manifest from video`)
            manifest = await buildSyntheticManifest(recordingPath, understanding, product_url)
          } else if (captures.length === 0) {
            throw new Error(`Skyvern task ${task.run_id} produced no scene captures and no recording`)
          } else {
            manifest = buildManifestFromCaptures(captures, understanding, product_url, recordingDurationMs)
          }

          const manifestDurationMs = manifestClipDurationMs(manifest)
          if (manifestDurationMs < targetDemoMs) {
            throw new Error(
              `Skyvern manifest too short: ${Math.round(manifestDurationMs / 1000)}s clips, ${Math.round(targetDemoMs / 1000)}s required`,
            )
          }

          fs.writeFileSync(
            path.join(skyvernDir, 'manifest.json'),
            JSON.stringify(manifest, null, 2),
          )

          logger.info(
            `videoProcessor: ${jobId} — Skyvern recording complete on attempt ${attempt}: ${manifest.totalScenes} scenes / ${Math.round(manifestDurationMs / 1000)}s clips`,
          )
          skyvernSucceeded = true
          break
        } catch (err) {
          lastSkyvernError = err
          logger.warn(`videoProcessor: ${jobId} — Skyvern attempt ${attempt}/${maxSkyvernAttempts} failed`, { error: err })
          if (isInsufficientSkyvernFootage(err)) {
            break
          }
          if (attempt < maxSkyvernAttempts) {
            await updateProgress(jobId, 40, `Skyvern attempt ${attempt} failed. Retrying with safer settings...`)
          }
        }
      }

      if (!skyvernSucceeded) {
        const reason = lastSkyvernError instanceof Error ? lastSkyvernError.message : String(lastSkyvernError)
        logger.warn(`videoProcessor: ${jobId} — Skyvern could not produce a full-length demo, falling back to Playwright`, { reason })
        await updateProgress(jobId, 52, 'Skyvern produced too little footage. Switching to browser recorder...')
        recordingDir = await recordProduct(
          product_url,
          understanding,
          jobId,
          credentials,
          start_url,
          mergedSiteMap,
          video_length,
        )
      }
    } else {
      // ── Legacy Playwright recording ───────────────────────────────────
      recordingDir = await recordProduct(
        product_url,
        understanding,
        jobId,
        credentials,
        start_url,
        mergedSiteMap,
        video_length,
      )
    }

    await updateProgress(jobId, 60, 'Demo recorded. Polishing captions...')

    // ─── STAGE 3b: Post-Recording Narration — vision rewrite + arc polish ──
    // Two passes: first ground each caption in its actual on-screen frame
    // (regenerateNarrationsFromVision), then lightly polish the sequence for
    // narrative arc (polishRecordedNarrations) without changing content.
    {
      const manifestPath = path.join(recordingDir, 'manifest.json')
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
          scenes: Array<{
            description: string
            narration: string
            action: string
            pageUrl: string
            clips: Array<{ start: number; end: number }>
            screenshotPath?: string
            outcomeScreenshotPath?: string
          }>
          [key: string]: unknown
        }

        // Hard duration guard: verify we have enough footage
        const totalClipMs = manifest.scenes.reduce((total, scene) =>
          total + scene.clips.reduce((st, clip) => st + Math.max(0, clip.end - clip.start), 0), 0)
        const targetMs = targetDemoDurationMs(video_length)
        const minAcceptableMs = Math.max(targetMs * 0.5, 40_000) // at least 40s OR 50% of target (whichever is greater)

        if (totalClipMs < minAcceptableMs) {
          logger.error(`videoProcessor: ${jobId} — insufficient footage: ${Math.round(totalClipMs / 1000)}s clips, need at least ${Math.round(minAcceptableMs / 1000)}s`)
          throw new Error(
            `Recording produced only ${Math.round(totalClipMs / 1000)}s of demo footage. ` +
            `This product may not have enough publicly accessible content for a full demo video.`
          )
        }

        logger.info(`videoProcessor: ${jobId} — total clip duration: ${Math.round(totalClipMs / 1000)}s (target: ${Math.round(targetMs / 1000)}s)`)

        // Pass 1: per-scene vision-grounded narration. For each scene, send
        // its reference screenshot to Gemini Vision and get a caption that
        // matches what is actually visible.
        await updateProgress(jobId, 62, 'Matching captions to your video...')
        const visionScenes = manifest.scenes.map((s) => {
          // Prefer the post-commit reveal frame for type scenes — the caption
          // should describe the OUTCOME the viewer sees (search results, AI
          // response) rather than the typing-finish moment. Falls back to the
          // mid-clip reference frame when no outcome was captured.
          const preferredPath = s.outcomeScreenshotPath ?? s.screenshotPath
          let screenshotBase64: string | undefined
          if (preferredPath && fs.existsSync(preferredPath)) {
            try {
              screenshotBase64 = fs.readFileSync(preferredPath).toString('base64')
            } catch {
              screenshotBase64 = undefined
            }
          }
          return {
            description: s.description,
            narration: s.narration,
            action: s.action,
            pageUrl: s.pageUrl,
            screenshotBase64,
          }
        })
        const visionGrounded = await regenerateNarrationsFromVision(
          visionScenes,
          understanding.product_name,
          understanding,
        )
        for (let i = 0; i < manifest.scenes.length && i < visionGrounded.length; i++) {
          manifest.scenes[i].narration = visionGrounded[i]
        }

        // Pass 2: light arc polish that preserves the vision-grounded content
        // and only smooths the narrative flow.
        await updateProgress(jobId, 65, 'Polishing the narrative arc...')
        const polished = await polishRecordedNarrations(
          manifest.scenes,
          understanding.product_name,
          understanding,
        )
        for (let i = 0; i < manifest.scenes.length && i < polished.length; i++) {
          manifest.scenes[i].narration = polished[i]
        }

        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
        logger.info(`videoProcessor: ${jobId} — narrations grounded + polished, manifest updated`)
      }
    }

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
