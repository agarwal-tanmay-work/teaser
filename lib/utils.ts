/**
 * Pauses execution for the specified number of milliseconds.
 * @param ms - Duration to sleep in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retries an async function with exponential backoff.
 * Attempt 1: immediate. Attempt 2: after 1000ms. Attempt 3: after 2000ms.
 * Throws after all attempts are exhausted.
 * @param fn - The async function to retry
 * @param attempts - Maximum number of attempts (default: 3)
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  attempts: number = 3
): Promise<T> {
  const delays = [0, 1000, 2000]

  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      await sleep(delays[i] ?? 2000)
    }
    try {
      return await fn()
    } catch (error) {
      if (i === attempts - 1) {
        throw new Error(
          `Failed after ${attempts} attempts: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  // This is unreachable but satisfies TypeScript
  throw new Error('Unexpected end of retryWithBackoff')
}
