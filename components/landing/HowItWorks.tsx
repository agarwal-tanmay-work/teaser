'use client'

import { motion } from 'framer-motion'

interface Step {
  number: number
  icon: string
  title: string
  description: string
  detail: string
}

const steps: Step[] = [
  {
    number: 1,
    icon: '🔗',
    title: 'Paste your URL',
    description:
      "Give us your product link. Optionally add a short description and choose your video tone. That's all you do.",
    detail: '< 60 seconds setup',
  },
  {
    number: 2,
    icon: '🤖',
    title: 'AI does everything',
    description:
      'Our AI reads your product, navigates it like a real user, records the demo, writes a script tailored to your features, and generates a professional voiceover.',
    detail: '8–10 minutes end-to-end',
  },
  {
    number: 3,
    icon: '🎬',
    title: 'Download your video',
    description:
      'Your publish-ready MP4 arrives in your dashboard. Download in 16:9 for YouTube, 9:16 for social, or 1:1 for Twitter. Share immediately.',
    detail: 'Multiple formats included',
  },
]

/** Section that explains the three-step process with staggered scroll animations. */
export default function HowItWorks() {
  return (
    <section className="relative py-32 px-6 md:px-12 overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[300px] bg-[#00e3fd]/5 blur-[120px] rounded-full pointer-events-none" />

      <motion.p
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="text-[#aaabaf] text-xs tracking-[0.2em] uppercase text-center mb-4"
        style={{ fontFamily: 'var(--font-space-grotesk)' }}
      >
        How It Works
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.05 }}
        className="text-[#f9f9fd] text-4xl md:text-5xl font-extrabold text-center mb-4 tracking-tight"
        style={{ fontFamily: 'var(--font-manrope)' }}
      >
        Three steps. Zero effort.
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="text-[#aaabaf] text-lg text-center mb-20 max-w-lg mx-auto leading-relaxed"
      >
        You paste a link. We handle everything else — no editing, no recording, no skills needed.
      </motion.p>

      <div className="relative max-w-5xl mx-auto">
        {/* Desktop connector line with gradient */}
        <div className="hidden md:block absolute top-8 left-[calc(16.666%+2rem)] right-[calc(16.666%+2rem)] h-px">
          <motion.div
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1, delay: 0.4, ease: 'easeInOut' }}
            className="h-full origin-left"
            style={{ background: 'linear-gradient(90deg, #b6a0ff40, #00e3fd40)' }}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          {steps.map((step, index) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.6, delay: index * 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col items-center text-center"
            >
              {/* Step circle with gradient border */}
              <div className="relative z-10 mb-8">
                <div
                  className="absolute inset-0 rounded-full blur-lg opacity-40"
                  style={{ background: 'linear-gradient(135deg, #b6a0ff, #00e3fd)' }}
                />
                <div
                  className="relative w-16 h-16 rounded-full bg-[#171a1d] flex items-center justify-center font-bold text-lg shadow-[0_0_20px_rgba(182,160,255,0.15)]"
                  style={{
                    background: 'linear-gradient(#171a1d, #171a1d) padding-box, linear-gradient(135deg, #b6a0ff, #00e3fd) border-box',
                    border: '2px solid transparent',
                  }}
                >
                  <span className="ai-energy-text font-extrabold text-lg" style={{ fontFamily: 'var(--font-manrope)' }}>
                    {step.number}
                  </span>
                </div>
              </div>

              {/* Icon */}
              <span className="text-4xl mb-5 block">{step.icon}</span>

              {/* Detail badge */}
              <div className="inline-flex items-center px-3 py-1 rounded-full bg-[#b6a0ff]/10 mb-4">
                <span
                  className="text-[#b6a0ff] text-xs"
                  style={{ fontFamily: 'var(--font-space-grotesk)' }}
                >
                  {step.detail}
                </span>
              </div>

              <h3
                className="text-[#f9f9fd] font-bold text-xl mb-3"
                style={{ fontFamily: 'var(--font-manrope)' }}
              >
                {step.title}
              </h3>
              <p className="text-[#aaabaf] text-sm leading-relaxed">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
