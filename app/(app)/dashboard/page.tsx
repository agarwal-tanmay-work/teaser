'use client'

import { useState, Suspense } from 'react'
import VideoForm from '@/components/dashboard/VideoForm'
import ProgressTracker from '@/components/dashboard/ProgressTracker'
import VideoHistory from '@/components/dashboard/VideoHistory'

/** The main dashboard page. Shows the video form on the left and past videos in a right panel. */
export default function DashboardPage() {
  const [activeJobId, setActiveJobId] = useState<string | null>(null)

  return (
    <div className="flex gap-8 items-start min-h-screen">
      {/* Left — form + active job tracker */}
      <div className="flex-1 min-w-0 space-y-8">
        <div>
          <h1 className="text-white text-2xl font-bold">Dashboard</h1>
          <p className="text-[#6E6E6E] text-sm mt-1">
            Paste a product URL to generate a professional launch video.
          </p>
        </div>

        <Suspense fallback={<div className="h-64 animate-pulse bg-[#111] rounded-lg" />}>
          <VideoForm onJobCreated={(jobId) => setActiveJobId(jobId)} />
        </Suspense>

        {activeJobId && (
          <ProgressTracker
            jobId={activeJobId}
            onReset={() => setActiveJobId(null)}
          />
        )}
      </div>

      {/* Right — past videos panel */}
      <aside className="w-80 flex-shrink-0 sticky top-8 space-y-4">
        <h2 className="text-white text-base font-semibold">Past Videos</h2>
        <VideoHistory activeJobId={activeJobId} />
      </aside>
    </div>
  )
}
