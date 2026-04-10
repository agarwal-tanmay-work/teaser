'use client'

import { useQuery } from '@tanstack/react-query'
import VideoCard from '@/components/dashboard/VideoCard'
import type { ApiResponse, VideoJob } from '@/types'

/** Fetches all video jobs for the current user from the API. */
async function fetchVideoHistory(): Promise<VideoJob[]> {
  const res = await fetch('/api/videos/list')
  const json = (await res.json()) as ApiResponse<VideoJob[]>
  if (!json.success) throw new Error(json.error)
  return json.data
}

interface VideoHistoryProps {
  /** Job ID of the currently active job — excluded from history to avoid duplication. */
  activeJobId: string | null
}

/** Displays the user's past and completed video generation jobs. */
export default function VideoHistory({ activeJobId }: VideoHistoryProps) {
  const { data: jobs, isLoading, isError } = useQuery({
    queryKey: ['video-history'],
    queryFn: fetchVideoHistory,
    refetchInterval: 15_000,
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse bg-[#111111] border border-[#1F1F1F] rounded-lg" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <p className="text-[#EF4444] text-sm">Failed to load your videos. Please refresh.</p>
    )
  }

  const visibleJobs = (jobs ?? []).filter(
    (job) => job.id !== activeJobId && job.status === 'completed'
  )

  if (visibleJobs.length === 0) {
    return (
      <p className="text-[#6E6E6E] text-sm">
        No videos yet. Paste a product URL above to generate your first one.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {visibleJobs.map((job) => (
        <VideoCard key={job.id} job={job} />
      ))}
    </div>
  )
}
