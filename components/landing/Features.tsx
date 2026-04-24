/* eslint-disable @next/next/no-img-element */

export default function Features() {
  return (
    <section className="max-w-[1440px] mx-auto px-8 py-32 space-y-16">
      <div className="max-w-2xl">
        <h2 className="text-4xl font-headline font-bold mb-4">Magic in every frame.</h2>
        <p className="text-on-surface-variant font-body">Our automaton analyzes your UI patterns, typography, and brand colors to generate a bespoke launch trailer that looks like it cost $20k.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 h-auto md:min-h-[600px]">
        {/* Feature 1: The AI Brain */}
        <div className="md:col-span-8 bg-surface-container-low rounded-2xl p-10 flex flex-col justify-between overflow-hidden relative group">
          <div className="relative z-10 max-w-sm">
            <span className="material-symbols-outlined text-primary text-4xl mb-6">psychology</span>
            <h3 className="text-3xl font-headline font-bold mb-4">Autonomous Scene Direction</h3>
            <p className="text-on-surface-variant font-body leading-relaxed">Our AI doesn&apos;t just record. It directs. It chooses the best camera angles, identifies key features, and adds rhythmic transitions synced to music.</p>
          </div>
          <div className="absolute bottom-0 right-0 w-1/2 h-full opacity-50 group-hover:opacity-80 transition-opacity">
            <img alt="Neural network visualization" className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDTA6Fgy_OXBkS9NCHTWbRn93XEuOQR-0mjVQu2s6D5_mHil2kd_8Ww6u2LwjT9Rr1-Bjr4RBLtFHqEPdnQ4OfDpc4AP51IcxjYcajudr94tmQJ_-LjBDuxXeB3uqhVGrfJbz8FthNU5s5C7ulSFl0SFzKABZRhTgVRtk89OeEGrQ13enuuNs-nPfuzovEW7ZNm7e7a4QN_kzfgRYadnyeTxsVtUDUo9zOxLGBvBP-SOszh181YUEdutgUzPKQGL-ht_xZK05jbGdA"/>
          </div>
        </div>
        {/* Feature 2: Speed */}
        <div className="md:col-span-4 bg-surface-container rounded-2xl p-10 flex flex-col items-center justify-center text-center gap-6 border border-outline-variant/10">
          <div className="w-24 h-24 rounded-full ai-energy-gradient flex items-center justify-center">
            <span className="material-symbols-outlined text-on-primary-fixed text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
          </div>
          <div>
            <h3 className="text-2xl font-headline font-bold mb-2">9-Minute Render</h3>
            <p className="text-on-surface-variant font-body text-sm px-4">From URL to export. No queues. No waitlists. Just instant performance.</p>
          </div>
        </div>
        {/* Feature 3: Style */}
        <div className="md:col-span-4 bg-surface-container-high rounded-2xl p-10 flex flex-col justify-end border border-outline-variant/15">
          <h3 className="text-xl font-headline font-bold mb-2">Editor-Grade Motion</h3>
          <p className="text-on-surface-variant font-body text-sm">Buttery smooth 60fps motion graphics tailored to your branding.</p>
          <div className="mt-8 flex gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/40"></div>
            <div className="w-8 h-8 rounded-full bg-secondary/20 border border-secondary/40"></div>
            <div className="w-8 h-8 rounded-full bg-tertiary/20 border border-tertiary/40"></div>
          </div>
        </div>
        {/* Feature 4: Integration */}
        <div className="md:col-span-8 bg-surface rounded-2xl p-10 flex items-center gap-10 border border-outline-variant/10 overflow-hidden relative">
          <div className="flex-1 space-y-4">
            <h3 className="text-3xl font-headline font-bold">Universal URL Support</h3>
            <p className="text-on-surface-variant font-body">Paste from Figma, GitHub, Linear, or your live domain. We handle the rest.</p>
          </div>
          <div className="flex-1 hidden sm:grid grid-cols-2 gap-4">
            <div className="bg-surface-container-highest p-4 rounded-xl flex items-center justify-center font-label text-xs tracking-widest text-primary border border-primary/20">FIGMA</div>
            <div className="bg-surface-container-highest p-4 rounded-xl flex items-center justify-center font-label text-xs tracking-widest text-secondary border border-secondary/20">GITHUB</div>
            <div className="bg-surface-container-highest p-4 rounded-xl flex items-center justify-center font-label text-xs tracking-widest text-tertiary border border-tertiary/20">LIVE DOMAIN</div>
            <div className="bg-surface-container-highest p-4 rounded-xl flex items-center justify-center font-label text-xs tracking-widest text-on-surface-variant border border-outline-variant/20">DASHBOARD</div>
          </div>
        </div>
      </div>
    </section>
  )
}
