'use client'

import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'

const URL_TO_TYPE = 'https://yourproduct.com'

/** Animated hero section with gradient headline, subheadline, CTA, and browser mockup. */
export default function Hero() {
  const [typedUrl, setTypedUrl] = useState('')
  const [phase, setPhase] = useState<'typing' | 'loading' | 'ready'>('typing')

  /** Smoothly scrolls the page to the #waitlist section. */
  function scrollToWaitlist() {
    document.getElementById('waitlist')?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    let i = 0
    const typeInterval = setInterval(() => {
      i++
      setTypedUrl(URL_TO_TYPE.slice(0, i))
      if (i >= URL_TO_TYPE.length) {
        clearInterval(typeInterval)
        setTimeout(() => setPhase('loading'), 400)
        setTimeout(() => setPhase('ready'), 2200)
      }
    }, 60)
    return () => clearInterval(typeInterval)
  }, [])

  return (
    <section className="min-h-screen flex flex-col items-center justify-center px-6 pt-16 text-center">
      {/* Badge */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-6 px-4 py-1.5 text-xs text-[#6E6E6E] border border-[#1F1F1F] rounded-full"
      >
        Launching 2025
      </motion.div>

      {/* Headline */}
      <motion.h1
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="text-5xl md:text-7xl font-bold leading-tight max-w-4xl bg-gradient-to-b from-white to-[#6E6E6E] bg-clip-text text-transparent"
      >
        Your product URL.
        <br />
        A professional launch video.
        <br />
        Automatically.
      </motion.h1>

      {/* Subheadline */}
      <motion.p
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="mt-6 text-xl text-[#6E6E6E] max-w-2xl leading-relaxed"
      >
        Paste your product link. Our AI visits your product, understands what it does,
        records a real demo, writes the script, generates the voiceover, and delivers a
        publish-ready launch video — in under 10 minutes.
      </motion.p>

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="mt-8 flex flex-col items-center gap-3"
      >
        <button
          onClick={scrollToWaitlist}
          className="px-8 py-3 bg-white text-black font-semibold rounded-md hover:bg-gray-100 transition-colors"
        >
          Join the waitlist →
        </button>
        <p className="text-[#6E6E6E] text-sm">500+ founders already on the waitlist</p>
      </motion.div>

      {/* Browser mockup */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.5 }}
        className="mt-16 w-full max-w-2xl"
      >
        <div className="bg-[#111111] border border-[#1F1F1F] rounded-lg overflow-hidden">
          {/* Browser chrome */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1F1F1F] bg-[#0A0A0A]">
            <div className="w-3 h-3 rounded-full bg-[#1F1F1F]" />
            <div className="w-3 h-3 rounded-full bg-[#1F1F1F]" />
            <div className="w-3 h-3 rounded-full bg-[#1F1F1F]" />
            <div className="flex-1 mx-4 px-3 py-1 bg-[#111111] border border-[#1F1F1F] rounded text-xs text-[#6E6E6E] text-left font-mono">
              {typedUrl}
              {phase === 'typing' && (
                <span className="inline-block w-0.5 h-3 bg-white ml-0.5 animate-pulse" />
              )}
            </div>
          </div>

          {/* Browser content */}
          <div className="h-48 flex items-center justify-center">
            {phase === 'typing' && (
              <p className="text-[#6E6E6E] text-sm">Waiting for URL...</p>
            )}
            {phase === 'loading' && (
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-[#1F1F1F] border-t-white rounded-full animate-spin" />
                <p className="text-[#6E6E6E] text-sm">Analysing your product...</p>
              </div>
            )}
            {phase === 'ready' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center gap-3"
              >
                <div className="w-16 h-16 rounded-full bg-[#111111] border border-[#1F1F1F] flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <p className="text-white font-semibold">Your video is ready</p>
                <p className="text-[#6E6E6E] text-xs">Generated in 7 minutes 42 seconds</p>
              </motion.div>
            )}
          </div>
        </div>
      </motion.div>
    </section>
  )
}
