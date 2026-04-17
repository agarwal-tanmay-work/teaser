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
