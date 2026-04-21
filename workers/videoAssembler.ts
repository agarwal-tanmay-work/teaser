import fs from 'fs'
import http from 'http'
import path from 'path'
import os from 'os'
import type { AddressInfo } from 'net'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { logger } from '../lib/logger'
import type { RecordingManifest, SceneCapture } from '../types'

const RENDERED_DIR = path.join(os.tmpdir(), 'teaser-rendered')

/**
 * Lazy singleton for the Remotion bundle. `bundle()` takes 10–20 s the first
 * time (webpack build); subsequent jobs reuse the same serveUrl for ~1 s overhead.
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

export interface AssembleVideoOptions {
  /** Directory with manifest.json + recording.mp4 produced by the recorder. */
  recordingDir: string
  voiceoverPath: string
  jobId: string
  productUrl: string
  /** Optional absolute path to background music audio track. */
  musicPath?: string
}

interface AssetServer {
  baseUrl: string
  close: () => Promise<void>
}

/**
 * Spins up a tiny HTTP server on a random free localhost port that serves the
 * provided filesystem paths under simple relative keys. Remotion's renderer
 * refuses `file://` URLs, so per-job dynamic assets (the raw recording,
 * voiceover, music bed) must be fetchable over http(s). This server lives only
 * for the duration of one render and is closed in `finally`.
 *
 * Supports HTTP Range requests so Chromium can stream large video assets
 * (OffthreadVideo seeks with byte ranges).
 */
async function startAssetServer(
  fileMap: Record<string, string>
): Promise<AssetServer> {
  const contentTypeFor = (p: string): string => {
    const ext = path.extname(p).toLowerCase()
    if (ext === '.mp4') return 'video/mp4'
    if (ext === '.mp3') return 'audio/mpeg'
    if (ext === '.wav') return 'audio/wav'
    if (ext === '.webm') return 'video/webm'
    return 'application/octet-stream'
  }

  const server = http.createServer((req, res) => {
    const key = (req.url ?? '/').replace(/^\/+/, '').split('?')[0]
    const filePath = fileMap[key]
    if (!filePath || !fs.existsSync(filePath)) {
      res.statusCode = 404
      res.end('Not found')
      return
    }

    const stat = fs.statSync(filePath)
    const contentType = contentTypeFor(filePath)
    const range = req.headers.range

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      const start = match && match[1] ? parseInt(match[1], 10) : 0
      const end =
        match && match[2] ? parseInt(match[2], 10) : stat.size - 1
      const chunkSize = end - start + 1
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': contentType,
      })
      fs.createReadStream(filePath, { start, end }).pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Length': String(stat.size),
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      })
      fs.createReadStream(filePath).pipe(res)
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const addr = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${addr.port}`
  logger.info(`videoAssembler: asset server listening at ${baseUrl}`)

  return {
    baseUrl,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
      }),
  }
}

/**
 * Filters out noise scenes: failed element finds and sub-500 ms flashes that
 * would appear as single-frame strobes in the final video.
 */
function filterProductiveScenes(scenes: SceneCapture[]): SceneCapture[] {
  return scenes.filter((s) => {
    if (s.elementNotFound) return false
    if (!s.clips || s.clips.length === 0) return false
    const firstClip = s.clips[0]
    const duration = firstClip.end - firstClip.start
    return duration >= 500
  })
}

/**
 * Assembles the final video from a recorded .mp4 + manifest by rendering the
 * Remotion `TeaserVideo` master composition as a single artifact.
 *
 * Pipeline:
 * 1. Load manifest.json and filter noise clips
 * 2. Start a local HTTP asset server for the raw recording (+ voiceover /
 *    music, if present). Remotion's renderer refuses `file://` URLs — assets
 *    MUST be reachable over http(s).
 * 3. Render `TeaserVideo` composition — Remotion emits intro, demo with
 *    jump-cut clips, karaoke captions, progress bar, and outro in one pass.
 * 4. Close the asset server and return the output path.
 */
export async function assembleVideo(options: AssembleVideoOptions): Promise<string> {
  const { recordingDir, voiceoverPath, jobId, musicPath } = options
  fs.mkdirSync(RENDERED_DIR, { recursive: true })

  const finalPath = path.join(RENDERED_DIR, `${jobId}.mp4`)

  // 1. Manifest
  const manifestPath = path.join(recordingDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${recordingDir}`)
  }
  const manifest: RecordingManifest = JSON.parse(
    fs.readFileSync(manifestPath, 'utf-8')
  )
  logger.info(
    `assembleVideo [${jobId}]: manifest — ${manifest.totalScenes} scenes, product: ${manifest.productName}`
  )

  const productiveScenes = filterProductiveScenes(manifest.scenes)
  logger.info(
    `assembleVideo [${jobId}]: ${productiveScenes.length}/${manifest.scenes.length} productive scenes`
  )
  if (productiveScenes.length === 0) {
    throw new Error(
      'No productive scenes to render — the recording produced no usable clips'
    )
  }

  const srcVideo = path.join(recordingDir, 'recording.mp4')
  if (!fs.existsSync(srcVideo)) {
    throw new Error(`recording.mp4 not found in ${recordingDir}`)
  }

  // 2. Resolve optional audio assets
  const voiceoverExists =
    fs.existsSync(voiceoverPath) && fs.statSync(voiceoverPath).size > 0

  // Prefer an explicit musicPath; otherwise opportunistically use the
  // conventional asset at `public/audio/bg-music.mp3` if present so the
  // founder can drop in a track without any code change.
  const defaultMusicPath = path.join(process.cwd(), 'public', 'audio', 'bg-music.mp3')
  const resolvedMusicPath = musicPath
    ?? (fs.existsSync(defaultMusicPath) && fs.statSync(defaultMusicPath).size > 0
          ? defaultMusicPath
          : undefined)

  // 3. Boot asset HTTP server for this render
  const fileMap: Record<string, string> = { 'recording.mp4': srcVideo }
  if (voiceoverExists) fileMap['voiceover.mp3'] = voiceoverPath
  if (resolvedMusicPath) fileMap['music.mp3'] = resolvedMusicPath

  const assetServer = await startAssetServer(fileMap)

  try {
    const inputProps = {
      scenes: productiveScenes,
      recordedVideoUrl: `${assetServer.baseUrl}/recording.mp4`,
      voiceoverUrl: voiceoverExists
        ? `${assetServer.baseUrl}/voiceover.mp3`
        : undefined,
      musicUrl: resolvedMusicPath
        ? `${assetServer.baseUrl}/music.mp3`
        : undefined,
      productName: manifest.productName,
      tagline: manifest.tagline || 'See what it can do',
      productUrl: manifest.productUrl,
    }

    if (inputProps.musicUrl) {
      logger.info(`assembleVideo [${jobId}]: music bed → ${resolvedMusicPath}`)
    }

    // 4. Render master composition
    const serveUrl = await getRemotionServeUrl()
    const composition = await selectComposition({
      serveUrl,
      id: 'TeaserVideo',
      inputProps,
    })

    logger.info(
      `assembleVideo [${jobId}]: rendering master — ${composition.durationInFrames} frames @ ${composition.fps}fps`
    )

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: finalPath,
      inputProps,
      crf: 18,
      audioCodec: 'aac',
      audioBitrate: '192k',
    })

    logger.info(`assembleVideo [${jobId}]: complete → ${finalPath}`)
    return finalPath
  } finally {
    await assetServer.close()
    logger.info(`assembleVideo [${jobId}]: asset server closed`)
  }
}
