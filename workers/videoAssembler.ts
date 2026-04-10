import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import ffmpeg from 'fluent-ffmpeg'
import { logger } from '../lib/logger'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import type { VideoScript, ProductUnderstanding, VideoLength, ClickEvent, ScrollEvent } from '../types'

const RENDERED_DIR = path.join(os.tmpdir(), 'teaser-rendered')

import { getFfmpegPath, getFfprobePath, validateFfmpeg } from '../lib/ffmpegUtils'

// Ensure fluent-ffmpeg uses correct binaries on init
const ffmpegBin = getFfmpegPath()
if (ffmpegBin !== 'ffmpeg') ffmpeg.setFfmpegPath(ffmpegBin)
const ffprobeBin = getFfprobePath()
if (ffprobeBin !== 'ffprobe') ffmpeg.setFfprobePath(ffprobeBin)

/** Options for assembling a complete video from its component parts. */
export interface AssembleVideoOptions {
  recordingPath: string
  voiceoverPath: string
  script: VideoScript
  understanding: ProductUnderstanding
  videoLength: VideoLength
  jobId: string
}

/** Result of building the click audio chain for FFmpeg. */
interface ClickAudioChain {
  ffmpegInputArgs: string[]
  filterLines: string[]
  outputLabels: string[]
}

function buildClickAudioChain(clickEvents: ClickEvent[], introOffset: number): ClickAudioChain {
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
    return { ffmpegInputArgs: [], filterLines: [], outputLabels: [] }
  }

  const ffmpegInputArgs: string[] = []
  const filterLines: string[] = []
  const outputLabels: string[] = []

  for (let i = 0; i < validClicks.length; i++) {
    const tMs = Math.round((validClicks[i].timestamp + introOffset) * 1000)
    const label = `[click_${i}]`
    ffmpegInputArgs.push('-f', 'lavfi', '-i', 'sine=frequency=800:sample_rate=44100')
    filterLines.push(`[${i + 2}:a]atrim=0:0.025,afade=t=out:st=0.01:d=0.015,adelay=${tMs}|${tMs},volume=0.18${label}`)
    outputLabels.push(label)
  }

  return { ffmpegInputArgs, filterLines, outputLabels }
}

function loadScrollEvents(recordingPath: string): ScrollEvent[] {
  try {
    const eventsPath = path.join(path.dirname(recordingPath), 'scroll_events.json')
    if (fs.existsSync(eventsPath)) {
      const raw = fs.readFileSync(eventsPath, 'utf-8')
      return JSON.parse(raw) as ScrollEvent[]
    }
  } catch (err) {
    logger.warn('loadScrollEvents: failed', { error: err })
  }
  return []
}

function loadClickEvents(recordingPath: string): ClickEvent[] {
  try {
    const eventsPath = path.join(path.dirname(recordingPath), 'click_events.json')
    if (fs.existsSync(eventsPath)) {
      const raw = fs.readFileSync(eventsPath, 'utf-8')
      return JSON.parse(raw) as ClickEvent[]
    }
  } catch (err) {
    logger.warn('loadClickEvents: failed', { error: err })
  }
  return []
}

/**
 * Assembles the final launch video using Remotion
 */
export async function assembleVideo(options: AssembleVideoOptions): Promise<string> {
  const { recordingPath, voiceoverPath, understanding, jobId } = options

  const workDir = path.join(os.tmpdir(), 'teaser-assembly', jobId)
  fs.mkdirSync(workDir, { recursive: true })
  fs.mkdirSync(RENDERED_DIR, { recursive: true })

  const rawVideoPath = path.join(workDir, 'raw.mp4')
  const remotionOutputPath = path.join(workDir, 'remotion_out.mp4')
  const filterScriptPath = path.join(workDir, 'audio_filter.txt')
  const finalPath = path.join(RENDERED_DIR, `${jobId}.mp4`)

  try {
    // 1. Compile JPEG Sequence to MP4 for Remotion
    logger.info(`assembleVideo [${jobId}]: compiling images to raw video`)
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(path.join(recordingPath, 'frame_%05d.jpg'))
        .inputOptions(['-framerate 30'])
        .noAudio()
        .videoCodec('libx264')
        .outputOptions(['-crf 18', '-preset ultrafast', '-pix_fmt yuv420p'])
        .output(rawVideoPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })

    const clickEvents = loadClickEvents(recordingPath)
    const scrollEvents = loadScrollEvents(recordingPath)
    
    // 2. Bundle Remotion project
    logger.info(`assembleVideo [${jobId}]: bundling Remotion project...`)
    const bundleLocation = await bundle({
      entryPoint: path.resolve('remotion/Root.tsx'),
      webpackOverride: (config) => config,
    })

    // 3. Render
    const inputProps = {
      rawVideoUrl: `file:///${rawVideoPath.replace(/\\/g, '/')}`,
      voiceoverUrl: `file:///${voiceoverPath.replace(/\\/g, '/')}`,
      videoLength: options.videoLength,
      clickEvents,
      scrollEvents,
      script: options.script,
      productName: understanding.product_name,
      tagline: understanding.tagline
    }

    logger.info(`assembleVideo [${jobId}]: rendering composition...`)
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: 'TeaserVideo',
      inputProps,
    })

    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: remotionOutputPath,
      inputProps,
      onProgress: ({ progress }) => {
         if (Math.round(progress * 100) % 20 === 0) {
            logger.info(`Remotion [${jobId}]: ${Math.round(progress * 100)}% rendered`)
         }
      }
    })

    // 4. Mux Audio (Ambient + Click Sounds + Remotion's embedded track)
    logger.info(`assembleVideo [${jobId}]: Muxing audio via FFmpeg...`)
    
    const clickAudio = buildClickAudioChain(clickEvents, 3)
    
    if (clickAudio.outputLabels.length === 0) {
      // No click sounds to mix — just copy the Remotion output with ambient music
      await new Promise<void>((resolve, reject) => {
        const p = spawn(getFfmpegPath(), [
          '-i', remotionOutputPath,
          '-f', 'lavfi', '-i', 'aevalsrc=0.03*(sin(2*PI*t*261.6)+0.8*sin(2*PI*t*329.6)+0.7*sin(2*PI*t*392)+0.5*sin(2*PI*t*523.2))*(0.7+0.3*sin(2*PI*t*0.2)):s=44100',
          '-filter_complex', '[0:a]volume=1.0[voice];[1:a]volume=-24dB[music];[voice][music]amix=inputs=2:duration=first:weights=1 1[aout]',
          '-map', '0:v',
          '-map', '[aout]',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-y',
          finalPath
        ])
        let stderr = ''
        p.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        p.on('error', reject)
        p.on('close', (code) => {
          if (code === 0) resolve()
          else reject(new Error(`Audio muxing failed (code ${code}): ${stderr.slice(-500)}`))
        })
      })
    } else {
      // Full mix: voiceover + ambient + click sounds
      const clickFilterLines = clickAudio.filterLines.map((l) => l + ';').join('\n')
      const clickLabels = clickAudio.outputLabels.join('')
      const totalAudioInputs = 2 + clickAudio.outputLabels.length
      const amixWeights = ['1', '1', ...clickAudio.outputLabels.map(() => '0.18')].join(' ')

      const audioFilterLines = [
        '[0:a]volume=1.0[voice];',
        '[1:a]volume=-24dB[music];',
        clickFilterLines,
        `[voice][music]${clickLabels}amix=inputs=${totalAudioInputs}:duration=first:weights=${amixWeights}[aout]`
      ].filter(Boolean).join('\n')

      fs.writeFileSync(filterScriptPath, audioFilterLines, 'utf-8')

      await new Promise<void>((resolve, reject) => {
        const p = spawn(getFfmpegPath(), [
          '-i', remotionOutputPath,
          '-f', 'lavfi', '-i', 'aevalsrc=0.03*(sin(2*PI*t*261.6)+0.8*sin(2*PI*t*329.6)+0.7*sin(2*PI*t*392)+0.5*sin(2*PI*t*523.2))*(0.7+0.3*sin(2*PI*t*0.2)):s=44100',
          ...clickAudio.ffmpegInputArgs,
          '-filter_complex_script', filterScriptPath,
          '-map', '0:v',
          '-map', '[aout]',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-y',
          finalPath
        ])
        let stderr = ''
        p.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        p.on('error', reject)
        p.on('close', (code) => {
          if (code === 0) resolve()
          else reject(new Error(`Audio muxing failed (code ${code}): ${stderr.slice(-500)}`))
        })
      })
    }

    logger.info(`assembleVideo [${jobId}]: complete → ${finalPath}`)
    return finalPath

  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
    // Also clean up the Remotion webpack bundle cache (prevents disk leak)
    try {
      const bundleDir = path.join(os.tmpdir(), 'remotion-webpack-bundle')
      if (fs.existsSync(bundleDir)) {
        fs.rmSync(bundleDir, { recursive: true, force: true })
      }
    } catch {
      // Non-fatal
    }
  }
}
