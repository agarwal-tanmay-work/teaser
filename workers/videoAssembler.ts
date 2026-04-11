import fs from 'fs'
import path from 'path'
import os from 'os'
import http from 'http'
import { spawn } from 'child_process'
import { logger } from '../lib/logger'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import type { RecordingManifest } from '../types'
import { getFfmpegPath } from '../lib/ffmpegUtils'

const RENDERED_DIR = path.join(os.tmpdir(), 'teaser-rendered')

export interface AssembleVideoOptions {
  /** Path to the recording output directory (contains manifest.json + scenes/) */
  recordingDir: string
  voiceoverPath: string
  jobId: string
  productUrl: string
}

/**
 * Creates a temporary HTTP server to serve screenshots and audio to Remotion.
 * Serves all files from the given directory tree.
 */
function createAssetServer(assetsDir: string) {
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.json': 'application/json',
  }

  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url || '')
    const filePath = path.join(assetsDir, urlPath)

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase()
      const contentType = mimeTypes[ext] || 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': contentType })
      fs.createReadStream(filePath).pipe(res)
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  return server
}

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer()
    s.listen(0, () => {
      const port = (s.address() as any).port
      s.close(() => resolve(port))
    })
  })
}

/**
 * Assembles the final video from screenshot-based scenes.
 *
 * Pipeline:
 * 1. Read manifest.json from the recording directory
 * 2. Copy screenshots + voiceover into a work directory
 * 3. Start a local asset server so Remotion can access the files
 * 4. Bundle & render the Remotion composition with scene data
 * 5. Add ambient background music via FFmpeg
 * 6. Output the final MP4
 */
export async function assembleVideo(options: AssembleVideoOptions): Promise<string> {
  const { recordingDir, voiceoverPath, jobId, productUrl } = options
  const workDir = path.join(os.tmpdir(), 'teaser-assembly', jobId)
  fs.mkdirSync(workDir, { recursive: true })
  fs.mkdirSync(RENDERED_DIR, { recursive: true })

  // Create a scenes subdirectory in workDir
  const workScenesDir = path.join(workDir, 'scenes')
  fs.mkdirSync(workScenesDir, { recursive: true })

  const remotionOutputPath = path.join(workDir, 'remotion_out.mp4')
  const finalPath = path.join(RENDERED_DIR, `${jobId}.mp4`)

  try {
    // 1. Read manifest
    const manifestPath = path.join(recordingDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`manifest.json not found in ${recordingDir}`)
    }
    const manifest: RecordingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    logger.info(`assembleVideo [${jobId}]: loaded manifest with ${manifest.totalScenes} scenes`)

    // 2. Copy recorded video to work directory
    const srcVideo = path.join(recordingDir, 'recording.webm')
    if (fs.existsSync(srcVideo)) {
      fs.copyFileSync(srcVideo, path.join(workDir, 'recording.webm'))
    }

    // Copy voiceover
    const voiceoverInWorkDir = path.join(workDir, 'voiceover.mp3')
    if (fs.existsSync(voiceoverPath)) {
      fs.copyFileSync(voiceoverPath, voiceoverInWorkDir)
    }

    // 3. Start asset server
    const port = await findAvailablePort()
    const server = createAssetServer(workDir)
    server.listen(port)
    const baseUrl = `http://localhost:${port}`
    logger.info(`assembleVideo [${jobId}]: asset server on ${baseUrl}`)

    // 4. Skip URL mapping, passing raw timestamps
    const scenesWithUrls = manifest.scenes

    // 5. Bundle & Render
    logger.info(`assembleVideo [${jobId}]: bundling and rendering...`)
    const bundleLocation = await bundle({
      entryPoint: path.resolve('remotion/Root.tsx'),
      webpackOverride: (config) => config,
    })

    const inputProps = {
      scenes: scenesWithUrls,
      recordedVideoUrl: fs.existsSync(path.join(workDir, 'recording.webm')) ? `${baseUrl}/recording.webm` : undefined,
      voiceoverUrl: fs.existsSync(voiceoverInWorkDir) ? `${baseUrl}/voiceover.mp3` : undefined,
      productName: manifest.productName,
      tagline: manifest.tagline,
      productUrl: manifest.productUrl,
    }

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
      concurrency: os.cpus().length,
      onProgress: ({ progress }) => {
        const percent = Math.round(progress * 100);
        if (percent % 10 === 0) {
          logger.info(`Remotion [${jobId}]: ${percent}% rendered`);
        }
      }
    })

    server.close()

    // 6. Add ambient background music
    logger.info(`assembleVideo [${jobId}]: adding ambient music...`)
    await new Promise<void>((resolve, reject) => {
      const p = spawn(getFfmpegPath(), [
        '-i', remotionOutputPath,
        '-f', 'lavfi', '-i', 'aevalsrc=0.03*(sin(2*PI*t*261.6)+0.8*sin(2*PI*t*329.6)+0.7*sin(2*PI*t*392)+0.5*sin(2*PI*t*523.2))*(0.7+0.3*sin(2*PI*t*0.2)):s=44100',
        '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first:weights=1 1[aout]',
        '-map', '0:v',
        '-map', '[aout]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-y',
        finalPath
      ])
      let stderr = ''
      p.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
      p.on('close', (code) => {
        if (code === 0) resolve()
        else {
          // If audio mux fails (e.g., no audio stream in remotion output), just copy the video
          logger.warn(`assembleVideo [${jobId}]: audio mux failed, using video without music`)
          fs.copyFileSync(remotionOutputPath, finalPath)
          resolve()
        }
      })
      p.on('error', (err) => {
        logger.warn(`assembleVideo [${jobId}]: ffmpeg spawn error, copying video directly`)
        fs.copyFileSync(remotionOutputPath, finalPath)
        resolve()
      })
    })

    logger.info(`assembleVideo [${jobId}]: complete → ${finalPath}`)
    return finalPath

  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}
