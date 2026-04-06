'use client'

import { useQuery } from '@tanstack/react-query'
import type { ApiResponse, VideoJob } from '@/types'

interface ProgressTrackerProps {
  jobId: string
  onReset: () => void
}

const STAGES = [
  'Understanding',
  'Recording',
  'Script',
  'Voiceover',
  'Editing',
  'Complete',
]

/** Returns the stage index (0-5) based on progress percentage. */
function progressToStage(progress: number): number {
  if (progress >= 100) return 5
  if (progress >= 90) return 4
  if (progress >= 70) return 3
  if (progress >= 55) return 2
  if (progress >= 35) return 1
  return 0
}

/** Fetches the current status of a video job from the API. */
async function fetchJobStatus(jobId: string): Promise<VideoJob> {
  const res = await fetch(`/api/videos/status/${jobId}`)
  const data = (await res.json()) as ApiResponse<VideoJob>
  if (!data.success) throw new Error(data.error)
  return data.data
}

/**
 * Polls the video job status every 3 seconds and renders a circular progress ring,
 * stage indicators, and completed/failed states.
 */
export default function ProgressTracker({ jobId, onReset }: ProgressTrackerProps) {
  const { data: job } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => fetchJobStatus(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'completed' || status === 'failed') return false
      return 3000
    },
  })

  const progress = job?.progress ?? 0
  const status = job?.status ?? 'pending'
  const message = job?.progress_message ?? 'Initialising...'
  const currentStage = progressToStage(progress)

  // SVG circle dimensions
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (progress / 100) * circumference

  if (status === 'completed' && job?.final_video_url) {
    return (
      <div className="bg-[#111111] border border-[#1F1F1F] rounded-lg p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-[#22C55E]/10 border border-[#22C55E]/30 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-white text-2xl font-semibold mb-2">Your video is ready!</p>
        <video
          src={job.final_video_url}
          controls
          className="w-full max-w-2xl mx-auto rounded-lg mt-4 border border-[#1F1F1F]"
        />
        <div className="flex flex-wrap justify-center gap-3 mt-4">
          <a
            href={job.final_video_url}
            download
            className="px-4 py-2 bg-white text-black font-semibold text-sm rounded-md hover:bg-gray-100 transition-colors"
          >
            Download 16:9
          </a>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(job.final_video_url ?? '')
            }}
            className="px-4 py-2 border border-[#1F1F1F] text-white text-sm rounded-md hover:bg-[#1F1F1F] transition-colors"
          >
            Copy link →
          </button>
        </div>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="bg-[#111111] border border-[#1F1F1F] rounded-lg p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-[#EF4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <p className="text-white text-xl font-semibold mb-2">Something went wrong.</p>
        {job?.error_message && (
          <p className="text-[#6E6E6E] text-sm mb-4">{job.error_message}</p>
        )}
        <button
          onClick={onReset}
          className="px-6 py-2 bg-white text-black font-semibold text-sm rounded-md hover:bg-gray-100 transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="bg-[#111111] border border-[#1F1F1F] rounded-lg p-8">
      <div className="flex flex-col items-center gap-6">
        {/* Circular progress ring */}
        <div className="relative w-32 h-32">
          <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
            {/* Background circle */}
            <circle cx="60" cy="60" r={radius} fill="none" stroke="#1F1F1F" strokeWidth="8" />
            {/* Progress circle */}
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke="white"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-white text-2xl font-bold">{progress}%</span>
          </div>
        </div>

        {/* Status message */}
        <p className="text-[#6E6E6E] text-sm text-center">{message}</p>

        {/* Stage dots */}
        <div className="flex items-center gap-2">
          {STAGES.map((stage, index) => (
            <div key={stage} className="flex flex-col items-center gap-1">
              <div
                className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                  index < currentStage
                    ? 'bg-white'
                    : index === currentStage
                    ? 'bg-white animate-pulse'
                    : 'bg-[#1F1F1F]'
                }`}
              />
              <span className="text-[#6E6E6E] text-[10px] hidden md:block">{stage}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
