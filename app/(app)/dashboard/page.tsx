'use client'

import { useState, Suspense } from 'react'
import VideoForm from '@/components/dashboard/VideoForm'
import ProgressTracker from '@/components/dashboard/ProgressTracker'

/** The main dashboard page. Shows the video form, active job tracker, and history. */
export default function DashboardPage() {
  const [activeJobId, setActiveJobId] = useState<string | null>(null)

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-white text-2xl font-bold">Dashboard</h1>
        <p className="text-[#6E6E6E] text-sm mt-1">
          Paste a product URL to generate a professional launch video.
        </p>
      </div>

      {/* Video generation form */}
      <Suspense fallback={<div className="h-64 animate-pulse bg-[#111] rounded-lg"></div>}>
        <VideoForm onJobCreated={(jobId) => setActiveJobId(jobId)} />
      </Suspense>

      {/* Progress tracker — shown only when a job is active */}
      {activeJobId && (
        <ProgressTracker
          jobId={activeJobId}
          onReset={() => setActiveJobId(null)}
        />
      )}
    </div>
  )
}
