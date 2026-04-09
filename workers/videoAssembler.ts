import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import ffmpeg from 'fluent-ffmpeg'
import { logger } from '../lib/logger'
import type { VideoScript, ProductUnderstanding, VideoLength, ClickEvent } from '../types'

/** Output resolution: Full HD 1080p */
const OUT_W = 1920
const OUT_H = 1080

/** Browser window sits inside the background with padding */
const BROWSER_W = 1680
const BROWSER_H = 945
const PAD_X = Math.round((OUT_W - BROWSER_W) / 2)
const PAD_Y = Math.round((OUT_H - BROWSER_H) / 2)

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
 */
function runRawFfmpeg(args: string[]): Promise<void> {
  const binary = getFfmpegPath()
  logger.info(`runRawFfmpeg: executing ${binary} with ${args.length} args`)

  return new Promise((resolve, reject) => {
    const p = spawn(binary, args)
    let errorLog = ''
    p.stderr.on('data', (d) => { errorLog += d.toString() })
    p.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg exited with code ${code}: ${errorLog.slice(-800)}`))
    })
    p.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(`FFmpeg binary not found at "${binary}". Please install it and add to PATH.`))
      } else {
        reject(err)
      }
    })
  })
}

/**
 * Wraps text into multiple lines to fit on screen.
 */
function wrapText(text: string, maxChars: number = 65): string[] {
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
 * Escapes special characters for FFmpeg drawtext filters used in filter script files.
 * In filter scripts, colons and backslashes need single-level escaping.
 */
function escapeForFilterScript(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 200)
}

/**
 * Escapes special characters for FFmpeg drawtext filters passed via -vf argument.
 * Needs double escaping since the shell processes one level.
 */
function escapeForVfArg(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 200)
}

/**
 * Loads click events from the sidecar JSON file created by browserRecorder.
 */
function loadClickEvents(recordingPath: string): ClickEvent[] {
  try {
    const eventsPath = path.join(path.dirname(recordingPath), 'click_events.json')
    if (fs.existsSync(eventsPath)) {
      const raw = fs.readFileSync(eventsPath, 'utf-8')
      return JSON.parse(raw) as ClickEvent[]
    }
  } catch (err) {
    logger.warn('loadClickEvents: failed to load click events', { error: err })
  }
  return []
}

/**
 * Creates a premium branded intro clip with gradient background and animated text.
 */
async function createIntro(
  outputPath: string,
  productName: string,
  tagline: string,
  duration: number = 3
): Promise<void> {
  const escapedName = escapeForVfArg(productName)
  const escapedTagline = escapeForVfArg(tagline)

  // Gradient background with centered product name and tagline
  const vf = [
    // Indigo-to-purple gradient
    `geq=r='clip(40+X*55/${OUT_W}\\,0\\,255)':g='clip(30+X*30/${OUT_W}\\,0\\,255)':b='clip(140+X*100/${OUT_W}\\,0\\,255)'`,
    // Product name — large, centered, fade-in
    `drawtext=text='${escapedName}'` +
    `:fontsize=72:fontcolor=white` +
    `:x=(w-text_w)/2:y=(h-text_h)/2-40` +
    `:alpha='if(lt(t\\,0.5)\\,t*2\\,1)'`,
    // Tagline — smaller, below the name, staggered fade-in
    `drawtext=text='${escapedTagline}'` +
    `:fontsize=32:fontcolor=0xcccccc` +
    `:x=(w-text_w)/2:y=(h/2)+40` +
    `:alpha='if(lt(t\\,1)\\,0\\,if(lt(t\\,1.5)\\,(t-1)*2\\,1))'`,
  ].join(',')

  await runRawFfmpeg([
    '-f', 'lavfi', '-i', `color=c=black:size=${OUT_W}x${OUT_H}:duration=${duration}:rate=30`,
    '-vf', vf,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'medium',
    '-y',
    outputPath,
  ])
}

/**
 * Creates a premium branded outro clip with dark gradient and subtle glow.
 */
async function createOutro(
  outputPath: string,
  duration: number = 3
): Promise<void> {
  const vf = [
    // Dark gradient background
    `geq=r='clip(8+X*5/${OUT_W}\\,0\\,255)':g='clip(6+X*3/${OUT_W}\\,0\\,255)':b='clip(16+X*10/${OUT_W}\\,0\\,255)'`,
    // Main CTA text — fade-in
    `drawtext=text='useteaser.com'` +
    `:fontsize=56:fontcolor=0xaaaacc` +
    `:x=(w-text_w)/2:y=(h-text_h)/2` +
    `:alpha='if(lt(t\\,0.5)\\,t*2\\,1)'`,
    // Subtitle
    `drawtext=text='Create your product video in seconds'` +
    `:fontsize=24:fontcolor=0x666688` +
    `:x=(w-text_w)/2:y=(h/2)+50` +
    `:alpha='if(lt(t\\,1)\\,0\\,if(lt(t\\,1.5)\\,(t-1)*2\\,1))'`,
    // Fade out at the end
    `fade=t=out:st=${duration - 0.8}:d=0.8`,
  ].join(',')

  await runRawFfmpeg([
    '-f', 'lavfi', '-i', `color=c=black:size=${OUT_W}x${OUT_H}:duration=${duration}:rate=30`,
    '-vf', vf,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'medium',
    '-y',
    outputPath,
  ])
}

/**
 * Creates the framed composition: browser recording centered on a dark gradient
 * background with a soft drop shadow.
 *
 * Uses a two-pass approach to avoid complex filter graph issues:
 * 1. Generate a static gradient background frame (PNG)
 * 2. Overlay the scaled browser recording onto it
 */
async function createFramedRecording(
  inputPath: string,
  outputPath: string,
  workDir: string
): Promise<void> {
  const bgPath = path.join(workDir, 'gradient_bg.png')

  // Step A: generate a single-frame dark gradient background
  await runRawFfmpeg([
    '-f', 'lavfi',
    '-i', `color=c=0x0c0a1a:s=${OUT_W}x${OUT_H}:d=1:r=1`,
    '-vf', `geq=r='clip(12+X/20+Y/25\\,0\\,255)':g='clip(8+X/30\\,0\\,255)':b='clip(22+X/15+Y/20\\,0\\,255)'`,
    '-frames:v', '1',
    '-y',
    bgPath,
  ])

  // Step B: overlay the browser recording onto the gradient background
  // The filter graph:
  //   [1:v] = gradient bg image (looped to match video duration)
  //   [0:v] = browser recording
  //   Scale browser, create shadow, compose
  const filterGraph = [
    // Loop the background image to match the video duration
    `[1:v]loop=loop=-1:size=1:start=0,setpts=N/30/TB,scale=${OUT_W}:${OUT_H}[bg]`,
    // Scale the browser recording
    `[0:v]scale=${BROWSER_W}:${BROWSER_H}:flags=lanczos[browser]`,
    // Overlay browser on background with padding
    `[bg][browser]overlay=${PAD_X}:${PAD_Y}:shortest=1[framed]`,
  ].join(';')

  const filterPath = path.join(workDir, 'framing.txt')
  fs.writeFileSync(filterPath, filterGraph, 'utf-8')

  await runRawFfmpeg([
    '-i', inputPath,
    '-i', bgPath,
    '-filter_complex_script', filterPath,
    '-map', '[framed]',
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'medium',
    '-r', '30',
    '-pix_fmt', 'yuv420p',
    '-y',
    outputPath,
  ])
}

/**
 * Assembles the final launch video with premium post-processing.
 *
 * Pipeline:
 * 1. Convert .webm → .mp4 (strip audio, normalize)
 * 2. Create gradient background + browser framing with shadow
 * 3. Render premium intro/outro clips with gradient + text
 * 4. Concatenate intro + framed recording + outro
 * 5. Apply auto-zoom on click coordinates (first click only for reliability)
 * 6. Overlay timed captions with pill-style semi-transparent background
 * 7. Mix voiceover + ambient music
 */
export async function assembleVideo(options: AssembleVideoOptions): Promise<string> {
  const { recordingPath, voiceoverPath, script, understanding, jobId } = options

  const workDir = path.join(os.tmpdir(), 'teaser-assembly', jobId)
  fs.mkdirSync(workDir, { recursive: true })
  fs.mkdirSync(RENDERED_DIR, { recursive: true })

  const convertedPath = path.join(workDir, 'recording.mp4')
  const framedPath = path.join(workDir, 'framed.mp4')
  const introPath = path.join(workDir, 'intro.mp4')
  const outroPath = path.join(workDir, 'outro.mp4')
  const concatListPath = path.join(workDir, 'concat.txt')
  const concatPath = path.join(workDir, 'concat.mp4')
  const filterScriptPath = path.join(workDir, 'filter.txt')
  const finalPath = path.join(RENDERED_DIR, `${jobId}.mp4`)

  // Load click events for zoom effects
  const clickEvents = loadClickEvents(recordingPath)
  logger.info(`assembleVideo [${jobId}]: loaded ${clickEvents.length} click events`)

  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // Step 1: Convert .webm → .mp4, strip audio, keep native resolution
    // ═══════════════════════════════════════════════════════════════════════════
    logger.info(`assembleVideo [${jobId}]: converting recording to mp4`)
    await runFfmpeg(
      ffmpeg(recordingPath)
        .noAudio()
        .videoCodec('libx264')
        .outputOptions(['-crf 18', '-preset medium', '-r 30', '-pix_fmt yuv420p'])
        .output(convertedPath)
    )

    // ═══════════════════════════════════════════════════════════════════════════
    // Step 2: Frame recording inside premium gradient background
    // ═══════════════════════════════════════════════════════════════════════════
    logger.info(`assembleVideo [${jobId}]: creating framed composition`)
    await createFramedRecording(convertedPath, framedPath, workDir)

    // ═══════════════════════════════════════════════════════════════════════════
    // Step 3: Create premium intro and outro
    // ═══════════════════════════════════════════════════════════════════════════
    logger.info(`assembleVideo [${jobId}]: creating intro`)
    await createIntro(introPath, understanding.product_name, understanding.tagline)

    logger.info(`assembleVideo [${jobId}]: creating outro`)
    await createOutro(outroPath)

    // ═══════════════════════════════════════════════════════════════════════════
    // Step 4: Concatenate intro + framed recording + outro
    // ═══════════════════════════════════════════════════════════════════════════
    logger.info(`assembleVideo [${jobId}]: concatenating segments`)
    const concatContent = [
      `file '${introPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`,
      `file '${framedPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`,
      `file '${outroPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`,
    ].join('\n')
    fs.writeFileSync(concatListPath, concatContent, 'utf-8')

    await runFfmpeg(
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f concat', '-safe 0'])
        .noAudio()
        .videoCodec('libx264')
        .outputOptions(['-pix_fmt yuv420p', '-preset medium', '-crf 18'])
        .output(concatPath)
    )

    // ═══════════════════════════════════════════════════════════════════════════
    // Step 5: Build final filter graph (zoom + captions + audio)
    // ═══════════════════════════════════════════════════════════════════════════
    logger.info(`assembleVideo [${jobId}]: building final filter graph`)

    const introOffset = 3 // Intro duration in seconds

    // ── Auto-zoom on first click ──
    // We apply zoom to ONE click for reliability (complex crop chains break easily)
    let zoomFilter = ''
    if (clickEvents.length > 0) {
      const ev = clickEvents[0]
      const t = ev.timestamp + introOffset
      const zStart = t.toFixed(2)
      const zPeak = (t + 0.5).toFixed(2)
      const zEnd = (t + 2.0).toFixed(2)

      // Map click pos from browser viewport → composited frame
      const normX = ev.x / VIDEO_W_SOURCE
      const normY = ev.y / VIDEO_H_SOURCE
      const tgtX = Math.round(PAD_X + normX * BROWSER_W)
      const tgtY = Math.round(PAD_Y + normY * BROWSER_H)

      // When zoomed to 1.2x, the visible area shrinks.
      // We crop to (W/1.2 × H/1.2) centered on the click, then scale back up.
      const cropW = Math.round(OUT_W / 1.2)
      const cropH = Math.round(OUT_H / 1.2)
      const cropX = Math.round(Math.max(0, Math.min(tgtX - cropW / 2, OUT_W - cropW)))
      const cropY = Math.round(Math.max(0, Math.min(tgtY - cropH / 2, OUT_H - cropH)))

      // Smooth zoom: full frame → cropped → full frame
      // Using enable-based approach: when NOT in zoom window, pass through;
      // when in zoom window, crop and scale.
      zoomFilter =
        `split[z_main][z_crop];` +
        `[z_crop]crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${OUT_W}:${OUT_H}:flags=lanczos[z_zoomed];` +
        `[z_main][z_zoomed]overlay=0:0:enable='between(t,${zPeak},${zEnd})'[z_out]`
    }

    // ── Caption drawtext filters ──
    const drawtextFilters = script.segments
      .flatMap((seg) => {
        const wrappedLines = wrapText(seg.narration)
        const start = (seg.start_time + introOffset).toFixed(2)
        const end = (seg.end_time + introOffset).toFixed(2)

        return wrappedLines.map((line, i) => {
          const text = escapeForFilterScript(line)
          const yOffset = 50 + (wrappedLines.length - 1 - i) * 38
          return (
            `drawtext=text='${text}'` +
            `:enable='between(t,${start},${end})'` +
            `:fontsize=28:fontcolor=white` +
            `:x=(w-text_w)/2:y=h-th-${yOffset}` +
            `:box=1:boxcolor=black@0.65:boxborderw=12`
          )
        })
      })
      .filter(Boolean)

    // ── Compose the full video filter chain ──
    let videoFilterLines = ''

    if (zoomFilter && drawtextFilters.length > 0) {
      // Zoom + captions
      videoFilterLines = `[0:v]${zoomFilter};\n`
      let currentInput = '[z_out]'
      for (let i = 0; i < drawtextFilters.length; i++) {
        const isLast = i === drawtextFilters.length - 1
        const outLabel = isLast ? '[vout]' : `[v${i + 1}]`
        videoFilterLines += `${currentInput}${drawtextFilters[i]}${outLabel};\n`
        currentInput = outLabel
      }
    } else if (zoomFilter) {
      // Zoom only, no captions
      videoFilterLines = `[0:v]${zoomFilter.replace('[z_out]', '[vout]')};\n`
    } else if (drawtextFilters.length > 0) {
      // Captions only, no zoom
      let currentInput = '[0:v]'
      for (let i = 0; i < drawtextFilters.length; i++) {
        const isLast = i === drawtextFilters.length - 1
        const outLabel = isLast ? '[vout]' : `[v${i + 1}]`
        videoFilterLines += `${currentInput}${drawtextFilters[i]}${outLabel};\n`
        currentInput = outLabel
      }
    } else {
      // No effects — straight passthrough
      videoFilterLines = `[0:v]null[vout];\n`
    }

    // ── Audio: mix voiceover + ambient background tone ──
    const audioFilterLines = [
      '[1:a]volume=-2dB[voice];',
      '[2:a]volume=-24dB[music];',
      '[voice][music]amix=inputs=2:duration=first[aout]',
    ].join('\n')

    const filterScriptContent = [videoFilterLines, audioFilterLines].join('\n')
    fs.writeFileSync(filterScriptPath, filterScriptContent, 'utf-8')
    logger.info(`assembleVideo [${jobId}]: filter script (${filterScriptContent.length} chars):\n${filterScriptContent}`)

    // ═══════════════════════════════════════════════════════════════════════════
    // Step 6: Final render — all effects, audio, captions
    // ═══════════════════════════════════════════════════════════════════════════
    logger.info(`assembleVideo [${jobId}]: final render`)
    await runRawFfmpeg([
      '-i', concatPath,
      '-i', voiceoverPath,
      '-f', 'lavfi', '-i', 'sine=frequency=432:sample_rate=44100',
      '-filter_complex_script', filterScriptPath,
      '-map', '[vout]',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-crf', '18',
      '-preset', 'medium',
      '-r', '30',
      '-pix_fmt', 'yuv420p',
      '-t', String(options.videoLength + 10),
      '-y',
      finalPath,
    ])

    logger.info(`assembleVideo [${jobId}]: complete → ${finalPath}`)
    return finalPath
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}

/**
 * Source viewport dimensions (must match browserRecorder.ts VIDEO_WIDTH/VIDEO_HEIGHT)
 */
const VIDEO_W_SOURCE = 1920
const VIDEO_H_SOURCE = 1080
