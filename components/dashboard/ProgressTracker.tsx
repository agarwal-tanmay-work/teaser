'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiResponse, VideoJob } from '@/types'

interface ProgressTrackerProps {
  jobId: string
  onReset: () => void
}

interface Stage {
  label: string
  description: string
  /** Progress % at which this stage starts */
  startsAt: number
  /** Estimated seconds this stage takes */
  estimatedSeconds: number
  tip: string
}

const STAGES: Stage[] = [
  {
    label: 'Understanding your product',
    description: 'Reading your website and mapping out the best demo flow',
    startsAt: 0,
    estimatedSeconds: 45,
    tip: 'Our AI is studying your product like a first-time user — figuring out what to show and in what order.',
  },
  {
    label: 'Recording the demo',
    description: 'Opening your product in a real browser and navigating it step-by-step',
    startsAt: 15,
    estimatedSeconds: 180,
    tip: 'A real headless Chrome browser is visiting your product right now — no fake AI-generated screens.',
  },
  {
    label: 'Writing the script',
    description: 'Crafting a professional narration timed to match the recording',
    startsAt: 35,
    estimatedSeconds: 40,
    tip: 'Scripts are written in the style of top ProductHunt launch videos — punchy, clear, persuasive.',
  },
  {
    label: 'Generating voiceover',
    description: 'Converting the script to a natural AI voice using ElevenLabs',
    startsAt: 55,
    estimatedSeconds: 35,
    tip: 'ElevenLabs produces some of the most natural-sounding AI voices available today.',
  },
  {
    label: 'Editing the video',
    description: 'Adding captions, zoom effects, cursor highlights, intro and outro',
    startsAt: 70,
    estimatedSeconds: 120,
    tip: 'FFmpeg is assembling your recording, voiceover, animated captions, and smart zoom effects.',
  },
  {
    label: 'Uploading your video',
    description: 'Finalising and storing your MP4 so you can download it',
    startsAt: 90,
    estimatedSeconds: 20,
    tip: 'Almost there — your video is being uploaded to secure cloud storage.',
  },
]

/** Maps a progress % to the current stage index. */
function getStageIndex(progress: number): number {
  let idx = 0
  for (let i = 0; i < STAGES.length; i++) {
    if (progress >= STAGES[i].startsAt) idx = i
  }
  return idx
}

/** Returns a human-readable time estimate string. */
function formatTime(seconds: number): string {
  if (seconds >= 60) return `~${Math.ceil(seconds / 60)} min`
  return `~${seconds} sec`
}

/** Estimates remaining seconds from current progress. */
function estimateRemainingSeconds(progress: number): number {
  const stageIdx = getStageIndex(progress)
  let remaining = 0
  for (let i = stageIdx; i < STAGES.length; i++) {
    const stage = STAGES[i]
    if (i === stageIdx) {
      const nextStart = STAGES[i + 1]?.startsAt ?? 100
      const stageRange = nextStart - stage.startsAt
      const stageProgress = stageRange > 0 ? (progress - stage.startsAt) / stageRange : 0
      remaining += stage.estimatedSeconds * (1 - stageProgress)
    } else {
      remaining += stage.estimatedSeconds
    }
  }
  return Math.max(0, Math.round(remaining))
}

/** Fetches the current status of a video job from the API. */
async function fetchJobStatus(jobId: string): Promise<VideoJob> {
  const res = await fetch(`/api/videos/status/${jobId}`)
  if (!res.ok) throw new Error(`Status check failed (HTTP ${res.status})`)
  const data = (await res.json()) as ApiResponse<VideoJob>
  if (!data.success) throw new Error(data.error)
  return data.data
}

/**
 * Rich progress tracker that polls job status every 3 seconds.
 * Shows current pipeline stage, estimated time remaining, stage checklist, and rotating tips.
 */
export default function ProgressTracker({ jobId, onReset }: ProgressTrackerProps) {
  const [tipIndex, setTipIndex] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  const { data: job } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => fetchJobStatus(jobId),
    refetchInterval: (query) => {
      const s = query.state.data?.status
      if (s === 'completed' || s === 'failed') return false
      return 3000
    },
  })

  // Rotate tips every 8 seconds
  useEffect(() => {
    const id = setInterval(() => setTipIndex((i) => (i + 1) % STAGES.length), 8000)
    return () => clearInterval(id)
  }, [])

  // Elapsed timer
  useEffect(() => {
    const id = setInterval(() => setElapsedSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const progress = job?.progress ?? 0
  const status = job?.status ?? 'pending'
  const serverMessage = job?.progress_message
  const stageIdx = getStageIndex(progress)
  const currentStage = STAGES[stageIdx]
  const remainingSecs = estimateRemainingSeconds(progress)
  const elapsedMin = Math.floor(elapsedSeconds / 60)
  const elapsedSec = elapsedSeconds % 60

  // ── Completed ────────────────────────────────────────────────────────────────
  if (status === 'completed' && job?.final_video_url) {
    return (
      <div className="bg-[#111111] border border-[#1F1F1F] rounded-lg p-8 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-[#22C55E]/10 border border-[#22C55E]/30 flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-white text-2xl font-bold">Your video is ready!</p>
        <p className="text-[#6E6E6E] text-sm">Generated in {elapsedMin}m {elapsedSec}s</p>
        <video
          src={job.final_video_url}
          controls
          className="w-full max-w-2xl mx-auto rounded-lg border border-[#1F1F1F]"
        />
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <a
            href={job.final_video_url}
            download
            className="px-5 py-2.5 bg-white text-black font-semibold text-sm rounded-md hover:bg-gray-100 transition-colors"
          >
            Download MP4
          </a>
          <button
            onClick={() => { void navigator.clipboard.writeText(job.final_video_url ?? '') }}
            className="px-5 py-2.5 border border-[#1F1F1F] text-white text-sm font-medium rounded-md hover:bg-[#1F1F1F] transition-colors"
          >
            Copy link
          </button>
          <button
            onClick={onReset}
            className="px-5 py-2.5 border border-[#1F1F1F] text-[#6E6E6E] text-sm font-medium rounded-md hover:text-white hover:bg-[#1F1F1F] transition-colors"
          >
            Make another
          </button>
        </div>
      </div>
    )
  }

  // ── Failed ───────────────────────────────────────────────────────────────────
  if (status === 'failed') {
    return (
      <div className="bg-[#111111] border border-[#1F1F1F] rounded-lg p-8 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-[#EF4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <p className="text-white text-xl font-semibold">Something went wrong</p>
        {job?.error_message && (
          <p className="text-[#6E6E6E] text-sm max-w-md mx-auto">{job.error_message}</p>
        )}
        <button
          onClick={onReset}
          className="px-6 py-2.5 bg-white text-black font-semibold text-sm rounded-md hover:bg-gray-100 transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }

  // ── In progress ──────────────────────────────────────────────────────────────
  return (
    <div className="bg-[#111111] border border-[#1F1F1F] rounded-lg overflow-hidden">
      {/* Top progress bar */}
      <div className="h-1 bg-[#1F1F1F]">
        <div
          className="h-full bg-white transition-all duration-700 ease-out"
          style={{ width: `${Math.max(2, progress)}%` }}
        />
      </div>

      <div className="p-6 space-y-6">
        {/* Current stage + progress % */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse flex-shrink-0" />
              <p className="text-white font-semibold text-sm">
                {serverMessage ?? currentStage.label}
              </p>
            </div>
            <p className="text-[#6E6E6E] text-xs leading-relaxed pl-4">
              {currentStage.description}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-white text-3xl font-bold tabular-nums">{progress}%</p>
            <p className="text-[#6E6E6E] text-xs mt-0.5">
              {remainingSecs > 5 ? `${formatTime(remainingSecs)} left` : 'almost done...'}
            </p>
          </div>
        </div>

        {/* Stage checklist */}
        <div className="space-y-2.5">
          {STAGES.map((stage, i) => {
            const isDone = i < stageIdx
            const isActive = i === stageIdx
            const isPending = i > stageIdx

            return (
              <div key={stage.label} className="flex items-center gap-3">
                {/* Status icon */}
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                  isDone ? 'bg-white' : isActive ? 'border border-white/30 bg-white/5' : 'bg-[#1F1F1F]'
                }`}>
                  {isDone ? (
                    <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : isActive ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#3F3F3F]" />
                  )}
                </div>

                {/* Label */}
                <span className={`text-sm flex-1 ${
                  isDone ? 'text-[#6E6E6E] line-through' : isActive ? 'text-white font-medium' : 'text-[#3F3F3F]'
                }`}>
                  {stage.label}
                </span>

                {/* Right badge */}
                {isDone && <span className="text-[#22C55E] text-xs">done</span>}
                {isActive && <span className="text-[#6E6E6E] text-xs animate-pulse">in progress</span>}
                {isPending && <span className="text-[#3F3F3F] text-xs">{formatTime(stage.estimatedSeconds)}</span>}
              </div>
            )
          })}
        </div>

        {/* Rotating tip */}
        <div className="bg-[#0A0A0A] border border-[#1F1F1F] rounded-md p-3.5">
          <p className="text-[#6E6E6E] text-xs leading-relaxed">
            <span className="text-white text-[10px] font-semibold uppercase tracking-wider mr-2">Did you know</span>
            {STAGES[tipIndex].tip}
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[#3F3F3F] text-xs">
          <span>Running for {elapsedMin}m {String(elapsedSec).padStart(2, '0')}s</span>
          <span>Total estimate: ~8 min</span>
        </div>
      </div>
    </div>
  )
}
