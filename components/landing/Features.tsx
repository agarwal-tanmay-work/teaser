'use client'

import { motion } from 'framer-motion'

/** Features section with asymmetric bento grid matching the reference design exactly. */
export default function Features() {
  return (
    <section
      className="relative overflow-hidden"
      style={{ padding: '128px 32px', maxWidth: '1440px', margin: '0 auto' }}
    >
      {/* Section header — left-aligned */}
      <div className="max-w-lg mb-16">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          style={{
            fontSize: 'clamp(2rem, 4vw, 2.5rem)',
            fontFamily: 'var(--font-manrope)',
            fontWeight: 700,
            color: '#f9f9fd',
            marginBottom: '16px',
          }}
        >
          Magic in every frame.
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.05 }}
          style={{ color: '#aaabaf', lineHeight: 1.7, fontSize: '0.9rem' }}
        >
          Our automaton analyzes your UI patterns, typography, and brand colors to generate a
          bespoke launch trailer that looks like it cost $20k.
        </motion.p>
      </div>

      {/* ── Bento grid ── */}
      {/* Row 1: large card (8) + speed card (4) */}
      <div className="flex flex-col md:flex-row gap-6 mb-6" style={{ height: 'auto', alignItems: 'stretch' }}>

        {/* Card 1: Autonomous Scene Direction — 8 parts */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative overflow-hidden group"
          style={{
            flex: '8',
            background: '#111417',
            borderRadius: '16px',
            padding: '40px',
            minHeight: '300px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          {/* Crystal star decoration — right side */}
          <div
            className="absolute bottom-0 right-0 opacity-60 group-hover:opacity-90 transition-opacity duration-500 pointer-events-none"
            style={{ width: '50%', height: '100%', overflow: 'hidden' }}
          >
            <svg viewBox="0 0 320 320" style={{ width: '100%', height: '100%' }}>
              <defs>
                <filter id="starGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="8" result="blur" />
                  <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
                <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
                <radialGradient id="centerGrad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#00e3fd" stopOpacity="1" />
                  <stop offset="60%" stopColor="#b6a0ff" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#00e3fd" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="armGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#00e3fd" stopOpacity="0.9"/>
                  <stop offset="100%" stopColor="#b6a0ff" stopOpacity="0.2"/>
                </linearGradient>
              </defs>
              {/* Outer glow halo */}
              <circle cx="160" cy="160" r="90" fill="#00e3fd" opacity="0.04"/>
              <circle cx="160" cy="160" r="60" fill="#b6a0ff" opacity="0.06"/>
              {/* Star arms — 8 directions */}
              {[0,45,90,135,180,225,270,315].map((angle, i) => {
                const rad = (angle * Math.PI) / 180;
                const len = i % 2 === 0 ? 110 : 70;
                const ex = 160 + Math.cos(rad) * len;
                const ey = 160 + Math.sin(rad) * len;
                const mx = 160 + Math.cos(rad) * (len * 0.5);
                const my = 160 + Math.sin(rad) * (len * 0.5);
                const perp = rad + Math.PI / 2;
                const w = i % 2 === 0 ? 12 : 6;
                const p1x = mx + Math.cos(perp) * w;
                const p1y = my + Math.sin(perp) * w;
                const p2x = mx - Math.cos(perp) * w;
                const p2y = my - Math.sin(perp) * w;
                return (
                  <g key={angle} filter="url(#softGlow)">
                    <polygon
                      points={`160,160 ${p1x},${p1y} ${ex},${ey} ${p2x},${p2y}`}
                      fill="url(#armGrad)"
                      opacity={i % 2 === 0 ? 0.7 : 0.45}
                    />
                  </g>
                );
              })}
              {/* Center bright core */}
              <circle cx="160" cy="160" r="18" fill="url(#centerGrad)" filter="url(#starGlow)" opacity="0.9"/>
              <circle cx="160" cy="160" r="8" fill="#00e3fd" opacity="0.95"/>
              {/* Sparkle dots at arm tips */}
              {[0,90,180,270].map((angle, i) => {
                const rad = (angle * Math.PI) / 180;
                const ex = 160 + Math.cos(rad) * 110;
                const ey = 160 + Math.sin(rad) * 110;
                return <circle key={`tip${i}`} cx={ex} cy={ey} r="3" fill="#00e3fd" opacity="0.8" filter="url(#softGlow)"/>;
              })}
            </svg>
          </div>

          {/* Content */}
          <div className="relative z-10" style={{ maxWidth: '380px' }}>
            <div
              className="mb-6 flex items-center justify-center"
              style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'rgba(182,160,255,0.10)' }}
            >
              {/* Psychology / brain icon */}
              <svg className="w-5 h-5" style={{ color: '#b6a0ff' }} viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 3c-2.39 0-4.47 1.3-5.6 3.2C5.92 6.59 5 7.67 5 9c0 .53.13 1.03.35 1.47C4.54 11.04 4 12 4 13c0 1.4.82 2.63 2 3.23V17a2 2 0 002 2h1v1a1 1 0 001 1h4a1 1 0 001-1v-1h1a2 2 0 002-2v-.77c1.18-.6 2-1.83 2-3.23 0-1-.54-1.96-1.35-2.53.22-.44.35-.94.35-1.47 0-1.33-.92-2.41-2.4-2.8C15.47 4.3 14.39 3 13 3zm0 2c.94 0 1.66.56 1.92 1.37L15 6.6V8h2v1c0 .55-.45 1-1 1h-1v1h2c0 .86-.37 1.63-.97 2.18L16 13.3V15h-2v2h-2v-2H10v-1.7l-.03-.12C9.37 12.63 9 11.86 9 11H11v-1h-1c-.55 0-1-.45-1-1V8h2V6.6l.08-.23C11.34 5.56 12.06 5 13 5z" />
              </svg>
            </div>
            <h3
              style={{ fontSize: '1.75rem', fontFamily: 'var(--font-manrope)', fontWeight: 700, color: '#f9f9fd', marginBottom: '16px' }}
            >
              Autonomous Scene Direction
            </h3>
            <p style={{ color: '#aaabaf', lineHeight: 1.7, fontSize: '0.9rem' }}>
              Our AI doesn&apos;t just record. It directs. It chooses the best camera angles, identifies
              key features, and adds rhythmic transitions synced to music.
            </p>
          </div>
        </motion.div>

        {/* Card 2: 9-Minute Render — 4 parts */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="flex flex-col items-center justify-center text-center gap-6"
          style={{
            flex: '4',
            background: '#171a1d',
            borderRadius: '16px',
            padding: '40px',
            minHeight: '300px',
          }}
        >
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #b6a0ff, #00e3fd)',
              boxShadow: '0 12px 32px rgba(182,160,255,0.25)',
            }}
          >
            <svg className="w-10 h-10" style={{ color: '#000' }} fill="currentColor" viewBox="0 0 24 24">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <div>
            <h3 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-manrope)', fontWeight: 700, color: '#f9f9fd', marginBottom: '8px' }}>
              9-Minute Render
            </h3>
            <p className="px-4" style={{ color: '#aaabaf', fontSize: '0.875rem', lineHeight: 1.6 }}>
              From URL to export. No queues. No waitlists. Just instant performance.
            </p>
          </div>
        </motion.div>
      </div>

      {/* Row 2: motion card (4) + URL support (8) */}
      <div className="flex flex-col md:flex-row gap-6" style={{ alignItems: 'stretch' }}>

        {/* Card 3: Editor-Grade Motion — 4 parts */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="flex flex-col justify-end"
          style={{
            flex: '4',
            background: '#1d2024',
            borderRadius: '16px',
            padding: '40px',
            minHeight: '220px',
            border: '1px solid rgba(70,72,75,0.15)',
          }}
        >
          <h3 style={{ fontSize: '1.15rem', fontFamily: 'var(--font-manrope)', fontWeight: 700, color: '#f9f9fd', marginBottom: '8px' }}>
            Editor-Grade Motion
          </h3>
          <p style={{ color: '#aaabaf', fontSize: '0.875rem', lineHeight: 1.6, marginBottom: '24px' }}>
            Buttery smooth 60fps motion graphics tailored to your branding.
          </p>
          <div className="flex gap-2">
            {[['#b6a0ff', '#7e51ff'], ['#00e3fd', '#006875'], ['#ff59e3', '#6d0061']].map(([from, to], i) => (
              <div
                key={i}
                className="w-8 h-8 rounded-full"
                style={{
                  background: `linear-gradient(135deg, ${from}33, ${to}33)`,
                  border: `1px solid ${from}66`,
                }}
              />
            ))}
          </div>
        </motion.div>

        {/* Card 4: Universal URL Support — 8 parts */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="flex flex-col sm:flex-row items-center gap-10 overflow-hidden relative group"
          style={{
            flex: '8',
            background: '#0c0e11',
            borderRadius: '16px',
            padding: '40px',
            minHeight: '220px',
            border: '1px solid rgba(70,72,75,0.10)',
          }}
        >
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
            style={{ background: 'rgba(0,227,253,0.03)', borderRadius: '16px' }}
          />

          <div className="flex-1 space-y-4 relative z-10">
            <h3 style={{ fontSize: '1.75rem', fontFamily: 'var(--font-manrope)', fontWeight: 700, color: '#f9f9fd' }}>
              Universal URL Support
            </h3>
            <p style={{ color: '#aaabaf', lineHeight: 1.7, fontSize: '0.9rem' }}>
              Paste from Figma, GitHub, Linear, or your live domain. We handle the rest.
            </p>
          </div>

          <div className="flex-1 hidden sm:grid grid-cols-2 gap-4 relative z-10">
            {[
              { label: 'FIGMA',       color: '#b6a0ff', bg: 'rgba(182,160,255,0.10)', border: 'rgba(182,160,255,0.20)' },
              { label: 'GITHUB',      color: '#00e3fd', bg: 'rgba(0,227,253,0.10)',   border: 'rgba(0,227,253,0.20)'   },
              { label: 'LIVE DOMAIN', color: '#ff59e3', bg: 'rgba(255,89,227,0.10)', border: 'rgba(255,89,227,0.20)'  },
              { label: 'DASHBOARD',   color: '#aaabaf', bg: '#23262a',                border: 'rgba(70,72,75,0.20)'    },
            ].map(({ label, color, bg, border }) => (
              <div
                key={label}
                className="flex items-center justify-center p-4 rounded-xl"
                style={{ background: bg, border: `1px solid ${border}` }}
              >
                <span
                  className="text-xs font-bold tracking-widest"
                  style={{ color, fontFamily: 'var(--font-space-grotesk)' }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
