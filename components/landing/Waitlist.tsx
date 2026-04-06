'use client'

import { useState } from 'react'
import confetti from 'canvas-confetti'
import type { ApiResponse, WaitlistJoinResponse } from '@/types'

/** Waitlist sign-up section with email form, success confetti, and position display. */
export default function Waitlist() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<WaitlistJoinResponse | null>(null)

  /** Submits the email to the waitlist API and triggers confetti on success. */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = (await res.json()) as ApiResponse<WaitlistJoinResponse>

      if (!data.success) {
        setError(data.error)
        return
      }

      setResult(data.data)
      confetti({
        particleCount: 120,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#ffffff', '#6E6E6E', '#22C55E'],
      })
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section id="waitlist" className="py-24 px-6 md:px-12">
      <div className="max-w-3xl mx-auto bg-[#111111] border border-[#1F1F1F] rounded-2xl p-8 md:p-12 text-center">
        <h2 className="text-white text-4xl font-bold mb-4">
          Be the first to automate your launch video
        </h2>
        <p className="text-[#6E6E6E] text-lg mb-8">
          We are onboarding founders in batches to ensure quality. Join now to reserve your
          spot in the first batch.
        </p>

        {result ? (
          /* Success state */
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-[#22C55E]/10 border border-[#22C55E]/30 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-[#22C55E]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="text-white text-2xl font-semibold">You are on the list!</p>
            <p className="text-[#6E6E6E]">
              You are number <span className="text-white font-semibold">{result.position}</span> on
              the waitlist.
            </p>
            <p className="text-[#6E6E6E] text-sm">
              We will email you at{' '}
              <span className="text-white">{email}</span> when your spot is ready.
            </p>
          </div>
        ) : (
          /* Form state */
          <>
            <form
              onSubmit={handleSubmit}
              className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
            >
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your work email"
                className="flex-1 px-4 py-3 bg-[#0A0A0A] border border-[#1F1F1F] rounded-md text-white placeholder:text-[#6E6E6E] focus:outline-none focus:border-white transition-colors"
              />
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-3 bg-white text-black font-semibold rounded-md hover:bg-gray-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                    Joining...
                  </>
                ) : (
                  'Join the waitlist'
                )}
              </button>
            </form>
            {error && (
              <p className="mt-3 text-[#EF4444] text-sm">{error}</p>
            )}
            <p className="mt-3 text-[#6E6E6E] text-sm">
              No spam. No credit card. We email you when your spot is ready.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
