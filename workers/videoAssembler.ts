import fs from 'fs'
import path from 'path'
import os from 'os'
import { pathToFileURL } from 'url'
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

/**
 * Converts an absolute filesystem path to a `file://` URL Chromium will accept.
 * Remotion's renderer fetches Audio/OffthreadVideo sources through Chromium, so
 * every asset must resolve via URL rather than a raw path.
 */
function toFileUrl(absPath: string): string {
  return pathToFileURL(absPath).href
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
 * 2. Wire the raw recording (+ voiceover / music, if present) as `file://` URLs
 * 3. Render `TeaserVideo` composition — Remotion emits intro, demo with jump-cut
 *    clips, karaoke captions, progress bar, and outro in one pass
 * 4. Return the output path
 *
 * Any FFmpeg drawtext fallback has been deliberately removed; if Remotion fails
 * we surface the error rather than ship a video with 2004-era bitmap captions.
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

  // 2. Input props
  const voiceoverUrl =
    fs.existsSync(voiceoverPath) && fs.statSync(voiceoverPath).size > 0
      ? toFileUrl(voiceoverPath)
      : undefined

  // Prefer an explicit musicPath; otherwise opportunistically use the
  // conventional asset at `public/audio/bg-music.mp3` if present so the
  // founder can drop in a track without any code change.
  const defaultMusicPath = path.join(process.cwd(), 'public', 'audio', 'bg-music.mp3')
  const resolvedMusicPath = musicPath
    ?? (fs.existsSync(defaultMusicPath) && fs.statSync(defaultMusicPath).size > 0
          ? defaultMusicPath
          : undefined)
  const musicUrl = resolvedMusicPath ? toFileUrl(resolvedMusicPath) : undefined
  if (musicUrl) {
    logger.info(`assembleVideo [${jobId}]: music bed → ${resolvedMusicPath}`)
  }

  const inputProps = {
    scenes: productiveScenes,
    recordedVideoUrl: toFileUrl(srcVideo),
    voiceoverUrl,
    musicUrl,
    productName: manifest.productName,
    tagline: manifest.tagline || 'See what it can do',
    productUrl: manifest.productUrl,
  }

  // 3. Render master composition
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
}
