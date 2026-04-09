"use client"

import { motion } from 'framer-motion'

export default function HowItWorks() {
  const steps = [
    {
      id: "01",
      label: "Ingestion",
      title: "URL Parsing",
      desc: "We analyze your provided URL using advanced headless scraping infrastructure to index the DOM state and extract core product capabilities."
    },
    {
      id: "02",
      label: "Planning",
      title: "Graph Generation",
      desc: "An LLM agent constructs a directed acyclic graph (DAG) of your application's user flow, ensuring the recording follows a logical feature demonstration."
    },
    {
      id: "03",
      label: "Execution",
      title: "Playwright Session",
      desc: "A fully automated Chromium instance navigates the flow. It injects synthetic mouse cursors and captures a high-framerate 4K video stream."
    },
    {
      id: "04",
      label: "Assembly",
      title: "FFmpeg Rendering",
      desc: "The raw video is synchronized with an AI-generated script and ElevenLabs voiceover. Subtitles and cinematic zoom effects are composited in real-time."
    }
  ]

  return (
    <section className="px-6 py-24 sm:py-32 bg-[#000000] border-b border-white/5" id="how-it-works">
      <div className="max-w-7xl mx-auto w-full">
        
        <div className="mb-16 md:mb-24 flex flex-col md:flex-row md:items-end justify-between gap-8 border-b border-white/5 pb-12">
          <div className="max-w-xl">
            <div className="text-[11px] font-mono text-white/40 uppercase tracking-widest mb-4">Architecture</div>
            <h2 className="text-3xl md:text-5xl font-medium tracking-tight text-white leading-tight">
              A fully autonomous video pipeline.
            </h2>
          </div>
          <p className="text-sm text-[#888888] max-w-sm leading-relaxed">
            Every step—from DOM traversal to final MP4 encoding—is executed seamlessly in the cloud via scalable worker queues.
          </p>
        </div>

        {/* Clean Spreadsheet Grid */}
        <div className="grid md:grid-cols-4 gap-6">
          {steps.map((step, i) => (
            <motion.div 
              key={step.id}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              viewport={{ once: true }}
              className="group flex flex-col h-full border border-white/10 bg-[#050505] rounded-xl p-8 hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex justify-between items-center mb-12">
                <span className="text-[10px] font-mono text-white/30 px-2 py-1 bg-white/5 rounded-full">{step.id}</span>
                <span className="text-[11px] font-medium text-white/40 uppercase tracking-wider">{step.label}</span>
              </div>
              <div className="mt-auto">
                <h3 className="text-lg font-medium text-white mb-2">{step.title}</h3>
                <p className="text-xs text-[#888888] leading-relaxed">{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

      </div>
    </section>
  )
}
