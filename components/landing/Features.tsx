interface Feature {
  icon: string
  title: string
  description: string
}

const features: Feature[] = [
  {
    icon: '🎯',
    title: 'Real product recording',
    description:
      'Our AI navigates your actual product and records it. Not fake mockups. Not stock footage. Your real UI, demonstrated perfectly.',
  },
  {
    icon: '✍️',
    title: 'AI-written script',
    description:
      'Gemini writes your narration script based on your product\'s actual features and value proposition. Trained on the style of top ProductHunt launches.',
  },
  {
    icon: '🎙️',
    title: 'Professional voiceover',
    description:
      'Natural AI voices convert your script to professional audio. Multiple voice styles: polished, conversational, or high-energy to match your brand.',
  },
  {
    icon: '✂️',
    title: 'Smart video editing',
    description:
      'Automatic zoom on key UI moments, animated captions, cursor highlights, smooth transitions, background music, and branded intro and outro. All automatic.',
  },
  {
    icon: '🎨',
    title: 'Brand-matched automatically',
    description:
      'Teaser reads your brand colors and logo from your website and uses them in your video. Your video looks like you made it yourself.',
  },
  {
    icon: '📐',
    title: 'Multiple formats instantly',
    description:
      'One generation creates 16:9 for YouTube and landing pages, 9:16 for Instagram and TikTok, and 1:1 for Twitter. All from the same source recording.',
  },
]

/** Grid section showcasing the six core features of Teaser. */
export default function Features() {
  return (
    <section className="py-24 px-6 md:px-12">
      <p className="text-[#6E6E6E] text-sm tracking-widest uppercase text-center mb-4">
        What You Get
      </p>
      <h2 className="text-white text-4xl font-bold text-center mb-16">
        Everything you need. Nothing you don&apos;t.
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="bg-[#111111] border border-[#1F1F1F] rounded-lg p-6"
          >
            <span className="text-3xl">{feature.icon}</span>
            <h3 className="text-white font-semibold text-lg mt-4 mb-2">{feature.title}</h3>
            <p className="text-[#6E6E6E] text-sm leading-relaxed">{feature.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
