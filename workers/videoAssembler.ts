import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import ffmpeg from 'fluent-ffmpeg'
import { logger } from '../lib/logger'
import type { VideoScript, ProductUnderstanding, VideoLength, ClickEvent, ScrollEvent } from '../types'

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
 * Loads scroll-depth events from the sidecar JSON file created by browserRecorder.
 */
function loadScrollEvents(recordingPath: string): ScrollEvent[] {
  try {
    const eventsPath = path.join(path.dirname(recordingPath), 'scroll_events.json')
    if (fs.existsSync(eventsPath)) {
      const raw = fs.readFileSync(eventsPath, 'utf-8')
      return JSON.parse(raw) as ScrollEvent[]
    }
  } catch (err) {
    logger.warn('loadScrollEvents: failed to load scroll events', { error: err })
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
 * background, with a soft drop shadow beneath the browser window and a macOS-style
 * browser chrome bar (traffic lights + address bar) overlaid at the top.
 *
 * Pipeline:
 * 1. Generate a single-frame gradient background PNG
 * 2. Overlay the browser recording with a blurred shadow copy beneath it
 * 3. Composite the macOS browser chrome (traffic lights + URL bar) on top
 */
async function createFramedRecording(
  inputPath: string,
  outputPath: string,
  workDir: string,
  productUrl: string
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
  // Shadow = blurred copy of browser window, made semi-transparent via yuva420p,
  // overlaid at a slight offset behind the browser.
  const shadowOffsetX = PAD_X + 20   // 140
  const shadowOffsetY = PAD_Y + 24   // 92

  // Build macOS browser chrome overlay filters
  const chromeBarY = PAD_Y
  const urlDisplay = escapeForFilterScript(productUrl.replace(/^https?:\/\//, '').slice(0, 72))

  const chromeFilters = [
    // Title bar background
    `[framed]drawbox=x=${PAD_X}:y=${chromeBarY}:w=${BROWSER_W}:h=36:color=0x1c1c1c@1:t=fill[chrome_bar]`,
    // Traffic lights — red, yellow, green
    `[chrome_bar]drawbox=x=${PAD_X + 14}:y=${chromeBarY + 12}:w=12:h=12:color=0xFF5F57@1:t=fill[chrome_r]`,
    `[chrome_r]drawbox=x=${PAD_X + 34}:y=${chromeBarY + 12}:w=12:h=12:color=0xFEBC2E@1:t=fill[chrome_y]`,
    `[chrome_y]drawbox=x=${PAD_X + 54}:y=${chromeBarY + 12}:w=12:h=12:color=0x28C840@1:t=fill[chrome_g]`,
    // Address bar background pill
    `[chrome_g]drawbox=x=${PAD_X + 78}:y=${chromeBarY + 6}:w=${BROWSER_W - 100}:h=24:color=0x2e2e2e@0.95:t=fill[chrome_addr]`,
    // URL text
    `[chrome_addr]drawtext=text='${urlDisplay}':fontsize=13:fontcolor=0x888888:x=${PAD_X + 92}:y=${chromeBarY + 11}[chrome_out]`,
  ].join(';')

  const filterGraph = [
    // Loop the gradient background PNG to match video duration
    `[1:v]loop=loop=-1:size=1:start=0,setpts=N/30/TB,scale=${OUT_W}:${OUT_H}[bg]`,
    // Scale browser recording to its framed size
    `[0:v]scale=${BROWSER_W}:${BROWSER_H}:flags=lanczos[browser]`,
    // Create shadow: split → blur → convert to YUVA so alpha works → set 50% opacity
    `[browser]split[b1][b2]`,
    `[b2]boxblur=luma_radius=28:luma_power=3,format=yuva420p,colorchannelmixer=aa=0.50[shadow]`,
    // Compose: gradient → shadow (offset) → browser → chrome
    `[bg][shadow]overlay=${shadowOffsetX}:${shadowOffsetY}[bg_shadow]`,
    `[bg_shadow][b1]overlay=${PAD_X}:${PAD_Y}:shortest=1[framed]`,
    chromeFilters,
  ].join(';')

  const filterPath = path.join(workDir, 'framing.txt')
  fs.writeFileSync(filterPath, filterGraph, 'utf-8')

  await runRawFfmpeg([
    '-i', inputPath,
    '-i', bgPath,
    '-filter_complex_script', filterPath,
    '-map', '[chrome_out]',
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
 * Applies smooth animated zoom to the framed recording using FFmpeg's zoompan filter.
 * Zoom ramps in/out at 0.05 units per frame (≈0.2s at 30fps) to reach 1.3× magnification,
 * centered on each click coordinate. Click events are deduplicated with a 3s gap, capped at 6.
 *
 * If there are no click events, the input file is copied unchanged.
 */
async function applyZoompan(
  inputPath: string,
  outputPath: string,
  clickEvents: ClickEvent[]
): Promise<void> {
  const clickOnly = clickEvents.filter((e) => e.action === 'click')

  const validClicks: ClickEvent[] = []
  let lastEnd = -999
  for (const ev of clickOnly) {
    if (ev.timestamp > lastEnd + 0.5) {
      validClicks.push(ev)
      lastEnd = ev.timestamp + 2.8
    }
    if (validClicks.length >= 6) break
  }

  if (validClicks.length === 0) {
    fs.copyFileSync(inputPath, outputPath)
    return
  }

  const ramp = 0.05  // zoom increment per frame; 0.3 / 0.05 = 6 frames ≈ 0.2s at 30fps

  // z: ramp up inside each click window, ramp down outside all windows
  let zExpr = `max(zoom-${ramp},1.0)`
  for (const ev of [...validClicks].reverse()) {
    const tIn  = ev.timestamp.toFixed(2)
    const tOut = (ev.timestamp + 2.8).toFixed(2)
    zExpr = `if(between(t,${tIn},${tOut}),min(zoom+${ramp},1.3),${zExpr})`
  }

  // x/y: center crop on click point during + 0.3s after window (for smooth zoom-out pan)
  let xExpr = `iw/2-iw/zoom/2`
  let yExpr = `ih/2-ih/zoom/2`
  for (const ev of [...validClicks].reverse()) {
    const tIn  = ev.timestamp.toFixed(2)
    const tOut = (ev.timestamp + 3.1).toFixed(2)  // 0.3s extra for zoom-out pan
    const tgtX = Math.round(PAD_X + (ev.x / VIDEO_W_SOURCE) * BROWSER_W)
    const tgtY = Math.round(PAD_Y + (ev.y / VIDEO_H_SOURCE) * BROWSER_H)
    xExpr = `if(between(t,${tIn},${tOut}),clip(${tgtX}-iw/zoom/2,0,iw-iw/zoom),${xExpr})`
    yExpr = `if(between(t,${tIn},${tOut}),clip(${tgtY}-ih/zoom/2,0,ih-ih/zoom),${yExpr})`
  }

  const zoompanVf = `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':s=${OUT_W}x${OUT_H}:fps=30`

  await runRawFfmpeg([
    '-i', inputPath,
    '-vf', zoompanVf,
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-y',
    outputPath,
  ])
}

/** Result of building the click audio chain for FFmpeg. */
interface ClickAudioChain {
  /** Extra `-f lavfi -i sine=...` argument pairs to prepend to the final render command */
  ffmpegInputArgs: string[]
  /** filter_complex lines for trimming, fading, and delaying each click sound */
  filterLines: string[]
  /** Labels like [click_0], [click_1], ... for use in the amix expression */
  outputLabels: string[]
}

/**
 * Builds the FFmpeg inputs and filter lines to mix a short synthetic click
 * sound at each click-event timestamp. The click sound is a 25ms sine burst
 * at 800 Hz — no external file required.
 *
 * @param clickEvents  Full list of tracked events (only 'click' actions used)
 * @param introOffset  Seconds the intro adds before the recording starts
 * @returns            Inputs, filter lines, and labels ready for final amix
 */
function buildClickAudioChain(
  clickEvents: ClickEvent[],
  introOffset: number
): ClickAudioChain {
  const clickOnly = clickEvents.filter((e) => e.action === 'click')

  // Same dedup logic as zoom: skip clicks within 3s of the previous one, max 6
  const validClicks: ClickEvent[] = []
  let lastEnd = -999
  for (const ev of clickOnly) {
    if (ev.timestamp > lastEnd + 0.5) {
      validClicks.push(ev)
      lastEnd = ev.timestamp + 2.8
    }
    if (validClicks.length >= 6) break
  }

  if (validClicks.length === 0) {
    return { ffmpegInputArgs: [], filterLines: [], outputLabels: [] }
  }

  const ffmpegInputArgs: string[] = []
  const filterLines: string[] = []
  const outputLabels: string[] = []

  for (let i = 0; i < validClicks.length; i++) {
    const tMs = Math.round((validClicks[i].timestamp + introOffset) * 1000)
    const label = `[click_${i}]`

    // One lavfi sine source per click (FFmpeg requires separate inputs for adelay)
    ffmpegInputArgs.push('-f', 'lavfi', '-i', 'sine=frequency=800:sample_rate=44100')

    // Trim to 25ms, fade out the last 15ms, delay to timestamp, normalise volume
    filterLines.push(
      `[${i + 3}:a]atrim=0:0.025,afade=t=out:st=0.01:d=0.015,` +
      `adelay=${tMs}|${tMs},volume=0.18${label}`
    )

    outputLabels.push(label)
  }

  return { ffmpegInputArgs, filterLines, outputLabels }
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
  const framedZoomedPath = path.join(workDir, 'framed_zoomed.mp4')
  const introPath        = path.join(workDir, 'intro.mp4')
  const outroPath        = path.join(workDir, 'outro.mp4')
  const concatListPath   = path.join(workDir, 'concat.txt')
  const concatPath       = path.join(workDir, 'concat.mp4')
  const filterScriptPath = path.join(workDir, 'filter.txt')
  const finalPath        = path.join(RENDERED_DIR, `${jobId}.mp4`)

  const clickEvents  = loadClickEvents(recordingPath)
  const scrollEvents = loadScrollEvents(recordingPath)
  logger.info(`assembleVideo [${jobId}]: loaded ${clickEvents.length} click / ${scrollEvents.length} scroll events`)

  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // Step 1: Convert .webm → .mp4, strip audio, keep native resolution
    // ═══════════════════════════════════════════════════════════════════════════
    logger.info(`assembleVideo [${jobId}]: converting recording to mp4`)
    await runFfmpeg(
      ffmpeg(recordingPath)
        .noAudio()
        .videoCodec('libx264')
        // Boost saturation and contrast; sharpen slightly.
        // NOTE: Do NOT add -colorspace/-color_primaries/-color_trc tags here.
        // Playwright records in sRGB full-range; tagging the output as BT.709
        // causes players to apply the wrong colour matrix, producing washed-out output.
        .videoFilter(['eq=contrast=1.15:brightness=-0.02:saturation=1.35', 'unsharp=5:5:0.8:3:3:0.4'])
        .outputOptions([
          '-crf 18', '-preset slow', '-profile:v high', '-r 30', '-pix_fmt yuv420p',
        ])
        .output(convertedPath)
    )

    // ═══════════════════════════════════════════════════════════════════════════
    // Step 2: Frame recording inside premium gradient background with shadow
    //         + macOS browser chrome overlay
    // ═══════════════════════════════════════════════════════════════════════════
    logger.info(`assembleVideo [${jobId}]: creating framed composition`)
    await createFramedRecording(convertedPath, framedPath, workDir, options.understanding.key_pages_to_visit[0] ?? 'product demo')

    // ═══════════════════════════════════════════════════════════════════════════
    // Step 2.5: Apply smooth animated zoom (zoompan) to the framed recording
    // ═══════════════════════════════════════════════════════════════════════════
    logger.info(`assembleVideo [${jobId}]: applying smooth zoom`)
    await applyZoompan(framedPath, framedZoomedPath, clickEvents)

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
      `file '${framedZoomedPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`,
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
    // Step 5: Build final filter graph
    //   Chain: nav blur → scroll bar → spotlight rings → lower-thirds → captions
    //   Audio: voiceover + ambient chord + per-click sounds
    // ═══════════════════════════════════════════════════════════════════════════
    logger.info(`assembleVideo [${jobId}]: building final filter graph`)

    const introOffset = 3 // intro duration in seconds

    // Deduplicated click-only events (shared by spotlight + audio chain)
    const clickOnly: ClickEvent[] = []
    let lastClickEnd = -999
    for (const ev of clickEvents.filter(e => e.action === 'click')) {
      if (ev.timestamp > lastClickEnd + 0.5) {
        clickOnly.push(ev)
        lastClickEnd = ev.timestamp + 2.8
      }
      if (clickOnly.length >= 6) break
    }

    // ── Video filter chain (sequential) ──
    let videoFilterLines = ''
    let curr = '[0:v]'

    // 1. Navigation blur — brief 0.4s boxblur at each page-change
    const navEvents = clickEvents.filter(e => e.action === 'navigate')
    if (navEvents.length > 0) {
      const enableParts = navEvents
        .map(e => {
          const t = e.timestamp + introOffset
          return `between(t,${(t - 0.2).toFixed(2)},${(t + 0.2).toFixed(2)})`
        })
        .join('+')
      videoFilterLines += `${curr}boxblur=luma_radius=5:luma_power=2:enable='gt(${enableParts},0)'[nav_b];\n`
      curr = '[nav_b]'
    }

    // 2. Scroll progress bar — thin white bar on right edge of browser frame
    if (scrollEvents.length > 0) {
      const barX = PAD_X + BROWSER_W - 14
      const barY = PAD_Y + 4
      const maxH = BROWSER_H - 8

      let hExpr = `${Math.round(scrollEvents[scrollEvents.length - 1].scrollPercent * maxH)}`
      for (let i = scrollEvents.length - 2; i >= 0; i--) {
        const s0 = scrollEvents[i]
        const s1 = scrollEvents[i + 1]
        const t0 = (s0.timestamp + introOffset).toFixed(2)
        const t1 = (s1.timestamp + introOffset).toFixed(2)
        const h0 = Math.round(s0.scrollPercent * maxH)
        const h1 = Math.round(s1.scrollPercent * maxH)
        const dt = (s1.timestamp - s0.timestamp).toFixed(3)
        hExpr = `if(between(t,${t0},${t1}),${h0}+(${h1 - h0})*(t-${t0})/${dt},${hExpr})`
      }
      const firstT = (scrollEvents[0].timestamp + introOffset).toFixed(2)
      hExpr = `if(lt(t,${firstT}),0,${hExpr})`

      videoFilterLines += `${curr}drawbox=x=${barX}:y=${barY}:w=5:h='${hExpr}':color=white@0.55:t=fill[scroll_b];\n`
      curr = '[scroll_b]'
    }

    // 3. Spotlight ring — indigo border around each click target for 1.5s
    if (clickOnly.length > 0) {
      const ringW = 120
      const ringH = 72
      let xExpr = `${-(ringW + 50)}`
      let yExpr = `${-(ringH + 50)}`
      for (const ev of [...clickOnly].reverse()) {
        const t    = (ev.timestamp + introOffset).toFixed(2)
        const tEnd = (ev.timestamp + introOffset + 1.5).toFixed(2)
        const cx = Math.max(PAD_X, Math.min(
          Math.round(PAD_X + (ev.x / VIDEO_W_SOURCE) * BROWSER_W) - ringW / 2,
          PAD_X + BROWSER_W - ringW
        ))
        const cy = Math.max(PAD_Y + 40, Math.min(
          Math.round(PAD_Y + (ev.y / VIDEO_H_SOURCE) * BROWSER_H) - ringH / 2,
          PAD_Y + BROWSER_H - ringH
        ))
        xExpr = `if(between(t,${t},${tEnd}),${cx},${xExpr})`
        yExpr = `if(between(t,${t},${tEnd}),${cy},${yExpr})`
      }
      videoFilterLines += `${curr}drawbox=x='${xExpr}':y='${yExpr}':w=${ringW}:h=${ringH}:color=0x6366F1@0.75:t=3[spot_b];\n`
      curr = '[spot_b]'
    }

    // 4. Lower-third section labels — slide in from left, every other segment, max 8
    const lowerThirds = script.segments
      .filter((_, i) => i % 2 === 0)
      .slice(0, 8)
      .map((seg) => {
        const label = seg.what_to_show.slice(0, 38).trim()
        if (!label) return null
        const escaped = escapeForFilterScript(label)
        const tStart  = (seg.start_time + introOffset).toFixed(2)
        const tEnd    = (seg.start_time + introOffset + 2.5).toFixed(2)
        const destX   = PAD_X + 24
        return (
          `drawtext=text='${escaped}':fontsize=17:fontcolor=white:` +
          `x='if(lt(t-${tStart},0.3),${destX}-120+120*(t-${tStart})/0.3,${destX})':` +
          `y=${PAD_Y + BROWSER_H - 64}:` +
          `box=1:boxcolor=black@0.72:boxborderw=10:` +
          `alpha='if(lt(t-${tStart},0.2),(t-${tStart})/0.2,if(gt(t-${tStart},2.3),max(0,1-(t-${tStart}-2.3)/0.2),1))':` +
          `enable='between(t,${tStart},${tEnd})'`
        )
      })
      .filter((f): f is string => f !== null)

    for (let i = 0; i < lowerThirds.length; i++) {
      const outLabel = `[lt${i}]`
      videoFilterLines += `${curr}${lowerThirds[i]}${outLabel};\n`
      curr = outLabel
    }

    // 5. Captions — 0.15s fade-in per segment line (Feature 9: typewriter feel)
    const drawtextFilters = script.segments
      .flatMap((seg) => {
        const wrappedLines = wrapText(seg.narration)
        const start = (seg.start_time + introOffset).toFixed(2)
        const end   = (seg.end_time + introOffset).toFixed(2)
        return wrappedLines.map((line, i) => {
          const text = escapeForFilterScript(line)
          const yPos = wrappedLines.length > 1 ? `h*0.85+${i * 34}` : `h*0.85`
          return (
            `drawtext=text='${text}':fontsize=28:fontcolor=white:` +
            `borderw=2:bordercolor=black:box=0:` +
            `x=(w-text_w)/2:y=${yPos}:` +
            `alpha='min(1,max(0,(t-${start})*8))':` +
            `enable='between(t,${start},${end})'`
          )
        })
      })
      .filter(Boolean)

    for (let i = 0; i < drawtextFilters.length; i++) {
      const isLast   = i === drawtextFilters.length - 1
      const outLabel = isLast ? '[vout]' : `[cap${i}]`
      videoFilterLines += `${curr}${drawtextFilters[i]}${outLabel};\n`
      curr = outLabel
    }

    // Ensure chain terminates at [vout]
    if (curr !== '[vout]') {
      videoFilterLines += `${curr}null[vout];\n`
    }

    // ── Audio: mix voiceover + ambient tone + per-click sound effects ──
    const clickAudio = buildClickAudioChain(clickEvents, introOffset)
    const clickFilterLines = clickAudio.filterLines.map((l) => l + ';').join('\n')
    const clickLabels = clickAudio.outputLabels.join('')
    const totalAudioInputs = 2 + clickAudio.outputLabels.length
    const amixWeights = ['1', '1', ...clickAudio.outputLabels.map(() => '0.18')].join(' ')

    const audioFilterLines = [
      '[1:a]volume=-2dB[voice];',
      '[2:a]volume=-24dB[music];',
      clickFilterLines,
      `[voice][music]${clickLabels}amix=inputs=${totalAudioInputs}:duration=first:weights=${amixWeights}[aout]`,
    ].filter(Boolean).join('\n')

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
      // C-major ambient chord with slow tremolo — sounds like lo-fi background music
      '-f', 'lavfi', '-i', 'aevalsrc=0.03*(sin(2*PI*t*261.6)+0.8*sin(2*PI*t*329.6)+0.7*sin(2*PI*t*392)+0.5*sin(2*PI*t*523.2))*(0.7+0.3*sin(2*PI*t*0.2)):s=44100',
      ...clickAudio.ffmpegInputArgs,
      '-filter_complex_script', filterScriptPath,
      '-map', '[vout]',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-crf', '18',
      '-preset', 'slow',
      '-profile:v', 'high',
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
