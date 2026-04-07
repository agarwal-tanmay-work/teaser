'use client'

import { motion } from 'framer-motion'

interface ProblemCard {
  icon: string
  title: string
  description: string
  cost: string
}

const problems: ProblemCard[] = [
  {
    icon: '🏢',
    title: 'Hire a video agency',
    description:
      '$2,000–$20,000 and two to three weeks. Most early-stage startups simply cannot afford this and waste weeks just getting quotes.',
    cost: '$2k–$20k · 2–3 weeks',
  },
  {
    icon: '🎬',
    title: 'DIY screen recording',
    description:
      "You record, you edit, you add captions, music, and voiceover. Requires skills most founders don't have. Takes days. Usually looks amateur.",
    cost: 'Days of work · Looks amateurish',
  },
  {
    icon: '❌',
    title: 'Launch without one',
    description:
      "Most founders launch with no video or something they're embarrassed to share. First impressions matter. A bad video costs you customers.",
    cost: 'Lost conversions · Weak impression',
  },
]

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15 } },
}

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

const cardVariants = {
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
}

/** Section that highlights the three painful alternatives to Teaser. */
export default function Problem() {
  return (
    <section className="relative py-32 px-6 md:px-12 overflow-hidden bg-[#111417]">
      {/* Subtle violet ambient */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[200px] bg-[#b6a0ff]/5 blur-[100px] rounded-full pointer-events-none" />

      {/* Section label */}
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="text-[#aaabaf] text-xs tracking-[0.2em] uppercase text-center mb-4 font-medium"
        style={{ fontFamily: 'var(--font-space-grotesk)' }}
      >
        The Problem
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.05 }}
        className="text-[#f9f9fd] text-4xl md:text-5xl font-extrabold text-center mb-4 tracking-tight"
        style={{ fontFamily: 'var(--font-manrope)' }}
      >
        Making a launch video is painful
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="text-[#aaabaf] text-lg text-center mb-16 max-w-xl mx-auto leading-relaxed"
      >
        Every option is either too expensive, too slow, or too embarrassing.
      </motion.p>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto"
      >
        {problems.map((problem) => (
          <motion.div
            key={problem.title}
            variants={cardVariants}
            whileHover={{ y: -4, transition: { duration: 0.2 } }}
            className="group relative bg-[#171a1d] rounded-2xl p-8 overflow-hidden cursor-default"
          >
            {/* Hover: subtle red tint */}
            <div className="absolute inset-0 bg-[#EF4444]/[0.04] opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl pointer-events-none" />

            <span className="text-3xl block mb-6">{problem.icon}</span>

            <div
              className="inline-flex items-center px-3 py-1 rounded-full bg-[#EF4444]/10 mb-4"
            >
              <span
                className="text-[#EF4444] text-xs font-medium"
                style={{ fontFamily: 'var(--font-space-grotesk)' }}
              >
                {problem.cost}
              </span>
            </div>

            <h3
              className="text-[#f9f9fd] font-bold text-xl mb-3"
              style={{ fontFamily: 'var(--font-manrope)' }}
            >
              {problem.title}
            </h3>
            <p className="text-[#aaabaf] text-sm leading-relaxed">{problem.description}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}
