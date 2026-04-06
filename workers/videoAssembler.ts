import fs from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import { logger } from '../lib/logger'
import type { VideoScript, ProductUnderstanding, VideoLength } from '../types'

const RENDERED_DIR = '/tmp/rendered'

/** Options for assembling a complete video from its component parts. */
export interface AssembleVideoOptions {
  recordingPath: string
  voiceoverPath: string
  script: VideoScript
  understanding: ProductUnderstanding
  videoLength: VideoLength
  jobId: string
}

/**
 * Wraps a fluent-ffmpeg command in a Promise so it can be awaited.
 * Rejects with the FFmpeg error on failure.
 */
function runFfmpeg(command: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    command
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run()
  })
}

/**
 * Escapes special characters in a string for use inside FFmpeg drawtext filters.
 * Handles colons, single quotes, backslashes, brackets, and commas.
 * Truncates to 120 characters to avoid filter string overflows.
 */
function escapeFfmpegText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .slice(0, 120)
}

/**
 * Assembles the final launch video from all component parts using FFmpeg.
 *
 * Pipeline:
 * 1. Convert .webm recording → .mp4 (strip audio, force 1280×720 @ 30fps)
 * 2. Create 2-second branded intro (black background + product name in white)
 * 3. Create 3-second branded outro (black background + useteaser.com in gray)
 * 4. Concatenate intro + recording + outro into a single video
 * 5. Final render: add voiceover (-3dB) + background sine tone (-20dB) + timed captions
 *
 * All intermediate files are cleaned up after the final render.
 *
 * @param options - Recording, voiceover, script, understanding, video length, and job ID
 * @returns Absolute path to the finished .mp4 file in /tmp/rendered/
 */
export async function assembleVideo(options: AssembleVideoOptions): Promise<string> {
  const { recordingPath, voiceoverPath, script, understanding, jobId } = options

  const workDir = `/tmp/assembly/${jobId}`
  fs.mkdirSync(workDir, { recursive: true })
  fs.mkdirSync(RENDERED_DIR, { recursive: true })

  const convertedPath = path.join(workDir, 'recording.mp4')
  const introPath = path.join(workDir, 'intro.mp4')
  const outroPath = path.join(workDir, 'outro.mp4')
  const concatListPath = path.join(workDir, 'concat.txt')
  const concatPath = path.join(workDir, 'concat.mp4')
  const finalPath = path.join(RENDERED_DIR, `${jobId}.mp4`)

  try {
    // Step 1: Convert .webm to .mp4, strip audio, normalise resolution
    logger.info(`assembleVideo [${jobId}]: converting recording`)
    await runFfmpeg(
      ffmpeg(recordingPath)
        .noAudio()
        .videoCodec('libx264')
        .size('1280x720')
        .outputOptions(['-crf 23', '-preset fast', '-r 30', '-pix_fmt yuv420p'])
        .output(convertedPath)
    )

    // Step 2: 2-second branded intro — black background + product name centred
    const titleText = escapeFfmpegText(understanding.product_name)
    logger.info(`assembleVideo [${jobId}]: creating intro`)
    await runFfmpeg(
      ffmpeg()
        .input('color=c=black:size=1280x720:duration=2:rate=30')
        .inputFormat('lavfi')
        .noAudio()
        .videoFilters(
          `drawtext=text='${titleText}':fontsize=52:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`
        )
        .videoCodec('libx264')
        .outputOptions(['-pix_fmt yuv420p', '-preset fast'])
        .output(introPath)
    )

    // Step 3: 3-second branded outro — useteaser.com in gray
    logger.info(`assembleVideo [${jobId}]: creating outro`)
    await runFfmpeg(
      ffmpeg()
        .input('color=c=black:size=1280x720:duration=3:rate=30')
        .inputFormat('lavfi')
        .noAudio()
        .videoFilters(
          `drawtext=text='useteaser.com':fontsize=42:fontcolor=0x6E6E6E:x=(w-text_w)/2:y=(h-text_h)/2`
        )
        .videoCodec('libx264')
        .outputOptions(['-pix_fmt yuv420p', '-preset fast'])
        .output(outroPath)
    )

    // Step 4: Concatenate intro + recording + outro (video only)
    logger.info(`assembleVideo [${jobId}]: concatenating segments`)
    const concatContent = [
      `file '${introPath}'`,
      `file '${convertedPath}'`,
      `file '${outroPath}'`,
    ].join('\n')
    fs.writeFileSync(concatListPath, concatContent, 'utf-8')

    await runFfmpeg(
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f concat', '-safe 0'])
        .noAudio()
        .videoCodec('libx264')
        .outputOptions(['-pix_fmt yuv420p', '-preset fast'])
        .output(concatPath)
    )

    // Step 5: Build timed caption filters from script segments (offset by 2s for intro)
    const captionFilters = script.segments
      .map((seg) => {
        const text = escapeFfmpegText(seg.narration)
        const start = (seg.start_time + 2).toFixed(2)
        const end = (seg.end_time + 2).toFixed(2)
        return (
          `drawtext=text='${text}'` +
          `:enable='between(t\\,${start}\\,${end})'` +
          `:fontsize=22:fontcolor=white` +
          `:x=(w-text_w)/2:y=h-th-40` +
          `:box=1:boxcolor=black@0.6:boxborderw=8`
        )
      })
      .join(',')

    const videoFilterStr = captionFilters
      ? `[0:v]${captionFilters}[vout]`
      : `[0:v]scale=1280:720[vout]`

    // Step 6: Final render — overlay voiceover + background tone + captions
    logger.info(`assembleVideo [${jobId}]: final render with audio and captions`)
    await runFfmpeg(
      ffmpeg()
        .input(concatPath)
        .input(voiceoverPath)
        // Placeholder background music: 432 Hz sine tone at very low volume
        .input('sine=frequency=432:sample_rate=44100')
        .inputFormat('lavfi')
        .complexFilter([
          videoFilterStr,
          '[1:a]volume=-3dB[voice]',
          '[2:a]volume=-20dB[music]',
          '[voice][music]amix=inputs=2:duration=first[aout]',
        ])
        .map('[vout]')
        .map('[aout]')
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions(['-crf 23', '-preset fast', '-r 30', '-pix_fmt yuv420p'])
        .output(finalPath)
    )

    logger.info(`assembleVideo [${jobId}]: complete → ${finalPath}`)
    return finalPath
  } finally {
    // Always clean up intermediate assembly files
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}
