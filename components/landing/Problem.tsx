"use client"

import { motion } from 'framer-motion'

export default function Problem() {
  const problems = [
    {
      title: "Prohibitive Agency Costs",
      desc: "Hiring a video agency costs upward of $5,000 and requires 3 weeks of back-and-forth. This model is broken for early-stage software launches."
    },
    {
      title: "DIY Tool Fragmentation",
      desc: "Founders end up juggling ScreenFlow, Premiere Pro, ElevenLabs, and CapCut. It's a 10-hour distraction from writing code."
    },
    {
      title: "The Silent Launch",
      desc: "Due to the friction, 80% of startups launch with static screenshots, fundamentally limiting their top-of-funnel conversion."
    }
  ]

  return (
    <section className="px-6 py-24 sm:py-32 bg-[#000000] border-b border-white/5">
      <div className="max-w-7xl mx-auto w-full grid md:grid-cols-[1fr_1.5fr] gap-16 lg:gap-32">
        
        {/* Abstract / Title side */}
        <div className="flex flex-col items-start">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-[11px] font-mono text-white/40 uppercase tracking-widest mb-4"
          >
            The Problem
          </motion.div>
          <motion.h2 
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl md:text-4xl font-medium tracking-tight text-white mb-6 leading-tight"
          >
            Video marketing is stuck in the hardware era.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            viewport={{ once: true }}
            className="text-[#888888] text-sm leading-relaxed"
          >
            Software teams iterate daily. Product launches happen weekly. Yet video production remains a manual, monolithic process. We built Teaser to fix this asymmetry.
          </motion.p>
        </div>

        {/* Dense List side */}
        <div className="flex flex-col gap-10">
          {problems.map((prob, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              viewport={{ once: true }}
              className="flex flex-col items-start border-l border-white/10 pl-6"
            >
              <h3 className="text-lg font-medium text-white mb-2">{prob.title}</h3>
              <p className="text-sm text-[#888888] leading-relaxed max-w-lg">{prob.desc}</p>
            </motion.div>
          ))}
        </div>

      </div>
    </section>
  )
}
