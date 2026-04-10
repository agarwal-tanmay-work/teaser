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
function buildRedisConnection(): { host: string; port: number; password: string; tls: object; family: number } {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL ?? ''
  
  // Upstash REST token is sometimes the base64-encoded DB properties, but if not we still attempt it
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? ''
  const host = restUrl ? new URL(restUrl).hostname : '127.0.0.1'

  // Upstash often requires explicit IPv4 and servername for direct TCP connections
  return { host, port: 6379, password: token, tls: { servername: host }, family: 4 }
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
