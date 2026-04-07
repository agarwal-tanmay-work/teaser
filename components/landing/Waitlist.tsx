'use client'

import { motion } from 'framer-motion'
import { useState } from 'react'
import confetti from 'canvas-confetti'
import type { ApiResponse, WaitlistJoinResponse } from '@/types'

/** CTA section — "Stop recording, start launching" matching the reference design. */
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
        colors: ['#b6a0ff', '#00e3fd', '#f9f9fd', '#FFBD2E'],
      })
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section id="waitlist" style={{ padding: '128px 32px' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] as [number,number,number,number] }}
          className="relative overflow-hidden text-center"
          style={{
            background: '#111417',
            borderRadius: '40px',
            padding: '96px 64px',
          }}
        >
          {/* AI energy gradient overlay — very subtle */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(135deg, #b6a0ff, #00e3fd)',
              opacity: 0.05,
            }}
          />

          {!result ? (
            <>
              <motion.h2
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="font-extrabold tracking-tight relative z-10"
                style={{
                  fontSize: 'clamp(2.2rem, 5vw, 3.5rem)',
                  fontFamily: 'var(--font-manrope)',
                  color: '#f9f9fd',
                  marginBottom: '16px',
                  lineHeight: 1.2,
                }}
              >
                Stop recording,{' '}
                <br />
                start <span className="ai-energy-text">launching</span>.
              </motion.h2>

              <motion.p
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.05 }}
                className="relative z-10"
                style={{
                  color: '#aaabaf',
                  fontSize: '1.1rem',
                  lineHeight: 1.7,
                  marginBottom: '40px',
                  maxWidth: '480px',
                  margin: '0 auto 40px',
                }}
              >
                Join 4,000+ founders who have automated their product storytelling.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="relative z-10 flex flex-col sm:flex-row gap-4 justify-center"
              >
                <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4">
                  <motion.button
                    type="submit"
                    disabled={loading}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.97 }}
                    className="ai-energy-gradient font-extrabold"
                    style={{
                      padding: '20px 48px',
                      borderRadius: '9999px',
                      color: '#000',
                      fontFamily: 'var(--font-manrope)',
                      fontSize: '1.1rem',
                      boxShadow: '0 16px 48px rgba(182,160,255,0.30)',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      opacity: loading ? 0.6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    {loading ? (
                      <>
                        <span
                          className="w-4 h-4 rounded-full animate-spin"
                          style={{ border: '2px solid rgba(0,0,0,0.2)', borderTopColor: '#000' }}
                        />
                        Joining…
                      </>
                    ) : (
                      'Get Started for Free'
                    )}
                  </motion.button>
                </form>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => document.getElementById('waitlist')?.scrollIntoView({ behavior: 'smooth' })}
                  className="font-bold"
                  style={{
                    padding: '20px 48px',
                    borderRadius: '9999px',
                    color: '#f9f9fd',
                    fontFamily: 'var(--font-manrope)',
                    fontSize: '1.1rem',
                    background: 'transparent',
                    border: '1px solid rgba(70,72,75,0.30)',
                  }}
                >
                  Talk to Sales
                </motion.button>
              </motion.div>

              {error && (
                <motion.p
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative z-10 mt-4"
                  style={{ color: '#EF4444', fontSize: '0.875rem' }}
                >
                  {error}
                </motion.p>
              )}

              <p
                className="relative z-10 mt-6 uppercase tracking-[0.2em] text-xs"
                style={{ color: '#aaabaf', fontFamily: 'var(--font-space-grotesk)' }}
              >
                No Credit Card Required · Instant Setup
              </p>
            </>
          ) : (
            /* Success state */
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number,number,number,number] }}
              className="relative z-10 flex flex-col items-center gap-5"
            >
              <div className="relative">
                <div
                  className="absolute inset-0 rounded-full blur-xl"
                  style={{ background: 'linear-gradient(135deg, #b6a0ff, #00e3fd)', opacity: 0.3 }}
                />
                <div
                  className="relative w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(182,160,255,0.10)', border: '1px solid rgba(182,160,255,0.30)' }}
                >
                  <svg className="w-8 h-8" style={{ color: '#b6a0ff' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              <p
                className="font-bold"
                style={{ fontSize: '1.75rem', fontFamily: 'var(--font-manrope)', color: '#f9f9fd' }}
              >
                You&apos;re on the list!
              </p>
              <p style={{ color: '#aaabaf', fontSize: '1.1rem' }}>
                You are{' '}
                <span className="ai-energy-text font-bold" style={{ fontSize: '1.25rem' }}>
                  #{result.position}
                </span>{' '}
                on the waitlist.
              </p>
              <p style={{ color: '#aaabaf', fontSize: '0.875rem' }}>
                We&apos;ll email <span style={{ color: '#f9f9fd' }}>{email}</span> when your spot is ready.
              </p>
            </motion.div>
          )}
        </motion.div>
      </div>
    </section>
  )
}
