import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { logger } from '../lib/logger'
import type { RecordingManifest } from '../types'
import { getFfmpegPath } from '../lib/ffmpegUtils'

const RENDERED_DIR = path.join(os.tmpdir(), 'teaser-rendered')

/**
 * Lazy singleton for the Remotion bundle. `bundle()` takes 10-20s the first
 * time (webpack build); subsequent jobs reuse the same serveUrl for ~1s overhead.
 */
let _remotionServeUrl: string | null = null
async function getRemotionServeUrl(): Promise<string> {
  if (_remotionServeUrl) return _remotionServeUrl
  const entryPoint = path.resolve(process.cwd(), 'remotion/Root.tsx')
  logger.info(`videoAssembler: bundling Remotion entry ${entryPoint}`)
  _remotionServeUrl = await bundle({ entryPoint })
  logger.info('videoAssembler: Remotion bundle ready')
  return _remotionServeUrl
}

/**
 * Renders a Remotion composition to an MP4 file using the shared bundle.
 */
async function renderRemotionComposition(
  compositionId: string,
  inputProps: Record<string, unknown>,
  outputPath: string
): Promise<void> {
  const serveUrl = await getRemotionServeUrl()
  const composition = await selectComposition({ serveUrl, id: compositionId, inputProps })
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
    crf: 18,
  })
}

export interface AssembleVideoOptions {
  /** Path to the recording output directory (contains manifest.json + recording.webm) */
  recordingDir: string
  voiceoverPath: string
  jobId: string
  productUrl: string
}

/**
 * Spawns an FFmpeg process and waits for it to complete.
 * Rejects if the process exits with a non-zero code or exceeds the timeout.
 */
function spawnFfmpeg(ffmpegPath: string, args: string[], timeoutMs = 300_000): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info(`ffmpeg: ${args.slice(0, 8).join(' ')} ...`)
    const proc = spawn(ffmpegPath, args)
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`FFmpeg timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-800)}`))
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * Sanitizes text for safe inline embedding in FFmpeg drawtext filter.
 * Removes characters that would break the filtergraph parser.
 */
function dt(text: string, maxLen = 80): string {
  return text
    .replace(/\\/g, ' ')
    .replace(/:/g, ' ')
    .replace(/'/g, '')
    .replace(/"/g, '')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, maxLen)
}

/**
 * Converts a Windows path to forward-slash format for FFmpeg arguments and
 * concat filelist entries.
 */
function toFfPath(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * Builds a drawtext filter string for captions at the bottom of the frame.
 */
function captionFilter(text: string): string {
  const safe = dt(text, 90)
  if (!safe) return ''
  return `drawtext=text='${safe}':font=Arial:fontcolor=white:fontsize=30:x=(w-tw)/2:y=h-th-50:box=1:boxcolor=black@0.65:boxborderw=14`
}

/**
 * Assembles the final video from a recorded .webm + manifest using pure FFmpeg.
 *
 * Pipeline:
 * 1. Read manifest.json and filter noise clips (<800 ms, failed-element clips)
 * 2. Create intro card (3 s) — product name + tagline on dark background
 * 3. For each valid clip: extract from recording.webm, scale to 1080p, overlay caption
 * 4. Create outro card (3 s) — product domain + CTA
 * 5. Concatenate all segments via FFmpeg concat demuxer (re-encode for clean output)
 * 6. Mux with voiceover audio (silent track if no voiceover)
 * 7. Output final MP4 with faststart flag
 */
export async function assembleVideo(options: AssembleVideoOptions): Promise<string> {
  const { recordingDir, voiceoverPath, jobId } = options
  const workDir = path.join(os.tmpdir(), 'teaser-assembly', jobId)
  fs.mkdirSync(workDir, { recursive: true })
  fs.mkdirSync(RENDERED_DIR, { recursive: true })

  const finalPath = path.join(RENDERED_DIR, `${jobId}.mp4`)
  const ffmpeg = getFfmpegPath()

  try {
    // 1. Read manifest
    const manifestPath = path.join(recordingDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`manifest.json not found in ${recordingDir}`)
    }
    const manifest: RecordingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    logger.info(`assembleVideo [${jobId}]: manifest loaded — ${manifest.totalScenes} scenes, product: ${manifest.productName}`)

    const srcVideo = path.join(recordingDir, 'recording.mp4')
    const hasRecording = fs.existsSync(srcVideo)
    if (!hasRecording) {
      logger.warn(`assembleVideo [${jobId}]: recording.mp4 not found — clips will be placeholder screens`)
    }

    // 2. Filter noise clips
    const filteredScenes = manifest.scenes
      .map((scene) => ({
        ...scene,
        clips: scene.clips.filter((clip) => {
          const duration = clip.end - clip.start
          if (duration < 800) return false
          if (scene.elementNotFound && duration < 1500) return false
          return true
        }),
      }))
      .filter((scene) => scene.clips.length > 0)

    logger.info(`assembleVideo [${jobId}]: ${manifest.scenes.length} scenes → ${filteredScenes.length} after clip filtering`)

    const segmentFiles: string[] = []

    // 3. Intro card — animated Remotion composition (3 s @ 30fps)
    const introPath = path.join(workDir, 'intro.mp4')
    const titleText = dt(manifest.productName, 60)
    const taglineText = manifest.tagline || 'See what it can do'
    logger.info(`assembleVideo [${jobId}]: rendering animated intro via Remotion...`)
    try {
      await renderRemotionComposition(
        'Intro',
        { productName: manifest.productName, tagline: taglineText },
        introPath
      )
    } catch (err) {
      logger.warn(`assembleVideo [${jobId}]: Remotion intro failed, falling back to drawtext`, { err })
      await spawnFfmpeg(ffmpeg, [
        '-f', 'lavfi',
        '-i', 'color=c=0x0A0A0A:s=1920x1080:d=3:r=30',
        '-vf', [
          `drawtext=text='${titleText}':font=Arial:fontcolor=white:fontsize=80:x=(w-tw)/2:y=(h-th)/2-50`,
          `drawtext=text='${dt(taglineText, 80)}':font=Arial:fontcolor=0x6E6E6E:fontsize=36:x=(w-tw)/2:y=(h-th)/2+50`,
        ].join(','),
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
        '-pix_fmt', 'yuv420p', '-r', '30', '-an',
        '-y', introPath,
      ])
    }
    segmentFiles.push(introPath)

    // 4. Extract clips from recording.webm (or black placeholder if missing)
    let clipIdx = 0
    for (const scene of filteredScenes) {
      for (const clip of scene.clips) {
        const startSec = clip.start / 1000
        const durSec = (clip.end - clip.start) / 1000
        const clipPath = path.join(workDir, `clip_${clipIdx}.mp4`)
        const cap = captionFilter(scene.narration)

        logger.info(`assembleVideo [${jobId}]: clip ${clipIdx} — ${scene.action} at ${startSec.toFixed(2)}s for ${durSec.toFixed(2)}s`)

        if (hasRecording) {
          const scaleAndPad = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black'
          const vf = cap ? `${scaleAndPad},${cap}` : scaleAndPad
          await spawnFfmpeg(ffmpeg, [
            '-ss', String(startSec),
            '-i', toFfPath(srcVideo),
            '-t', String(durSec),
            '-vf', vf,
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
            '-pix_fmt', 'yuv420p', '-r', '30', '-an',
            '-y', clipPath,
          ])
        } else {
          // Fallback: dark screen with caption
          const vf = cap
            ? `${cap}`
            : `drawtext=text='${dt(scene.description, 80)}':font=Arial:fontcolor=0x6E6E6E:fontsize=28:x=(w-tw)/2:y=(h-th)/2`
          await spawnFfmpeg(ffmpeg, [
            '-f', 'lavfi',
            '-i', `color=c=0x0A0A0A:s=1920x1080:d=${durSec.toFixed(3)}:r=30`,
            '-vf', vf,
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
            '-pix_fmt', 'yuv420p', '-r', '30', '-an',
            '-y', clipPath,
          ])
        }

        segmentFiles.push(clipPath)
        clipIdx++
      }
    }

    // If nothing was captured, add a 5 s placeholder before the outro
    if (segmentFiles.length === 1) {
      logger.warn(`assembleVideo [${jobId}]: no valid clips produced — inserting placeholder`)
      const placeholderPath = path.join(workDir, 'placeholder.mp4')
      await spawnFfmpeg(ffmpeg, [
        '-f', 'lavfi',
        '-i', 'color=c=0x0A0A0A:s=1920x1080:d=5:r=30',
        '-vf', `drawtext=text='${titleText}':font=Arial:fontcolor=white:fontsize=64:x=(w-tw)/2:y=(h-th)/2`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-pix_fmt', 'yuv420p', '-r', '30', '-an',
        '-y', placeholderPath,
      ])
      segmentFiles.push(placeholderPath)
    }

    // 5. Outro card — animated Remotion composition (4 s @ 30fps)
    const outroPath = path.join(workDir, 'outro.mp4')
    const outroDomain = dt(manifest.productUrl.replace(/^https?:\/\//, '').split('/')[0], 60)
    logger.info(`assembleVideo [${jobId}]: rendering animated outro via Remotion...`)
    try {
      await renderRemotionComposition(
        'Outro',
        { productName: manifest.productName, productUrl: manifest.productUrl },
        outroPath
      )
    } catch (err) {
      logger.warn(`assembleVideo [${jobId}]: Remotion outro failed, falling back to drawtext`, { err })
      await spawnFfmpeg(ffmpeg, [
        '-f', 'lavfi',
        '-i', 'color=c=0x0A0A0A:s=1920x1080:d=3:r=30',
        '-vf', [
          `drawtext=text='${outroDomain}':font=Arial:fontcolor=white:fontsize=64:x=(w-tw)/2:y=(h-th)/2-30`,
          `drawtext=text='Try it free':font=Arial:fontcolor=0x22C55E:fontsize=40:x=(w-tw)/2:y=(h-th)/2+50`,
        ].join(','),
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
        '-pix_fmt', 'yuv420p', '-r', '30', '-an',
        '-y', outroPath,
      ])
    }
    segmentFiles.push(outroPath)

    // 6. Write concat list and concatenate via stream copy.
    // All segments are already H.264 30fps yuv420p — copying avoids a generational
    // quality loss and saves ~30-90s per job.
    const fileListPath = path.join(workDir, 'filelist.txt')
    fs.writeFileSync(
      fileListPath,
      segmentFiles.map((f) => `file '${toFfPath(f)}'`).join('\n'),
      'utf-8'
    )

    const concatPath = path.join(workDir, 'concat.mp4')
    logger.info(`assembleVideo [${jobId}]: concatenating ${segmentFiles.length} segments (stream copy)...`)
    try {
      await spawnFfmpeg(
        ffmpeg,
        [
          '-f', 'concat', '-safe', '0',
          '-i', fileListPath,
          '-c', 'copy',
          '-movflags', '+faststart',
          '-y', concatPath,
        ],
        120_000
      )
    } catch (copyErr) {
      // Remotion output and our libx264 clips may differ in SPS/timebase.
      // Fall back to a single normalizing re-encode to guarantee a clean concat.
      logger.warn(`assembleVideo [${jobId}]: stream-copy concat failed, re-encoding`, { copyErr })
      await spawnFfmpeg(
        ffmpeg,
        [
          '-f', 'concat', '-safe', '0',
          '-i', fileListPath,
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
          '-pix_fmt', 'yuv420p', '-r', '30',
          '-movflags', '+faststart',
          '-y', concatPath,
        ],
        240_000
      )
    }

    // 7. Mux with voiceover (or add silent audio track)
    const hasVoiceover =
      fs.existsSync(voiceoverPath) && fs.statSync(voiceoverPath).size > 0

    if (hasVoiceover) {
      logger.info(`assembleVideo [${jobId}]: mixing voiceover...`)
      try {
        await spawnFfmpeg(ffmpeg, [
          '-i', concatPath,
          '-i', voiceoverPath,
          '-filter_complex', '[1:a]volume=1.2[vo];[vo]apad[aout]',
          '-map', '0:v',
          '-map', '[aout]',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
          '-movflags', '+faststart',
          '-shortest',
          '-y', finalPath,
        ])
      } catch (audioErr) {
        logger.warn(`assembleVideo [${jobId}]: voiceover mix failed, copying without audio: ${audioErr}`)
        fs.copyFileSync(concatPath, finalPath)
      }
    } else {
      logger.info(`assembleVideo [${jobId}]: no voiceover — adding silent audio track...`)
      try {
        await spawnFfmpeg(ffmpeg, [
          '-i', concatPath,
          '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
          '-movflags', '+faststart',
          '-shortest',
          '-y', finalPath,
        ])
      } catch {
        // Last resort: just copy the video-only file
        fs.copyFileSync(concatPath, finalPath)
      }
    }

    logger.info(`assembleVideo [${jobId}]: complete → ${finalPath}`)
    return finalPath
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}
