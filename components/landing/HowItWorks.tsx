'use client'

import { motion } from 'framer-motion'

interface Step {
  number: number
  icon: string
  title: string
  description: string
}

const steps: Step[] = [
  {
    number: 1,
    icon: '🔗',
    title: 'Paste your URL',
    description:
      'Give us your product link. Optionally add a description and select your video length and tone. That is everything you need to do.',
  },
  {
    number: 2,
    icon: '🤖',
    title: 'AI does everything',
    description:
      'Our AI reads your product, navigates it like a real user, records the demo, writes a script tailored to your features, and generates a professional voiceover. All automatically.',
  },
  {
    number: 3,
    icon: '🎬',
    title: 'Download your video',
    description:
      'Your publish-ready MP4 video is ready in under 10 minutes. Download in 16:9 for YouTube, 9:16 for social, or 1:1 for Twitter. Share immediately.',
  },
]

/** Section that explains the three-step process with staggered scroll animations. */
export default function HowItWorks() {
  return (
    <section className="py-24 px-6 md:px-12">
      <p className="text-[#6E6E6E] text-sm tracking-widest uppercase text-center mb-4">
        How It Works
      </p>
      <h2 className="text-white text-4xl font-bold text-center mb-16">
        Three steps. Zero effort.
      </h2>

      <div className="relative max-w-5xl mx-auto">
        {/* Connecting line (desktop only) */}
        <div className="hidden md:block absolute top-8 left-[calc(16.666%+1rem)] right-[calc(16.666%+1rem)] h-px bg-[#1F1F1F]" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {steps.map((step, index) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.5, delay: index * 0.2 }}
              className="flex flex-col items-center text-center"
            >
              {/* Step number circle */}
              <div className="relative z-10 w-16 h-16 rounded-full bg-[#111111] border border-[#1F1F1F] flex items-center justify-center text-white font-bold text-lg mb-6">
                {step.number}
              </div>
              <span className="text-3xl mb-4">{step.icon}</span>
              <h3 className="text-white font-semibold text-lg mb-2">{step.title}</h3>
              <p className="text-[#6E6E6E] text-sm leading-relaxed">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
