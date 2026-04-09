'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import type { VideoLength, VideoTone, ApiResponse, VideoCreateResponse } from '@/types'

interface VideoFormProps {
  onJobCreated: (jobId: string) => void
}

/** Validates that a URL starts with https:// */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Video generation form with URL input, optional customization, and credentials sections.
 * Calls POST /api/videos/create on submit and reports the job ID via onJobCreated.
 */
export default function VideoForm({ onJobCreated }: VideoFormProps) {
  const searchParams = useSearchParams()
  const initialUrl = searchParams.get('url') || ''

  const [url, setUrl] = useState(initialUrl)
  const [description, setDescription] = useState('')
  const [videoLength, setVideoLength] = useState<VideoLength>(60)
  const [tone, setTone] = useState<VideoTone>('professional')
  const [features, setFeatures] = useState('')
  const [credUsername, setCredUsername] = useState('')
  const [credPassword, setCredPassword] = useState('')

  const [showCustomize, setShowCustomize] = useState(false)
  const [showCredentials, setShowCredentials] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const urlValid = isValidUrl(url)

  /** Submits the form to create a video job. */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!urlValid) return
    setError(null)
    setLoading(true)

    try {
      const body: Record<string, unknown> = {
        product_url: url,
        video_length: videoLength,
        tone,
      }
      if (description) body.description = description
      if (features) body.features = features
      if (credUsername && credPassword) {
        body.credentials = { username: credUsername, password: credPassword }
      }

      const res = await fetch('/api/videos/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok && res.status >= 500) {
        setError('Something went wrong. Please try again.')
        return
      }

      const data = (await res.json()) as ApiResponse<VideoCreateResponse>
      if (!data.success) {
        setError(data.error)
        return
      }

      onJobCreated(data.data.job_id)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const videoLengths: VideoLength[] = [30, 60, 90]
  const tones: { value: VideoTone; label: string }[] = [
    { value: 'professional', label: 'Professional' },
    { value: 'conversational', label: 'Conversational' },
    { value: 'energetic', label: 'Energetic' },
  ]

  return (
    <form onSubmit={handleSubmit} className="bg-[#111111] border border-[#1F1F1F] rounded-lg p-6 space-y-6">
      <h2 className="text-white text-xl font-semibold">Generate a video</h2>

      {/* Section 1: Product URL */}
      <div>
        <label className="block text-white text-sm font-medium mb-2">Product URL</label>
        <div className="relative">
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourproduct.com"
            className="w-full px-4 py-3 pr-10 bg-[#0A0A0A] border border-[#1F1F1F] rounded-md text-white placeholder:text-[#6E6E6E] focus:outline-none focus:border-white transition-colors"
          />
          {url && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-lg">
              {urlValid ? '✓' : '✗'}
            </span>
          )}
        </div>
        {url && !urlValid && (
          <p className="mt-1 text-[#EF4444] text-xs">URL must start with https://</p>
        )}
      </div>

      {/* Section 2: Optional customization */}
      <div>
        <button
          type="button"
          onClick={() => setShowCustomize((v) => !v)}
          className="text-[#6E6E6E] text-sm hover:text-white transition-colors flex items-center gap-1"
        >
          Customize your video
          <span className={`transition-transform ${showCustomize ? 'rotate-180' : ''}`}>↓</span>
        </button>

        {showCustomize && (
          <div className="mt-4 space-y-4">
            {/* Description */}
            <div>
              <label className="block text-white text-sm font-medium mb-2">
                What does your product do? <span className="text-[#6E6E6E] font-normal">(optional)</span>
              </label>
              <div className="relative">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 300))}
                  placeholder="e.g. A project management tool for remote design teams"
                  rows={3}
                  className="w-full px-4 py-3 bg-[#0A0A0A] border border-[#1F1F1F] rounded-md text-white placeholder:text-[#6E6E6E] focus:outline-none focus:border-white transition-colors resize-none"
                />
                <span className="absolute bottom-2 right-3 text-[#6E6E6E] text-xs">
                  {description.length}/300
                </span>
              </div>
            </div>

            {/* Video length */}
            <div>
              <label className="block text-white text-sm font-medium mb-2">Video length</label>
              <div className="flex gap-2">
                {videoLengths.map((len) => (
                  <button
                    key={len}
                    type="button"
                    onClick={() => setVideoLength(len)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      videoLength === len
                        ? 'bg-white text-black'
                        : 'bg-[#0A0A0A] text-[#6E6E6E] border border-[#1F1F1F] hover:text-white hover:border-white'
                    }`}
                  >
                    {len} sec
                  </button>
                ))}
              </div>
            </div>

            {/* Tone */}
            <div>
              <label className="block text-white text-sm font-medium mb-2">Tone</label>
              <div className="flex flex-wrap gap-2">
                {tones.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTone(value)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      tone === value
                        ? 'bg-white text-black'
                        : 'bg-[#0A0A0A] text-[#6E6E6E] border border-[#1F1F1F] hover:text-white hover:border-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Key features */}
            <div>
              <label className="block text-white text-sm font-medium mb-2">
                Key features to show <span className="text-[#6E6E6E] font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={features}
                onChange={(e) => setFeatures(e.target.value)}
                placeholder="e.g. the dashboard, the onboarding flow, the analytics"
                className="w-full px-4 py-3 bg-[#0A0A0A] border border-[#1F1F1F] rounded-md text-white placeholder:text-[#6E6E6E] focus:outline-none focus:border-white transition-colors"
              />
              <p className="mt-1 text-[#6E6E6E] text-xs">
                We will make sure to demo these specifically
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Section 3: Credentials */}
      <div>
        <button
          type="button"
          onClick={() => setShowCredentials((v) => !v)}
          className="text-[#6E6E6E] text-sm hover:text-white transition-colors flex items-center gap-1"
        >
          My product requires a login
          <span className={`transition-transform ${showCredentials ? 'rotate-180' : ''}`}>↓</span>
        </button>

        {showCredentials && (
          <div className="mt-4 space-y-3">
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-3">
              <p className="text-amber-400 text-xs leading-relaxed">
                Your credentials are used only for the demo recording session and are never stored
                after the video is generated.
              </p>
            </div>
            <input
              type="text"
              value={credUsername}
              onChange={(e) => setCredUsername(e.target.value)}
              placeholder="Username or email"
              autoComplete="off"
              className="w-full px-4 py-3 bg-[#0A0A0A] border border-[#1F1F1F] rounded-md text-white placeholder:text-[#6E6E6E] focus:outline-none focus:border-white transition-colors"
            />
            <input
              type="password"
              value={credPassword}
              onChange={(e) => setCredPassword(e.target.value)}
              placeholder="Password"
              autoComplete="new-password"
              className="w-full px-4 py-3 bg-[#0A0A0A] border border-[#1F1F1F] rounded-md text-white placeholder:text-[#6E6E6E] focus:outline-none focus:border-white transition-colors"
            />
          </div>
        )}
      </div>

      {/* Submit */}
      {error && <p className="text-[#EF4444] text-sm">{error}</p>}

      <div>
        <button
          type="submit"
          disabled={loading || !urlValid}
          className="w-full py-3 bg-white text-black font-semibold rounded-md hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            'Generate my video →'
          )}
        </button>
        <p className="mt-2 text-[#6E6E6E] text-sm text-center">
          Your video will be ready in 5-10 minutes. We will show your progress below.
        </p>
      </div>
    </form>
  )
}
