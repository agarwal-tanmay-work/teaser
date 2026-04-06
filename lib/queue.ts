import { Queue } from 'bullmq'
import type { VideoJobCreateInput } from '@/types'

/** Connection config for Upstash Redis via BullMQ */
const connection = {
  url: process.env.UPSTASH_REDIS_REST_URL ?? '',
}

/**
 * The BullMQ queue for video generation jobs.
 * Backed by Upstash Redis via the UPSTASH_REDIS_REST_URL environment variable.
 */
export const videoQueue = new Queue('video-generation', { connection })

/** Payload type for video jobs added to the queue */
export interface VideoJobQueueData extends VideoJobCreateInput {
  jobId: string
}

/**
 * Adds a video generation job to the BullMQ queue.
 * @param data - The video job input data plus the Supabase job ID
 */
export async function addVideoJob(data: VideoJobQueueData) {
  return videoQueue.add('generate-video', data, {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  })
}
