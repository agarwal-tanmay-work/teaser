import fs from 'fs'
import path from 'path'
import { logger } from './logger'
import { retryWithBackoff } from './utils'
import { ffprobeDurationMs } from './ffmpegUtils'
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
  let lastKnownStatus = 'unknown'
  let lastKnownFailureReason = ''
  let lastKnownOutput = ''

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
    lastKnownStatus = status || 'unknown'
    lastKnownFailureReason = data.failure_reason ?? ''
    lastKnownOutput = serializeUnknown(data.output, 1200)

    if (status === 'completed' || status === 'finished') {
      logger.info('skyvern: task completed', { run_id: runId })
      return data
    }
    if (status === 'failed' || status === 'terminated' || status === 'timed_out') {
      const reason = data.failure_reason ?? status
      // "Reached the maximum steps" means Skyvern navigated and recorded
      // successfully but ran out of step budget. The recording artifact
      // exists and is usable — treat this as a successful completion.
      if (reason.toLowerCase().includes('reached the maximum steps')) {
        logger.info('skyvern: task reached max steps — treating as successful completion', { run_id: runId, steps_reason: reason })
        return data
      }
      const details = formatSkyvernFailureDetails(runId, reason, data.output)
      throw new Error(`Skyvern task ${runId} failed: ${details}`)
    }

    // Still running
    logger.info('skyvern: task still running', { run_id: runId, status })
    await sleep(pollIntervalMs)
  }

  const timeoutDetails = [
    `timed out after ${timeoutMs / 1000}s`,
    `last_status=${lastKnownStatus}`,
    lastKnownFailureReason ? `last_failure_reason=${lastKnownFailureReason}` : '',
    lastKnownOutput ? `last_output=${lastKnownOutput}` : '',
  ].filter(Boolean).join(' | ')
  throw new Error(`Skyvern task ${runId} ${timeoutDetails}`)
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
  targetVideoLengthSeconds = 150,
): string {
  // Only include page URLs if they look like real discovered URLs (not hallucinated)
  const pages = understanding.key_pages_to_visit
    .filter((u) => u.startsWith('http'))
    .slice(0, 4)
    .join(', ')

  return [
    `Browse and explore the website at ${startUrl ?? 'the homepage'} for a professional ${targetVideoLengthSeconds}-second product launch demo.`,
    '',
    'INSTRUCTIONS:',
    `1. Start at ${startUrl ?? 'the homepage'}, wait for full page load.`,
    pages
      ? `2. Visit these pages if reachable from visible navigation: ${pages}`
      : '2. Visit 3-6 distinct pages or page sections that are reachable from visible navigation links.',
    '3. Demonstrate whatever features and content are actually visible on each page. Do NOT assume or look for specific features — just interact with what you see.',
    '4. Ground every action in what is visibly on screen. Click buttons, links, and interactive elements you can see.',
    '5. Scroll to reveal content below the fold. Spend 15-25 seconds per meaningful page or section.',
    '6. Move the mouse smoothly, hover before clicking, and pause long enough for viewers to understand each screen.',
    '7. Keep exploring until you have enough real footage for the requested duration. Do not finish after only a few interactions.',
    '',
    `COMPLETE only after roughly ${targetVideoLengthSeconds} seconds of meaningful browsing, or after the step budget is exhausted.`,
    'AVOID: Login/signup pages, external links, downloads, authentication flows.',
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
  recordingDurationMs?: number,
): RecordingManifest {
  const scenes: SceneCapture[] = captures.map((c, i) => {
    const targetElement: ElementBox | null =
      c.x !== null && c.y !== null
        ? { x: c.x, y: c.y, width: 100, height: 40 }
        : null

    const nextCapture = captures[i + 1]
    const fallbackEnd = c.timestamp_ms + 5000
    const end = Math.min(
      recordingDurationMs ?? fallbackEnd,
      Math.max(c.timestamp_ms + 2500, nextCapture?.timestamp_ms ?? fallbackEnd),
    )

    return {
      step: i + 1,
      action: c.action === 'click' ? 'click' : 'navigate',
      description: c.description || `Step ${i + 1}`,
      narration: c.description || `Exploring ${understanding.product_name}`,
      clips: [{ start: c.timestamp_ms, end }],
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

function syntheticNarration(understanding: ProductUnderstanding, index: number): string {
  const planned = understanding.demo_flow[index]?.narration
  if (planned) return planned

  const features = understanding.top_5_features.length > 0
    ? understanding.top_5_features
    : ['the core workflow']
  const feature = features[index % features.length]
  const fallbackLines = [
    `${understanding.product_name} keeps ${feature} easy to inspect.`,
    `The demo now moves through real screens with context.`,
    `${feature} becomes clearer as the page opens up.`,
    `Teams can judge the workflow without guessing.`,
    `${understanding.product_name} shows the next step in sequence.`,
    `Each section adds a concrete product detail.`,
    `${feature} gets screen time instead of a static loop.`,
    `The browsing path stays paced for a launch demo.`,
    `${understanding.product_name} keeps the product story moving.`,
    `Viewers can follow the interface from screen to screen.`,
  ]
  return fallbackLines[index % fallbackLines.length]
}

/**
 * Generates a synthetic manifest directly from a video file when
 * scene captures metadata is unavailable. Keeps the entire recording as
 * consecutive clips so a long Skyvern capture does not collapse to a short
 * five-scene teaser.
 */
export async function buildSyntheticManifest(
  videoPath: string,
  understanding: ProductUnderstanding,
  productUrl: string,
): Promise<RecordingManifest> {
  const durationMs = (await ffprobeDurationMs(videoPath)) || 30000 // fallback to 30s

  const sceneDurationMs = 5000
  const sceneCount = Math.max(1, Math.ceil(durationMs / sceneDurationMs))

  const scenes: SceneCapture[] = Array.from({ length: sceneCount }).map((_, i) => {
    const start = i * sceneDurationMs
    const end = Math.min(durationMs, start + sceneDurationMs)

    return {
      step: i + 1,
      action: 'navigate',
      description: understanding.demo_flow[i]?.description ?? `Exploring product section ${i + 1}`,
      narration: syntheticNarration(understanding, i),
      clips: [{ start, end }],
      targetElement: null,
      typeText: null,
      elementNotFound: false,
      pageUrl: productUrl,
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

/**
 * Produces concise failure details for Skyvern terminal task states.
 */
function formatSkyvernFailureDetails(runId: string, failureReason: string, output: unknown): string {
  const normalizedReason = failureReason.trim() || 'unknown failure'
  const category = classifySkyvernFailure(normalizedReason)
  const outputSnippet = serializeUnknown(output, 900)
  return [
    `category=${category}`,
    `reason=${normalizedReason}`,
    outputSnippet ? `output=${outputSnippet}` : '',
    `run_id=${runId}`,
  ].filter(Boolean).join(' | ')
}

/**
 * Buckets Skyvern errors to guide retries and operator debugging.
 */
function classifySkyvernFailure(reason: string): string {
  const lower = reason.toLowerCase()
  if (lower.includes('model') && lower.includes('decommission')) return 'model_decommissioned'
  if (lower.includes('reached the maximum steps')) return 'max_steps_exceeded'
  if (lower.includes('max retries per step') || lower.includes('context window') || lower.includes('oversized')) return 'step_generation_overload'
  if (lower.includes('rate limit') || lower.includes('429')) return 'rate_limited'
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout'
  if (lower.includes('browser') || lower.includes('playwright')) return 'browser_runtime'
  return 'unknown'
}

/**
 * Safe JSON serialization for logging and error context.
 */
function serializeUnknown(value: unknown, maxLen: number): string {
  if (value === undefined || value === null) return ''
  try {
    const raw = typeof value === 'string' ? value : JSON.stringify(value)
    return raw.length > maxLen ? `${raw.slice(0, maxLen)}...` : raw
  } catch {
    return String(value)
  }
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
