"use client"

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Hero() {
  const [url, setUrl] = useState('')
  const router = useRouter()

  const handleCreateVideo = () => {
    if (url.trim()) {
      router.push(`/login?next=/dashboard&url=${encodeURIComponent(url.trim())}`)
    } else {
      router.push('/login')
    }
  }

  const handleOpenLink = () => {
    if (url.trim() && (url.startsWith('https://') || url.startsWith('http://'))) {
      window.open(url, '_blank')
    }
  }

  return (
    <section className="relative min-h-[921px] flex flex-col items-center justify-center px-6 text-center">
      {/* Background Magic */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -z-10 w-[800px] h-[400px] bg-primary/10 blur-[120px] rounded-full"></div>
      <div className="absolute bottom-1/4 left-1/3 -z-10 w-[600px] h-[300px] bg-secondary/5 blur-[100px] rounded-full"></div>
      
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-container-low border border-outline-variant/15">
          <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse shadow-[0_0_8px_#ff05e5]"></span>
          <span className="font-label text-xs uppercase tracking-widest text-on-surface-variant">Zero effort, under 10 minutes</span>
        </div>
        <h1 className="text-5xl md:text-7xl lg:text-8xl font-headline font-extrabold tracking-tighter leading-[1.1]">
          URL in. <br />
          <span className="ai-energy-text">Professional launch video</span> out.
        </h1>
        <p className="text-lg md:text-xl text-on-surface-variant font-body max-w-2xl mx-auto leading-relaxed">
          0 editing skills. 0 screen recording. 0 agency. <br className="hidden md:block" />
          Transform your product link into a cinematic masterpiece instantly.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
          <button onClick={handleCreateVideo} className="ai-energy-gradient px-8 py-4 rounded-xl font-headline font-bold text-on-primary-fixed hover:scale-105 transition-transform shadow-lg shadow-primary/20 block">
            Get Started for Free
          </button>
          <a href="#view-showreel" className="px-8 py-4 rounded-xl font-headline font-bold text-on-surface bg-surface-bright border border-outline-variant/15 hover:bg-surface-container transition-colors block">
            View Showreel
          </a>
        </div>
      </div>

      {/* Transformation Visual */}
      <div className="mt-20 w-full max-w-5xl mx-auto relative px-4" id="view-showreel">
        <div className="bg-surface-container-low p-2 rounded-2xl border border-outline-variant/15 shadow-2xl relative z-10">
          <div className="flex flex-col lg:flex-row gap-4 items-stretch">
            {/* Input Side */}
            <div className="flex-1 bg-surface-container rounded-xl p-8 flex flex-col justify-center gap-6">
              <div className="flex items-center gap-3">
                <button title="Open this website" onClick={handleOpenLink} className="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center hover:scale-105 transition-transform cursor-pointer shadow-md">
                  <span className="material-symbols-outlined text-secondary">link</span>
                </button>
                <div className="text-left">
                  <p className="font-label text-[10px] text-secondary uppercase tracking-widest">Input source</p>
                  <p className="font-headline font-bold">Paste Product URL</p>
                </div>
              </div>
              <div className="relative group flex items-center">
                <input 
                  className="w-full bg-surface-container-highest border border-outline-variant/30 rounded-lg px-4 py-3 font-body text-on-surface-variant outline-none focus:ring-2 focus:ring-primary/50 relative z-10 text-sm" 
                  type="url" 
                  placeholder="https://teaser.ai/new-launch"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateVideo();
                  }}
                />
                <div className="absolute inset-0 bg-primary/5 rounded-lg pointer-events-none group-hover:opacity-100 opacity-0 transition-opacity"></div>
              </div>
            </div>
            {/* Transition Arrow */}
            <button title="Start generating" onClick={handleCreateVideo} className="lg:flex items-center justify-center hidden cursor-pointer hover:scale-110 transition-transform">
              <div className="w-12 h-12 rounded-full ai-energy-gradient flex items-center justify-center shadow-lg">
                <span className="material-symbols-outlined text-on-primary-fixed">arrow_forward</span>
              </div>
            </button>
            {/* Output Side */}
            <button onClick={handleCreateVideo} className="flex-[1.5] relative group aspect-video lg:aspect-auto cursor-pointer block w-full text-left p-0 border-none outline-none">
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent z-10 rounded-xl"></div>
              <img alt="Video transformation preview" className="w-full h-full object-cover rounded-xl grayscale group-hover:grayscale-0 transition-all duration-700" src="https://lh3.googleusercontent.com/aida-public/AB6AXuD6i-jX1F0Hwww3mCpP1lqwrhFOXaZ59wOSbuecT4822D1q_Xn2wFhmviBWnY5X508OY2ZBbOvXOhY6A53Av5ht9yH6j4nmoXoU9ogo87HzpDI6Kqawif3YZzTO-nyglE-KpngFUaIZjGNK5E1Mc3hCqCHsa4apyj8pDp98qmK9GHqS6fv52TGcmVKSxiYsUJUUL-mw1DQXW2asqucH9rzT2MRYOOrx0M_peocBj_rMYFYqCmfQImuo0K8IiwULTxgRnwX4lvdrYsI" />
              <div className="absolute inset-0 flex items-center justify-center z-20">
                <div className="w-16 h-16 rounded-full glass-panel flex items-center justify-center border border-white/20 group-hover:scale-110 transition-transform shadow-[0_0_15px_rgba(255,255,255,0.1)]">
                  <span className="material-symbols-outlined text-white text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
                </div>
              </div>
              <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2">
                <div className="px-3 py-1 rounded bg-secondary/20 backdrop-blur-md border border-secondary/30">
                  <span className="font-label text-[10px] text-secondary font-bold">4K READY</span>
                </div>
                <div className="px-3 py-1 rounded bg-white/10 backdrop-blur-md border border-white/20">
                  <span className="font-label text-[10px] text-white">GENERATING... 88%</span>
                </div>
              </div>
            </button>
          </div>
        </div>
        {/* Floating Accents */}
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-tertiary/10 blur-[60px] rounded-full hidden lg:block pointer-events-none"></div>
        <div className="absolute -bottom-8 -left-8 w-64 h-64 bg-secondary/10 blur-[80px] rounded-full hidden lg:block pointer-events-none"></div>
      </div>
    </section>
  )
}
