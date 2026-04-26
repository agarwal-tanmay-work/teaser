import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Standard utility for merging Tailwind CSS classes with clsx support.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Pauses execution for the specified number of milliseconds.
 * @param ms - Duration to sleep in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parses the retry-after delay from a Gemini 429 error message.
 * Returns delay in milliseconds, or null if not found.
 */
function parse429RetryDelayMs(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err)
  // Gemini 429 errors include "Please retry in X.XXXs"
  const match = msg.match(/retry in (\d+(?:\.\d+)?)s/i)
  if (match) {
    const seconds = parseFloat(match[1])
    return Math.ceil(seconds) * 1000 + 2000 // add 2s buffer
  }
  return null
}

/**
 * Retries an async function with exponential backoff.
 * Honors Gemini 429 retry-after hints if present.
 * Throws after all attempts are exhausted.
 *
 * @param fn - The async function to retry
 * @param attempts - Maximum number of attempts (default: 5)
 * @param shouldAbort - Optional callback: return true to stop retrying immediately (e.g. quota exhausted)
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  attempts: number = 5,
  shouldAbort?: (err: unknown) => boolean
): Promise<T> {
  const defaultDelays = [0, 5000, 15000, 30000, 65000]
  let lastError: unknown

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (i === attempts - 1) break

      // Allow callers to abort retries immediately (e.g. quota exhausted — no point retrying)
      if (shouldAbort?.(error)) break

      // Honor 429 retry-after if present, otherwise use exponential backoff
      const retryAfterMs = parse429RetryDelayMs(error)
      const backoffMs = retryAfterMs ?? (defaultDelays[i + 1] ?? 15000)
      await sleep(backoffMs)
    }
  }

  throw new Error(
    `Failed after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  )
}

/**
 * Cheap perceptual hash of a JPEG buffer. Samples evenly-spaced bytes from the
 * compressed stream — JPEG is dominated by DCT coefficients so similar frames
 * produce similar byte distributions. Not robust enough for content matching
 * but more than enough to detect "the same scroll position 3 batches in a row".
 */
export function perceptualHash(buf: Buffer): string {
  if (buf.length === 0) return '0'.repeat(16)
  const samples = 16
  const step = Math.max(1, Math.floor(buf.length / samples))
  let bits = ''
  for (let i = 0; i < samples; i++) {
    const idx = Math.min(buf.length - 1, i * step)
    bits += (buf[idx] >> 4).toString(16)
  }
  return bits
}

/**
 * Hamming-style similarity between two perceptual hashes — counts matching nibbles.
 * Returns a fraction 0–1, where 1 means identical.
 */
export function hashSimilarity(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 0
  let same = 0
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++
  return same / a.length
}

/**
 * Coarse brightness measurement of a JPEG buffer in 0..1. Approximates the
 * average pixel luminance from the compressed stream — the first ~256 bytes
 * after the SOI marker are JPEG headers (skipped); subsequent bytes correlate
 * loosely with frame energy. Used to detect "white loading screen" frames
 * (very high or very uniform). Cheap; not pixel-accurate.
 */
export function frameBrightness(buf: Buffer): number {
  if (buf.length < 512) return 0.5
  let sum = 0
  let count = 0
  for (let i = 256; i < Math.min(buf.length, 2048); i += 4) {
    sum += buf[i]
    count++
  }
  if (count === 0) return 0.5
  return sum / (count * 255)
}

/**
 * 32-bin viewport entropy histogram derived from byte samples in a JPEG buffer.
 * Coarse approximation: the compressed stream's mid-section reflects DCT
 * coefficients, which correlate (loosely) with luminance distribution. Two
 * frames whose histograms are similar by KL divergence are likely showing the
 * same content even if perceptual hashes drift. Confirms loop detection.
 *
 * Returns a normalised probability distribution (sums to 1).
 */
export function viewportEntropy(buf: Buffer): number[] {
  const bins = 32
  const hist = new Array<number>(bins).fill(0)
  if (buf.length < 1024) return hist.map(() => 1 / bins)
  const start = 512
  const end = Math.min(buf.length - 4, start + 8192)
  let total = 0
  for (let i = start; i < end; i += 4) {
    const v = buf[i]
    const idx = Math.min(bins - 1, (v >> 3))
    hist[idx]++
    total++
  }
  if (total === 0) return hist.map(() => 1 / bins)
  // Laplace-smooth so KL divergence is well-defined when a bin is empty.
  const eps = 1e-6
  return hist.map((c) => (c + eps) / (total + bins * eps))
}

/**
 * Symmetric-ish KL divergence between two distributions of equal length.
 * Used as a confirmation signal alongside perceptual-hash similarity for
 * loop detection: low KL + high phash similarity → frames are converging.
 *
 * Caller passes Laplace-smoothed distributions (see `viewportEntropy`) so
 * neither side has a true zero; we still guard with `Math.max(eps, …)`.
 */
export function klDivergence(p: number[], q: number[]): number {
  if (p.length !== q.length || p.length === 0) return Infinity
  const eps = 1e-9
  let sum = 0
  for (let i = 0; i < p.length; i++) {
    const pi = Math.max(eps, p[i])
    const qi = Math.max(eps, q[i])
    sum += pi * Math.log(pi / qi)
  }
  return sum
}

/**
 * Counts of result-bearing nodes + total visible text length on the current
 * page. Used as a cheap "did the page change after a commit?" signal.
 *
 * This helper is intended to be invoked inside `page.evaluate` — Playwright
 * serialises it across the boundary, so it must be self-contained (no
 * imports, no closure captures). Selector list focuses on common
 * search-result / chat-response / form-confirmation surfaces.
 */
export function domFingerprintScript(): { nodeCount: number; textLength: number } {
  const selectors = [
    '[role=row]',
    '[role=listitem]',
    'li',
    'article',
    '.result',
    '[data-result]',
    '[aria-live]',
    '[role=status]',
  ]
  let nodeCount = 0
  let textLength = 0
  for (const sel of selectors) {
    const nodes = document.querySelectorAll(sel)
    nodeCount += nodes.length
    nodes.forEach((n) => {
      const t = (n as HTMLElement).innerText
      if (t) textLength += t.length
    })
  }
  // SPAs often replace content inside ONE container without changing list-style
  // children counts (e.g. a chat response rendered into a single bubble div).
  // Pick up text length changes inside main / [role=main] / common SPA roots
  // so the outcome detector fires on those products too.
  const containers = [
    'main',
    '[role=main]',
    'section[data-testid]',
  ]
  for (const sel of containers) {
    const node = document.querySelector(sel)
    if (node) {
      const t = (node as HTMLElement).innerText
      if (t) textLength += t.length
    }
  }
  return { nodeCount, textLength }
}

/** A fingerprint sample comparable across before/after of a commit step. */
export interface DomFingerprint {
  url: string
  nodeCount: number
  textLength: number
}

/**
 * Returns true when two fingerprints differ enough that a viewer would notice.
 * Threshold chosen to ignore micro-DOM jitter (timestamps, focus rings) while
 * still firing on the typical "search results appeared" delta (≥3 nodes or
 * ≥120 chars of new visible text). The 120-char threshold catches SPA
 * single-container updates (chat replies, inline form confirmations) that
 * the prior 200-char threshold under-detected.
 */
export function fingerprintsDiffer(before: DomFingerprint, after: DomFingerprint): boolean {
  if (before.url !== after.url) return true
  const nodeDelta = Math.abs(after.nodeCount - before.nodeCount)
  const textDelta = Math.abs(after.textLength - before.textLength)
  return nodeDelta >= 3 || textDelta >= 120
}
