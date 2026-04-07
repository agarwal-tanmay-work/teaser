'use client'

import { motion } from 'framer-motion'

/** Hero section matching the Ethereal Automaton reference design exactly. */
export default function Hero() {
  /** Smoothly scrolls to the #waitlist section. */
  function scrollToWaitlist() {
    document.getElementById('waitlist')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <section
      className="relative flex flex-col items-center justify-center px-6 text-center overflow-hidden"
      style={{ minHeight: '921px', paddingTop: '64px' }}
    >
      {/* Background glow orbs */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '25%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '800px',
          height: '400px',
          background: 'rgba(182,160,255,0.10)',
          filter: 'blur(120px)',
          borderRadius: '50%',
          zIndex: 0,
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          bottom: '25%',
          left: '33%',
          width: '600px',
          height: '300px',
          background: 'rgba(0,227,253,0.05)',
          filter: 'blur(100px)',
          borderRadius: '50%',
          zIndex: 0,
        }}
      />

      <div className="relative z-10 max-w-4xl mx-auto flex flex-col items-center gap-8">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full"
          style={{
            background: '#111417',
            border: '1px solid rgba(70,72,75,0.15)',
          }}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              background: '#ff59e3',
              boxShadow: '0 0 8px #ff05e5',
              animation: 'pulse 2s infinite',
            }}
          />
          <span
            className="text-xs uppercase tracking-widest"
            style={{ color: '#aaabaf', fontFamily: 'var(--font-space-grotesk)' }}
          >
            Zero effort, under 10 minutes
          </span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="font-extrabold tracking-tighter leading-[1.1]"
          style={{
            fontSize: 'clamp(3rem, 6.5vw, 5.5rem)',
            fontFamily: 'var(--font-manrope)',
            color: '#f9f9fd',
          }}
        >
          URL in.{' '}
          <br />
          <span className="ai-energy-text">Professional launch video</span>{' '}out.
        </motion.h1>

        {/* Subtext */}
        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="text-lg md:text-xl leading-relaxed max-w-2xl"
          style={{ color: '#aaabaf' }}
        >
          0 editing skills. 0 screen recording. 0 agency.
          <br className="hidden md:block" />
          Transform your product link into a cinematic masterpiece instantly.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="flex flex-col sm:flex-row gap-4 items-center"
        >
          <motion.button
            onClick={scrollToWaitlist}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            className="ai-energy-gradient font-extrabold"
            style={{
              padding: '16px 32px',
              borderRadius: '12px',
              color: '#000',
              fontFamily: 'var(--font-manrope)',
              fontSize: '1rem',
              boxShadow: '0 8px 32px rgba(182,160,255,0.25)',
            }}
          >
            Get Started for Free
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            className="font-bold"
            style={{
              padding: '16px 32px',
              borderRadius: '12px',
              color: '#f9f9fd',
              fontFamily: 'var(--font-manrope)',
              fontSize: '1rem',
              background: '#292c31',
              border: '1px solid rgba(70,72,75,0.15)',
            }}
          >
            View Showreel
          </motion.button>
        </motion.div>
      </div>

      {/* Transformation Visual */}
      <motion.div
        initial={{ opacity: 0, y: 48 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 mt-16 w-full max-w-5xl mx-auto px-4"
      >
        {/* Floating accent orbs */}
        <div
          className="absolute pointer-events-none hidden lg:block"
          style={{
            top: '-48px',
            right: '-48px',
            width: '192px',
            height: '192px',
            background: 'rgba(255,89,227,0.10)',
            filter: 'blur(60px)',
            borderRadius: '50%',
          }}
        />
        <div
          className="absolute pointer-events-none hidden lg:block"
          style={{
            bottom: '-32px',
            left: '-32px',
            width: '256px',
            height: '256px',
            background: 'rgba(0,227,253,0.10)',
            filter: 'blur(80px)',
            borderRadius: '50%',
          }}
        />

        {/* Main card wrapper */}
        <div
          style={{
            background: '#111417',
            borderRadius: '16px',
            border: '1px solid rgba(70,72,75,0.15)',
            boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
            padding: '8px',
            position: 'relative',
            zIndex: 10,
          }}
        >
          <div className="flex flex-col lg:flex-row gap-4 items-stretch">

            {/* Input side */}
            <div
              className="flex-1 flex flex-col justify-center gap-6 p-8"
              style={{ background: '#171a1d', borderRadius: '12px' }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: '#1d2024' }}
                >
                  <svg className="w-5 h-5" style={{ color: '#00e3fd' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </div>
                <div className="text-left">
                  <p
                    className="text-xs uppercase tracking-widest mb-0.5"
                    style={{ color: '#00e3fd', fontFamily: 'var(--font-space-grotesk)' }}
                  >
                    Input source
                  </p>
                  <p
                    className="font-bold text-base"
                    style={{ color: '#f9f9fd', fontFamily: 'var(--font-manrope)' }}
                  >
                    Paste Product URL
                  </p>
                </div>
              </div>

              <div
                className="w-full px-4 py-3 rounded-lg text-sm"
                style={{
                  background: '#23262a',
                  border: '1px solid rgba(70,72,75,0.30)',
                  color: '#aaabaf',
                  fontFamily: 'monospace',
                }}
              >
                https://teaser.ai/new-launch
              </div>
            </div>

            {/* Center arrow */}
            <div className="lg:flex items-center justify-center hidden shrink-0">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
                style={{
                  background: 'linear-gradient(135deg, #b6a0ff, #00e3fd)',
                  boxShadow: '0 8px 24px rgba(182,160,255,0.3)',
                }}
              >
                <svg className="w-5 h-5" style={{ color: '#000' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </div>
            </div>

            {/* Output side — video preview */}
            <div
              className="relative group overflow-hidden"
              style={{
                flex: '1.5',
                borderRadius: '12px',
                background: '#0c0e11',
                minHeight: '200px',
                aspectRatio: '16/9',
              }}
            >
              {/* Dark overlay gradient */}
              <div
                className="absolute inset-0 z-10"
                style={{
                  background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)',
                  borderRadius: '12px',
                }}
              />
              {/* Subtle grid texture */}
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: 'linear-gradient(rgba(182,160,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(182,160,255,0.03) 1px, transparent 1px)',
                  backgroundSize: '32px 32px',
                }}
              />

              {/* Play button */}
              <div className="absolute inset-0 flex items-center justify-center z-20">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
                  style={{
                    background: 'rgba(17,20,23,0.7)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid rgba(255,255,255,0.2)',
                  }}
                >
                  <svg className="w-6 h-6 ml-1" style={{ color: '#fff' }} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>

              {/* Bottom badges */}
              <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2">
                <div
                  className="px-3 py-1 rounded"
                  style={{
                    background: 'rgba(0,227,253,0.20)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(0,227,253,0.30)',
                  }}
                >
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: '#00e3fd', fontFamily: 'var(--font-space-grotesk)', letterSpacing: '0.1em' }}
                  >
                    4K READY
                  </span>
                </div>
                <div
                  className="px-3 py-1 rounded"
                  style={{
                    background: 'rgba(255,255,255,0.10)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255,255,255,0.20)',
                  }}
                >
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: '#fff', fontFamily: 'var(--font-space-grotesk)', letterSpacing: '0.1em' }}
                  >
                    GENERATING... 88%
                  </span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </motion.div>
    </section>
  )
}
