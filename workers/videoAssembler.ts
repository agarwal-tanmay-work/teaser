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
const PAD_X = Math.round((OUT_W - BROWSER_W) / 2)   // 120
const PAD_Y = Math.round((OUT_H - BROWSER_H) / 2)   // 68

/** Source viewport dimensions (must match browserRecorder VIDEO_WIDTH/HEIGHT) */
const VIDEO_W_SOURCE = 1920
const VIDEO_H_SOURCE = 1080

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
function wrapText(text: string, maxChars: number = 60): string[] {
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

  const vf = [
    // Rich indigo-to-purple gradient (richer than simple linear)
    `geq=r='clip(38+X*60/${OUT_W}\\,0\\,255)':g='clip(28+X*28/${OUT_W}\\,0\\,255)':b='clip(135+X*105/${OUT_W}\\,0\\,255)'`,
    // Product name — large, centered, fade-in
    `drawtext=text='${escapedName}'` +
    `:fontsize=74:fontcolor=white` +
    `:x=(w-text_w)/2:y=(h-text_h)/2-44` +
    `:alpha='if(lt(t\\,0.5)\\,t*2\\,1)'`,
    // Tagline — smaller, below the name, staggered fade-in
    `drawtext=text='${escapedTagline}'` +
    `:fontsize=32:fontcolor=0xdddddd` +
    `:x=(w-text_w)/2:y=(h/2)+44` +
    `:alpha='if(lt(t\\,1)\\,0\\,if(lt(t\\,1.6)\\,(t-1)*1.67\\,1))'`,
  ].join(',')

  await runRawFfmpeg([
    '-f', 'lavfi', '-i', `color=c=black:size=${OUT_W}x${OUT_H}:duration=${duration}:rate=30`,
    '-vf', vf,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-crf', '18',
    '-y',
    outputPath,
  ])
}

/**
 * Creates a premium branded outro clip with dark gradient and CTA.
 */
async function createOutro(
  outputPath: string,
  duration: number = 3
): Promise<void> {
  const vf = [
    // Dark gradient background — deep navy
    `geq=r='clip(8+X*6/${OUT_W}\\,0\\,255)':g='clip(6+X*4/${OUT_W}\\,0\\,255)':b='clip(18+X*12/${OUT_W}\\,0\\,255)'`,
    // Main CTA text — fade-in
    `drawtext=text='useteaser.com'` +
    `:fontsize=58:fontcolor=0xaaaacc` +
    `:x=(w-text_w)/2:y=(h-text_h)/2` +
    `:alpha='if(lt(t\\,0.5)\\,t*2\\,1)'`,
    // Subtitle
    `drawtext=text='Create your product video in seconds'` +
    `:fontsize=26:fontcolor=0x666688` +
    `:x=(w-text_w)/2:y=(h/2)+52` +
    `:alpha='if(lt(t\\,1)\\,0\\,if(lt(t\\,1.6)\\,(t-1)*1.67\\,1))'`,
    // Fade out at the end
    `fade=t=out:st=${duration - 0.8}:d=0.8`,
  ].join(',')

  await runRawFfmpeg([
    '-f', 'lavfi', '-i', `color=c=black:size=${OUT_W}x${OUT_H}:duration=${duration}:rate=30`,
    '-vf', vf,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-crf', '18',
    '-y',
    outputPath,
  ])
}

/**
 * Creates the framed composition: browser recording centered on a premium dark gradient
 * background, with a soft drop shadow beneath the browser window.
 *
 * Pipeline:
 * 1. Generate a single-frame gradient background PNG
 * 2. Overlay the browser recording with a blurred shadow copy beneath it
 */
async function createFramedRecording(
  inputPath: string,
  outputPath: string,
  workDir: string
): Promise<void> {
  const bgPath = path.join(workDir, 'gradient_bg.png')

  // Step A: generate gradient background frame (deep navy-to-indigo)
  await runRawFfmpeg([
    '-f', 'lavfi',
    '-i', `color=c=0x080614:s=${OUT_W}x${OUT_H}:d=1:r=1`,
    '-vf', `geq=r='clip(8+X*22/${OUT_W}+Y*12/${OUT_H}\\,0\\,255)':g='clip(6+X*8/${OUT_W}\\,0\\,255)':b='clip(20+X*55/${OUT_W}+Y*32/${OUT_H}\\,0\\,255)'`,
    '-frames:v', '1',
    '-y',
    bgPath,
  ])

  // Step B: compose browser on gradient with drop shadow
  // Shadow = blurred copy of browser window, overlaid at a slight offset behind
  const shadowOffsetX = PAD_X + 20   // 140
  const shadowOffsetY = PAD_Y + 24   // 92

  const filterGraph = [
    // Loop the gradient background PNG to match video duration
    `[1:v]loop=loop=-1:size=1:start=0,setpts=N/30/TB,scale=${OUT_W}:${OUT_H}[bg]`,
    // Scale browser recording to its framed size
    `[0:v]scale=${BROWSER_W}:${BROWSER_H}:flags=lanczos[browser]`,
    // Create shadow: blur the browser and reduce opacity
    `[browser]split[b1][b2]`,
    `[b2]boxblur=luma_radius=32:luma_power=3,colorchannelmixer=aa=0.52[shadow]`,
    // Compose: gradient → shadow (offset) → browser
    `[bg][shadow]overlay=${shadowOffsetX}:${shadowOffsetY}[bg_shadow]`,
    `[bg_shadow][b1]overlay=${PAD_X}:${PAD_Y}:shortest=1[framed]`,
  ].join(';')

  const filterPath = path.join(workDir, 'framing.txt')
  fs.writeFileSync(filterPath, filterGraph, 'utf-8')

  await runRawFfmpeg([
    '-i', inputPath,
    '-i', bgPath,
    '-filter_complex_script', filterPath,
    '-map', '[framed]',
    '-c:v', 'libx264',
    '-crf', '16',
    '-preset', 'veryfast',
    '-r', '30',
    '-pix_fmt', 'yuv420p',
    '-y',
    outputPath,
  ])
}

/**
 * Builds a chained FFmpeg filter graph that applies smooth zoom-in effects
 * for every tracked click event. Zooms are deduplicated (min 3s spacing) and
 * capped at 6 total to keep the filter graph manageable.
 *
 * Each zoom: crop to 1.3× zoom area centered on click, scale back to full
 * resolution, overlay on the main video during the zoom window.
 *
 * @returns FFmpeg filter_complex lines (without trailing newline), or empty string if no zooms
 */
function buildZoomFilterChain(
  clickEvents: ClickEvent[],
  introOffset: number,
  inputLabel: string,
  outputLabel: string
): string {
  // Only zoom on actual clicks (not hovers or type events)
  const clickOnly = clickEvents.filter((e) => e.action === 'click')

  // Deduplicate: skip clicks within 3s of the previous zoom's end
  const validClicks: ClickEvent[] = []
  let lastZoomEnd = -999
  for (const ev of clickOnly) {
    const t = ev.timestamp + introOffset
    if (t > lastZoomEnd + 0.5) {
      validClicks.push(ev)
      lastZoomEnd = t + 2.8
    }
    if (validClicks.length >= 6) break
  }

  if (validClicks.length === 0) return ''

  const zoomFactor = 1.3
  const cropW = Math.round(OUT_W / zoomFactor)   // ≈1477
  const cropH = Math.round(OUT_H / zoomFactor)   // ≈831

  const lines: string[] = []
  let currentInput = inputLabel

  for (let i = 0; i < validClicks.length; i++) {
    const ev = validClicks[i]
    const t = ev.timestamp + introOffset
    const zPeak = (t + 0.4).toFixed(2)
    const zEnd  = (t + 2.8).toFixed(2)

    // Map click coordinates from browser viewport → composited 1920×1080 frame
    const normX = ev.x / VIDEO_W_SOURCE
    const normY = ev.y / VIDEO_H_SOURCE
    const tgtX  = Math.round(PAD_X + normX * BROWSER_W)
    const tgtY  = Math.round(PAD_Y + normY * BROWSER_H)

    // Center crop on click, clamped to frame bounds
    const cropX = Math.max(0, Math.min(Math.round(tgtX - cropW / 2), OUT_W - cropW))
    const cropY = Math.max(0, Math.min(Math.round(tgtY - cropH / 2), OUT_H - cropH))

    const mainLabel   = `[zm${i}_main]`
    const cropLabel   = `[zm${i}_crop]`
    const zoomedLabel = `[zm${i}_zoomed]`
    const isLast      = i === validClicks.length - 1
    const outLabel    = isLast ? outputLabel : `[zm${i}_out]`

    lines.push(`${currentInput}split${mainLabel}${cropLabel}`)
    lines.push(
      `${cropLabel}crop=${cropW}:${cropH}:${cropX}:${cropY},` +
      `scale=${OUT_W}:${OUT_H}:flags=lanczos${zoomedLabel}`
    )
    lines.push(
      `${mainLabel}${zoomedLabel}overlay=0:0:enable='between(t,${zPeak},${zEnd})'${outLabel}`
    )

    currentInput = outLabel
  }

  return lines.join(';\n')
}

/**
 * Assembles the final launch video with premium post-processing.
 *
 * Pipeline:
 * 1. Convert .webm → .mp4 (strip audio, normalize)
 * 2. Frame recording inside premium gradient background with drop shadow
 * 3. Render branded intro/outro clips
 * 4. Concatenate intro + framed recording + outro
 * 5. Apply auto-zoom on ALL click coordinates (up to 6, deduplicated)
 * 6. Overlay timed captions with pill-style semi-transparent background
 * 7. Mix voiceover + ambient music
 * 8. Final render at CRF 16 / slow preset for maximum quality
 */
export async function assembleVideo(options: AssembleVideoOptions): Promise<string> {
  const { recordingPath, voiceoverPath, script, understanding, jobId } = options

  const workDir = path.join(os.tmpdir(), 'teaser-assembly', jobId)
  fs.mkdirSync(workDir, { recursive: true })
  fs.mkdirSync(RENDERED_DIR, { recursive: true })

  const convertedPath    = path.join(workDir, 'recording.mp4')
  const framedPath       = path.join(workDir, 'framed.mp4')
  const introPath        = path.join(workDir, 'intro.mp4')
  const outroPath        = path.join(workDir, 'outro.mp4')
  const concatListPath   = path.join(workDir, 'concat.txt')
  const concatPath       = path.join(workDir, 'concat.mp4')
  const filterScriptPath = path.join(workDir, 'filter.txt')
  const finalPath        = path.join(RENDERED_DIR, `${jobId}.mp4`)

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
        .outputOptions(['-crf 16', '-preset veryfast', '-r 30', '-pix_fmt yuv420p'])
        .output(convertedPath)
    )

    // ═══════════════════════════════════════════════════════════════════════════
    // Step 2: Frame recording inside premium gradient background with shadow
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
        .outputOptions(['-pix_fmt yuv420p', '-preset veryfast', '-crf 16'])
        .output(concatPath)
    )

    // ═══════════════════════════════════════════════════════════════════════════
    // Step 5: Build final filter graph (multi-click zoom + captions + audio)
    // ═══════════════════════════════════════════════════════════════════════════
    logger.info(`assembleVideo [${jobId}]: building final filter graph`)

    const introOffset = 3 // Intro duration in seconds

    // ── Multi-click zoom chain ──
    // buildZoomFilterChain returns lines already containing [0:v] as the first input,
    // so we must NOT prepend [0:v] again when building videoFilterLines.
    const zoomChainOutput = '[zoom_out]'
    const zoomChain = buildZoomFilterChain(clickEvents, introOffset, '[0:v]', zoomChainOutput)
    const hasZoom = zoomChain.length > 0

    // ── Caption drawtext filters ──
    const drawtextFilters = script.segments
      .flatMap((seg) => {
        const wrappedLines = wrapText(seg.narration)
        const start = (seg.start_time + introOffset).toFixed(2)
        const end   = (seg.end_time + introOffset).toFixed(2)

        return wrappedLines.map((line, i) => {
          const text    = escapeForFilterScript(line)
          const yOffset = 54 + (wrappedLines.length - 1 - i) * 40
          return (
            `drawtext=text='${text}'` +
            `:enable='between(t,${start},${end})'` +
            `:fontsize=30:fontcolor=white` +
            `:x=(w-text_w)/2:y=h-th-${yOffset}` +
            `:box=1:boxcolor=black@0.72:boxborderw=14`
          )
        })
      })
      .filter(Boolean)

    // ── Compose the full video filter chain ──
    let videoFilterLines = ''

    if (hasZoom && drawtextFilters.length > 0) {
      // Zoom chain already embeds [0:v] as its first input label
      videoFilterLines = zoomChain + ';\n'
      let currentInput = zoomChainOutput
      for (let i = 0; i < drawtextFilters.length; i++) {
        const isLast   = i === drawtextFilters.length - 1
        const outLabel = isLast ? '[vout]' : `[v${i + 1}]`
        videoFilterLines += `${currentInput}${drawtextFilters[i]}${outLabel};\n`
        currentInput = outLabel
      }
    } else if (hasZoom) {
      // Zoom only — output directly to [vout]
      const chain = buildZoomFilterChain(clickEvents, introOffset, '[0:v]', '[vout]')
      videoFilterLines = chain + ';\n'
    } else if (drawtextFilters.length > 0) {
      let currentInput = '[0:v]'
      for (let i = 0; i < drawtextFilters.length; i++) {
        const isLast   = i === drawtextFilters.length - 1
        const outLabel = isLast ? '[vout]' : `[v${i + 1}]`
        videoFilterLines += `${currentInput}${drawtextFilters[i]}${outLabel};\n`
        currentInput = outLabel
      }
    } else {
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
    // Step 6: Final render — CRF 16, slow preset, bitrate floor for 1080p HD
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
      // CRF 16 + slow preset = maximum quality at efficient bitrate
      '-crf', '16',
      '-preset', 'slow',
      // Bitrate floor so fast scenes don't drop below broadcast quality
      '-b:v', '8000k',
      '-maxrate', '12000k',
      '-bufsize', '24000k',
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
