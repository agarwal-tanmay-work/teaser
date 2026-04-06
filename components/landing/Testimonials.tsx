interface Testimonial {
  initials: string
  name: string
  role: string
  quote: string
}

// PLACEHOLDER TESTIMONIAL
const testimonials: Testimonial[] = [
  // PLACEHOLDER TESTIMONIAL
  {
    initials: 'AK',
    name: 'Arjun Kapoor',
    role: 'Founder at BuildFast',
    quote:
      'I spent two days trying to make a decent launch video. Teaser did it in 8 minutes and it looks 10x better.',
  },
  // PLACEHOLDER TESTIMONIAL
  {
    initials: 'SL',
    name: 'Sarah Lin',
    role: 'CEO at DataLoop',
    quote:
      'Our agency quote was $8,000. Teaser cost us $49 and the video was ready before the meeting ended.',
  },
  // PLACEHOLDER TESTIMONIAL
  {
    initials: 'MR',
    name: 'Marcus Reid',
    role: 'Indie Hacker',
    quote:
      'I cannot edit videos. I never could. Teaser gave me a launch video I am actually proud to share.',
  },
]

/** Section displaying placeholder founder testimonials. All cards are placeholders. */
export default function Testimonials() {
  return (
    <section className="py-24 px-6 md:px-12">
      <h2 className="text-white text-4xl font-bold text-center mb-16">
        What founders are saying
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {testimonials.map((t) => (
          <div
            key={t.name}
            className="bg-[#111111] border border-[#1F1F1F] rounded-lg p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[#111111] border border-[#1F1F1F] flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                {t.initials}
              </div>
              <div>
                <p className="text-white font-semibold text-sm">{t.name}</p>
                <p className="text-[#6E6E6E] text-xs">{t.role}</p>
              </div>
            </div>
            <p className="text-[#6E6E6E] text-sm leading-relaxed">&ldquo;{t.quote}&rdquo;</p>
          </div>
        ))}
      </div>
    </section>
  )
}
