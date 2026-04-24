"use client"

import { useState } from 'react'
import type { ApiResponse, WaitlistJoinResponse } from '@/types'
import confetti from 'canvas-confetti'

export default function Waitlist() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<WaitlistJoinResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!res.ok && res.status >= 500) {
        setError('Something went wrong. Please try again.')
        return
      }

      const data = (await res.json()) as ApiResponse<WaitlistJoinResponse>

      if (!data.success) {
        setError(data.error)
        return
      }

      setResult(data.data)
      confetti({
        particleCount: 140,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#b6a0ff', '#00e3fd', '#f9f9fd'],
      })
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="py-32 px-8">
      <div className="max-w-5xl mx-auto bg-surface-container-low rounded-[2.5rem] p-12 md:p-24 text-center space-y-10 relative overflow-hidden border border-outline-variant/15 shadow-2xl">
        <div className="absolute top-0 left-0 w-full h-full ai-energy-gradient opacity-5 pointer-events-none"></div>
        
        {!result ? (
          <>
            <h2 className="text-4xl md:text-6xl font-headline font-extrabold tracking-tight relative z-10">
              Stop recording, <br /> start <span className="ai-energy-text">launching</span>.
            </h2>
            <p className="text-on-surface-variant text-lg md:text-xl font-body max-w-xl mx-auto relative z-10">
              Join 4,000+ founders who have automated their product storytelling.
            </p>
            
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4 justify-center relative z-10 max-w-2xl mx-auto">
              <input 
                type="email" 
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Enter your email" 
                className="bg-surface-container-highest border border-outline-variant/30 rounded-full px-6 py-4 font-body text-on-surface-variant outline-none focus:ring-2 focus:ring-primary/50 w-full sm:w-72"
              />
              <button 
                type="submit"
                disabled={loading}
                className="ai-energy-gradient px-8 py-4 rounded-full font-headline font-extrabold text-on-primary-fixed shadow-2xl shadow-primary/30 text-lg hover:scale-105 transition-transform disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {loading ? 'Joining...' : 'Get Started for Free'}
              </button>
            </form>
            
            {error && (
              <p className="text-error mt-4 font-label text-sm relative z-10">{error}</p>
            )}

            <p className="font-label text-xs text-on-surface-variant uppercase tracking-[0.2em] relative z-10">
              No Credit Card Required • Instant Setup
            </p>
          </>
        ) : (
          <div className="flex flex-col items-center gap-6 relative z-10 py-8">
            <div className="w-16 h-16 rounded-full ai-energy-gradient flex items-center justify-center shadow-lg">
              <span className="material-symbols-outlined text-on-primary-fixed text-3xl">check</span>
            </div>
            <p className="font-headline font-bold text-3xl text-on-surface">You&apos;re on the list!</p>
            <p className="text-on-surface-variant text-lg">
              You are position <span className="ai-energy-text font-bold">#{result.position}</span>.
            </p>
            <p className="text-on-surface-variant text-sm">
              We&apos;ll email <span className="text-on-surface">{email}</span> when your spot is ready.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
