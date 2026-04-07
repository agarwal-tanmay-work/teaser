'use client'

import { motion } from 'framer-motion'

/** Fixed glassmorphism navigation bar matching the Ethereal Automaton reference design. */
export default function Navbar() {
  /** Smoothly scrolls to the #waitlist section. */
  function scrollToWaitlist() {
    document.getElementById('waitlist')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 h-16"
      style={{
        background: 'rgba(12,14,17,0.70)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
      }}
    >
      <div className="flex items-center justify-between h-full px-8 max-w-[1440px] mx-auto">
        {/* Left: logo + nav links */}
        <div className="flex items-center gap-8">
          <motion.span
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="text-xl font-extrabold tracking-tight ai-energy-text"
            style={{ fontFamily: 'var(--font-manrope)' }}
          >
            Teaser
          </motion.span>

          <div className="hidden md:flex items-center gap-6">
            {['My Projects', 'History', 'Credits'].map((label) => (
              <a
                key={label}
                href="#"
                className="text-sm font-bold tracking-tight transition-colors duration-200"
                style={{ color: '#aaabaf', fontFamily: 'var(--font-manrope)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#f9f9fd')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#aaabaf')}
              >
                {label}
              </a>
            ))}
          </div>
        </div>

        {/* Right: search + icons + avatar */}
        <div className="flex items-center gap-4">
          {/* Search pill */}
          <div
            className="hidden sm:flex items-center gap-2 px-4 py-1.5 rounded-full"
            style={{
              background: '#23262a',
              border: '1px solid rgba(70,72,75,0.15)',
            }}
          >
            <svg className="w-3.5 h-3.5 shrink-0" style={{ color: '#aaabaf' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              placeholder="Search projects..."
              className="bg-transparent border-none outline-none text-sm w-32"
              style={{ color: '#aaabaf' }}
            />
          </div>

          {/* Notification icon */}
          <button
            className="transition-colors duration-200"
            style={{ color: '#aaabaf' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#b6a0ff')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#aaabaf')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </button>

          {/* Settings icon */}
          <button
            className="transition-colors duration-200"
            style={{ color: '#aaabaf' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#b6a0ff')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#aaabaf')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Avatar */}
          <button
            onClick={scrollToWaitlist}
            className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center font-bold text-xs"
            style={{
              background: 'linear-gradient(135deg, #b6a0ff, #00e3fd)',
              border: '1px solid rgba(182,160,255,0.3)',
              color: '#000',
              fontFamily: 'var(--font-manrope)',
            }}
          >
            T
          </button>
        </div>
      </div>
    </nav>
  )
}
