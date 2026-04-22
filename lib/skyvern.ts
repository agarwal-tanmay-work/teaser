import fs from 'fs'
import path from 'path'
import { logger } from './logger'
import { retryWithBackoff } from './utils'
import type { ProductUnderstanding, SceneCapture, RecordingManifest, ElementBox } from '../types'

// ─── Configuration ────────────────────────────────────────────────────────────

const SKYVERN_BASE_URL = process.env.SKYVERN_BASE_URL ?? 'http://localhost:8000'
const SKYVERN_API_KEY = process.env.SKYVERN_API_KEY ?? ''

const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  ...(SKYVERN_API_KEY ? { 'x-api-key': SKYVERN_API_KEY } : {}),
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Skyvern task run response */
interface SkyvernRunResponse {
  run_id: string
  status: string
  output: unknown
  failure_reason: string | null
  created_at: string
  modified_at: string
}

/** Scene capture entry from our custom Skyvern hook */
interface SkyvernSceneCapture {
  action: string
  x: number | null
  y: number | null
  timestamp_ms: number
  page_url: string
  description: string
  step_order: number
}

/** Skyvern artifact metadata */
interface SkyvernArtifact {
  artifact_id: string
  artifact_type: string
  uri: string
}

// ─── API Client ───────────────────────────────────────────────────────────────

/**
 * Creates a Skyvern navigation task via the REST API.
 * The task tells Skyvern's vision AI to navigate a product URL
 * and interact with it to produce a demo recording.
 */
export async function createSkyvernTask(
  url: string,
  navigationGoal: string,
  maxSteps = 25,
): Promise<SkyvernRunResponse> {
  logger.info('skyvern: creating task', { url, maxSteps })

  const body = {
    url,
    prompt: navigationGoal,
    engine: 'skyvern-1.0',
    max_steps: maxSteps,
    include_extracted_text: false,
  }

  const response = await retryWithBackoff(async () => {
    const res = await fetch(`${SKYVERN_BASE_URL}/v1/run/tasks`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Skyvern API error ${res.status}: ${text}`)
    }
    return res.json() as Promise<SkyvernRunResponse>
  }, 3)

  logger.info('skyvern: task created', { run_id: response.run_id, status: response.status })
  return response
}

/**
 * Polls the Skyvern API until a task reaches a terminal state
 * (completed, failed, terminated) or the timeout is exceeded.
 */
export async function waitForTaskCompletion(
  runId: string,
  timeoutMs = 15 * 60 * 1000,
  pollIntervalMs = 3000,
): Promise<SkyvernRunResponse> {
  const deadline = Date.now() + timeoutMs
  logger.info('skyvern: waiting for task completion', { run_id: runId, timeoutMs })

  while (Date.now() < deadline) {
    const res = await fetch(`${SKYVERN_BASE_URL}/v1/runs/${runId}`, {
      headers: HEADERS,
    })
    if (!res.ok) {
      logger.warn('skyvern: poll failed', { status: res.status })
      await sleep(pollIntervalMs)
      continue
    }

    const data = await res.json() as SkyvernRunResponse
    const status = data.status?.toLowerCase() ?? ''

    if (status === 'completed' || status === 'finished') {
      logger.info('skyvern: task completed', { run_id: runId })
      return data
    }
    if (status === 'failed' || status === 'terminated' || status === 'timed_out') {
      throw new Error(`Skyvern task ${runId} failed: ${data.failure_reason ?? status}`)
    }

    // Still running
    logger.info('skyvern: task still running', { run_id: runId, status })
    await sleep(pollIntervalMs)
  }

  throw new Error(`Skyvern task ${runId} timed out after ${timeoutMs / 1000}s`)
}

/**
 * Lists artifacts for a completed task and downloads the video recording.
 * Searches for the video artifact and streams it to the output path.
 */
export async function downloadTaskVideo(
  runId: string,
  outputPath: string,
): Promise<void> {
  logger.info('skyvern: downloading video', { run_id: runId, outputPath })

  // Try to find video in the artifacts list
  const artifactsRes = await fetch(
    `${SKYVERN_BASE_URL}/v1/runs/${runId}/timeline`,
    { headers: HEADERS },
  )

  if (!artifactsRes.ok) {
    // Fallback: try direct video path from Skyvern's video directory
    logger.warn('skyvern: timeline API failed, trying direct artifact download')
  }

  // Attempt to download video from Skyvern's artifact storage
  // Skyvern stores videos in its configured VIDEO_PATH
  const videoRes = await fetch(
    `${SKYVERN_BASE_URL}/v1/artifacts/${runId}/video`,
    { headers: HEADERS },
  )

  if (videoRes.ok && videoRes.body) {
    const buffer = Buffer.from(await videoRes.arrayBuffer())
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, buffer)
    logger.info('skyvern: video downloaded', {
      size_mb: Math.round(buffer.length / 1024 / 1024),
    })
    return
  }

  // If the standard artifact API doesn't work, check local volume mount
  const localVideoDir = path.join(process.cwd(), 'skyvern-data', 'videos')
  if (fs.existsSync(localVideoDir)) {
    const videoFiles = findVideoFiles(localVideoDir)
    if (videoFiles.length > 0) {
      // Use the most recently modified video
      const sorted = videoFiles.sort((a, b) => {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs
      })
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.copyFileSync(sorted[0], outputPath)
      logger.info('skyvern: video copied from local volume', { source: sorted[0] })
      return
    }
  }

  throw new Error(`Failed to download video for task ${runId}`)
}

/**
 * Retrieves SceneCapture data from our custom Skyvern hook endpoint.
 */
export async function getSceneCaptures(): Promise<SkyvernSceneCapture[]> {
  try {
    const res = await fetch(`${SKYVERN_BASE_URL}/v1/teaser/scene-captures`, {
      headers: HEADERS,
    })
    if (!res.ok) {
      logger.warn('skyvern: scene captures endpoint failed', { status: res.status })
      return []
    }
    const data = await res.json() as { captures: SkyvernSceneCapture[] }
    logger.info('skyvern: got scene captures', { count: data.captures.length })
    return data.captures
  } catch (err) {
    logger.warn('skyvern: failed to get scene captures', { err })
    return []
  }
}

/**
 * Resets the scene capture accumulator in Skyvern.
 * Call before starting a new task.
 */
export async function resetSceneCaptures(): Promise<void> {
  try {
    await fetch(`${SKYVERN_BASE_URL}/v1/teaser/scene-captures/reset`, {
      method: 'POST',
      headers: HEADERS,
    })
  } catch {
    // Non-critical — captures will still work
  }
}

// ─── Navigation Goal Builder ──────────────────────────────────────────────────

/**
 * Builds a natural-language navigation goal string from the ProductUnderstanding.
 * Skyvern's vision AI will use this to decide what to click, where to navigate,
 * and when to stop.
 */
export function buildNavigationGoal(
  understanding: ProductUnderstanding,
  startUrl?: string,
): string {
  const pages = understanding.key_pages_to_visit.slice(0, 4).join(', ')
  const features = understanding.top_5_features.slice(0, 3).join('; ')

  return [
    `Record a product demo for "${understanding.product_name}": ${understanding.core_value_prop}`,
    '',
    'INSTRUCTIONS:',
    `1. Start at ${startUrl ?? 'the homepage'}, wait for full load.`,
    `2. Visit these pages: ${pages}`,
    `3. Interact with key features: ${features}`,
    '4. Click buttons, hover elements, scroll to show content. Spend 3-5s per page.',
    '5. Visit at least 3 pages/sections. Move mouse smoothly (being recorded).',
    '',
    'STOP after visiting 3+ pages and 5+ interactions, or 15 actions max.',
    'AVOID: Login/signup, external links, downloads.',
  ].join('\n')
}

// ─── Manifest Conversion ─────────────────────────────────────────────────────

/**
 * Converts Skyvern scene captures into the RecordingManifest format
 * expected by videoAssembler.ts / Remotion.
 */
export function buildManifestFromCaptures(
  captures: SkyvernSceneCapture[],
  understanding: ProductUnderstanding,
  productUrl: string,
): RecordingManifest {
  const scenes: SceneCapture[] = captures.map((c, i) => {
    const targetElement: ElementBox | null =
      c.x !== null && c.y !== null
        ? { x: c.x, y: c.y, width: 100, height: 40 }
        : null

    return {
      step: i + 1,
      action: c.action === 'click' ? 'click' : 'navigate',
      description: c.description || `Step ${i + 1}`,
      narration: c.description || `Exploring ${understanding.product_name}`,
      clips: [{ start: c.timestamp_ms, end: c.timestamp_ms + 3000 }],
      targetElement,
      typeText: null,
      elementNotFound: false,
      pageUrl: c.page_url,
    }
  })

  return {
    productUrl,
    productName: understanding.product_name,
    tagline: understanding.tagline,
    totalScenes: scenes.length,
    scenes,
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Recursively find .mp4 and .webm files in a directory. */
function findVideoFiles(dir: string): string[] {
  const results: string[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...findVideoFiles(fullPath))
      } else if (/\.(mp4|webm)$/i.test(entry.name)) {
        results.push(fullPath)
      }
    }
  } catch {
    // Directory might not exist yet
  }
  return results
}
