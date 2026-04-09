"use client"

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const faqs = [
  { question: "How long does a video take?", answer: "A typical flow completes in 10 minutes. More complex architectures involving deep authenticated states might extend up to 15 minutes." },
  { question: "Is it a real recording?", answer: "Yes. We spawn a headless Chromium browser instance that physically navigates your product interface. No mockups." },
  { question: "What formats do you support?", answer: "MP4 standard export. Options include 1080p Landscape (16:9), Vertical (9:16) for TikTok, and Square (1:1)." },
  { question: "Can I do authenticated flows?", answer: "Yes, you can configure test suite credentials that our Playwright workers inject before executing the core recording flow." }
]

export default function Testimonials() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section className="px-6 py-24 sm:py-32 bg-[#000000] border-b border-white/5" id="faq">
      <div className="max-w-7xl mx-auto w-full grid md:grid-cols-[1fr_1.5fr] gap-16">
        
        <div>
          <div className="text-[11px] font-mono text-white/40 uppercase tracking-widest mb-4">FAQ</div>
          <h2 className="text-3xl md:text-4xl font-medium tracking-tight text-white">Details & Specs</h2>
        </div>

        <div className="flex flex-col border-t border-white/10">
          {faqs.map((faq, i) => (
            <div key={i} className="border-b border-white/10">
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full py-6 flex justify-between items-center text-left"
              >
                <span className="text-sm font-medium text-white">{faq.question}</span>
                <span className="text-white/40 font-mono text-lg">{openIndex === i ? '−' : '+'}</span>
              </button>
              <AnimatePresence>
                {openIndex === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <p className="pb-6 text-sm text-[#888888] leading-relaxed max-w-lg">{faq.answer}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>

      </div>
    </section>
  )
}
