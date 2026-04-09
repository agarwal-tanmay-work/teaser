import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import ffmpeg from 'fluent-ffmpeg'
import { logger } from '../lib/logger'
import type { VideoScript, ProductUnderstanding, VideoLength } from '../types'

const RENDERED_DIR = path.join(os.tmpdir(), 'teaser-rendered')

// Ensure fluent-ffmpeg knows where the binaries are on Windows
const ffmpegBinary = getFfmpegPath()
if (ffmpegBinary !== 'ffmpeg') {
  ffmpeg.setFfmpegPath(ffmpegBinary)
}
const ffprobeBinary = getFfprobePath()
if (ffprobeBinary !== 'ffprobe') {
  ffmpeg.setFfprobePath(ffprobeBinary)
}

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
 * Finds the absolute path to the FFmpeg binary.
 */
export function getFfmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  const windowsStandard = 'C:\\ffmpeg\\bin\\ffmpeg.exe'
  const exists = fs.existsSync(windowsStandard)
  logger.info(`getFfmpegPath: checking ${windowsStandard} ... exists: ${exists}`)
  if (os.platform() === 'win32' && exists) {
    return windowsStandard
  }
  return 'ffmpeg'
}

/**
 * Finds the absolute path to the FFprobe binary.
 */
export function getFfprobePath(): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH
  const windowsStandard = 'C:\\ffmpeg\\bin\\ffprobe.exe'
  const exists = fs.existsSync(windowsStandard)
  logger.info(`getFfprobePath: checking ${windowsStandard} ... exists: ${exists}`)
  if (os.platform() === 'win32' && exists) {
    return windowsStandard
  }
  return 'ffprobe'
}

/**
 * Validates that FFmpeg is callable.
 */
export async function validateFfmpeg(): Promise<void> {
  const binary = getFfmpegPath()
  return new Promise((resolve, reject) => {
    const p = spawn(binary, ['-version'])
    p.on('error', (err) => reject(new Error(`FFmpeg not found at ${binary}: ${err.message}`)))
    p.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg failed to start with code ${code}`))
    })
  })
}

/**
 * Executes a raw FFmpeg command array using child_process.spawn.
 * Subverts fluent-ffmpeg's overzealous format validation for lavfi devices.
 */
function runRawFfmpeg(args: string[]): Promise<void> {
  const binary = getFfmpegPath()
  logger.info(`runRawFfmpeg: executing ${binary} ${args.join(' ')}`)

  return new Promise((resolve, reject) => {
    const p = spawn(binary, args)
    let errorLog = ''
    p.stderr.on('data', (d) => { errorLog += d.toString() })
    p.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg exited with code ${code}: ${errorLog.slice(-500)}`))
    })
    p.on('error', (err) => {
      if ((err as any).code === 'ENOENT') {
        reject(new Error(`FFmpeg binary not found at "${binary}". Please install it and add to PATH.`))
      } else {
        reject(err)
      }
    })
  })
}

/**
 * Wraps text into multiple lines to fit on screen.
 * Approximately 50 characters per line.
 */
function wrapText(text: string, maxChars: number = 55): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    if ((currentLine + ' ' + word).length > maxChars) {
      if (currentLine) lines.push(currentLine.trim())
      currentLine = word
    } else {
      currentLine = currentLine ? currentLine + ' ' + word : word
    }
  }
  if (currentLine) lines.push(currentLine.trim())
  
  return lines
}

/**
 * Escapes special characters in a string for use inside FFmpeg drawtext filters.
 * When using single quotes text='...', we escape ' by doubling it ''.
 * Backslashes must be doubled too.
 */
function escapeFfmpegText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")        // FFmpeg doubling escape
    .replace(/:/g, '\\:')       // Colons are separators in filters
    .replace(/,/g, '\\,')       // Commas are separators in graphs
    .replace(/[\r\n]+/g, ' ')   // Strip newlines
    .slice(0, 150)
}

/**
 * Assembles the final launch video from all component parts using FFmpeg.
 */
export async function assembleVideo(options: AssembleVideoOptions): Promise<string> {
  const { recordingPath, voiceoverPath, script, understanding, jobId } = options

  const workDir = path.join(os.tmpdir(), 'teaser-assembly', jobId)
  fs.mkdirSync(workDir, { recursive: true })
  fs.mkdirSync(RENDERED_DIR, { recursive: true })

  const convertedPath = path.join(workDir, 'recording.mp4')
  const introPath = path.join(workDir, 'intro.mp4')
  const outroPath = path.join(workDir, 'outro.mp4')
  const concatListPath = path.join(workDir, 'concat.txt')
  const concatPath = path.join(workDir, 'concat.mp4')
  const filterScriptPath = path.join(workDir, 'filter.txt')
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

    // Step 2: 2-second branded intro
    const titleText = escapeFfmpegText(understanding.product_name)
    logger.info(`assembleVideo [${jobId}]: creating intro`)
    await runRawFfmpeg([
      '-f', 'lavfi', '-i', 'color=c=black:size=1280x720:duration=2:rate=30',
      '-vf', `drawtext=text='${titleText}':fontsize=52:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'fast',
      '-y',
      introPath
    ])

    // Step 3: 3-second branded outro
    logger.info(`assembleVideo [${jobId}]: creating outro`)
    await runRawFfmpeg([
      '-f', 'lavfi', '-i', 'color=c=black:size=1280x720:duration=3:rate=30',
      '-vf', `drawtext=text='useteaser.com':fontsize=42:fontcolor=0x6E6E6E:x=(w-text_w)/2:y=(h-text_h)/2`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'fast',
      '-y',
      outroPath
    ])

    // Step 4: Concatenate intro + recording + outro
    logger.info(`assembleVideo [${jobId}]: concatenating segments`)
    const concatContent = [
      `file '${introPath.replace(/'/g, "'\\''")}'`,
      `file '${convertedPath.replace(/'/g, "'\\''")}'`,
      `file '${outroPath.replace(/'/g, "'\\''")}'`,
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

    // Step 5: Build robust linear filter graph
    const drawtextFilters = script.segments
      .flatMap((seg) => {
        const wrappedLines = wrapText(seg.narration)
        const start = (seg.start_time + 2).toFixed(2)
        const end = (seg.end_time + 2).toFixed(2)
        
        return wrappedLines.map((line, i) => {
          const text = escapeFfmpegText(line)
          const yOffset = 40 + (wrappedLines.length - 1 - i) * 30
          return (
            `drawtext=text='${text}'` +
            `:enable='between(t\\,${start}\\,${end})'` +
            `:fontsize=24:fontcolor=white` +
            `:x=(w-text_w)/2:y=h-th-${yOffset}` +
            `:box=1:boxcolor=black@0.6:boxborderw=8`
          )
        })
      })
      .filter(Boolean)

    let videoFilterLines = ''
    if (drawtextFilters.length === 0) {
      videoFilterLines = `[0:v]scale=1280:720[vout]`
    } else {
      let currentInput = '[0:v]'
      for (let i = 0; i < drawtextFilters.length; i++) {
        const isLast = i === drawtextFilters.length - 1
        const outputLabel = isLast ? '[vout]' : `[v${i+1}]`
        videoFilterLines += `${currentInput}${drawtextFilters[i]}${outputLabel};\n`
        currentInput = outputLabel
      }
    }

    const audioFilterLines = [
      '[1:a]volume=-3dB[voice];',
      '[2:a]volume=-22dB[music];', // Reduced music further to prevent clipping
      '[voice][music]amix=inputs=2:duration=first[aout]'
    ].join('\n')

    const filterScriptContent = [videoFilterLines, audioFilterLines].join('\n')
    fs.writeFileSync(filterScriptPath, filterScriptContent, 'utf-8')
    logger.info(`assembleVideo [${jobId}]: filter script created (${filterScriptContent.length} chars)`)

    // Step 6: Final render using filter script
    logger.info(`assembleVideo [${jobId}]: final render with audio and captions`)
    
    await runRawFfmpeg([
      '-i', concatPath,
      '-i', voiceoverPath,
      '-f', 'lavfi', '-i', 'sine=frequency=432:sample_rate=44100',
      '-filter_complex_script', filterScriptPath,
      '-map', '[vout]',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-crf', '23',
      '-preset', 'fast',
      '-r', '30',
      '-pix_fmt', 'yuv420p',
      '-t', String(options.videoLength + 10),
      '-y',
      finalPath
    ])

    logger.info(`assembleVideo [${jobId}]: complete → ${finalPath}`)
    return finalPath
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}



