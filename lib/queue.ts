import { Queue } from 'bullmq'
import type { VideoJobCreateInput } from '@/types'

/** Payload type for video jobs added to the queue */
export interface VideoJobQueueData extends VideoJobCreateInput {
  jobId: string
}

/** Lazily-initialised singleton queue instance. Avoids Redis connections at module load time. */
let _queue: Queue | null = null

/**
 * Returns the BullMQ queue singleton, creating it on first call.
 * Lazy initialisation prevents Redis connection attempts during Next.js build.
 */
function getQueue(): Queue {
  if (!_queue) {
    _queue = new Queue('video-generation', {
      connection: { url: process.env.UPSTASH_REDIS_REST_URL ?? '' },
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
