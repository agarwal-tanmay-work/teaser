'use client'

import { motion } from 'framer-motion'

interface Testimonial {
  initials: string
  name: string
  role: string
  quote: string
  stars: number
}

const testimonials: Testimonial[] = [
  {
    initials: 'AK',
    name: 'Arjun Kapoor',
    role: 'Founder at BuildFast',
    quote:
      'I spent two days trying to make a decent launch video. Teaser did it in 8 minutes and it looks 10x better than what I produced.',
    stars: 5,
  },
  {
    initials: 'SL',
    name: 'Sarah Lin',
    role: 'CEO at DataLoop',
    quote:
      'Our agency quote was $8,000 and a 3-week timeline. Teaser cost us $49 and the video was ready before our meeting ended.',
    stars: 5,
  },
  {
    initials: 'MR',
    name: 'Marcus Reid',
    role: 'Indie Hacker',
    quote:
      "I cannot edit videos. I never could. Teaser gave me a professional launch video I'm actually proud to share on Product Hunt.",
    stars: 5,
  },
]

const avatarGradients = [
  { from: '#b6a0ff', to: '#7e51ff' },
  { from: '#00e3fd', to: '#006875' },
  { from: '#b6a0ff', to: '#00e3fd' },
]

/** Star rating component. */
function Stars({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-0.5 mb-4">
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} className="w-4 h-4 text-[#FFBD2E]" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  )
}

/** Section displaying founder testimonials with scroll animations and star ratings. */
export default function Testimonials() {
  return (
    <section className="relative py-32 px-6 md:px-12 overflow-hidden">
      {/* Background glow */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-[#b6a0ff]/8 blur-[100px] rounded-full pointer-events-none" />

      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="text-[#f9f9fd] text-4xl md:text-5xl font-extrabold text-center mb-4 tracking-tight"
        style={{ fontFamily: 'var(--font-manrope)' }}
      >
        What founders are saying
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.05 }}
        className="text-[#aaabaf] text-lg text-center mb-16 max-w-lg mx-auto"
      >
        Early users are replacing $8,000 agency quotes with a $49 subscription.
      </motion.p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
        {testimonials.map((t, i) => {
          const grad = avatarGradients[i % avatarGradients.length]
          return (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.6, delay: i * 0.15, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className="group relative bg-[#171a1d] rounded-2xl p-7 overflow-hidden cursor-default"
            >
              {/* Hover: violet tint */}
              <div className="absolute inset-0 bg-[#b6a0ff]/[0.04] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-2xl" />

              <Stars count={t.stars} />

              <p className="text-[#f9f9fd]/80 text-sm leading-relaxed mb-6 italic">
                &ldquo;{t.quote}&rdquo;
              </p>

              <div className="flex items-center gap-3 pt-5 border-t border-[rgba(70,72,75,0.2)]">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${grad.from}33, ${grad.to}33)`,
                    border: `1px solid ${grad.from}40`,
                  }}
                >
                  <span
                    className="text-xs font-bold"
                    style={{ color: grad.from, fontFamily: 'var(--font-space-grotesk)' }}
                  >
                    {t.initials}
                  </span>
                </div>
                <div>
                  <p className="text-[#f9f9fd] font-semibold text-sm">{t.name}</p>
                  <p className="text-[#aaabaf] text-xs">{t.role}</p>
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
