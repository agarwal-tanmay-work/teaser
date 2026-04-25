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
