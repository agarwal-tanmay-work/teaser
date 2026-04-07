import { Queue } from 'bullmq'
import type { VideoJobCreateInput } from '@/types'

/** Payload type for video jobs added to the queue */
export interface VideoJobQueueData extends VideoJobCreateInput {
  jobId: string
}

/** Lazily-initialised singleton queue instance. Avoids Redis connections at module load time. */
let _queue: Queue | null = null

/**
 * Builds ioredis connection options from Upstash REST credentials.
 * Uses explicit host/port/password/tls to avoid URL-parsing edge cases.
 */
function buildRedisConnection(): { host: string; port: number; password: string; tls: object } {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL ?? ''
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? ''
  const host = restUrl ? new URL(restUrl).hostname : '127.0.0.1'
  return { host, port: 6380, password: token, tls: {} }
}

/**
 * Returns the BullMQ queue singleton, creating it on first call.
 * Lazy initialisation prevents Redis connection attempts during Next.js build.
 */
function getQueue(): Queue {
  if (!_queue) {
    _queue = new Queue('video-generation', {
      connection: buildRedisConnection(),
    })
  }
  return _queue
}

/**
 * Adds a video generation job to the BullMQ queue.
 * @param data - The video job input data plus the Supabase job ID
 */
export async function addVideoJob(data: VideoJobQueueData) {
  return getQueue().add('generate-video', data, {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  })
}
