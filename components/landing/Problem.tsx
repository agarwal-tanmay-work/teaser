interface ProblemCard {
  icon: string
  title: string
  description: string
}

const problems: ProblemCard[] = [
  {
    icon: '❌',
    title: 'Hiring an agency',
    description:
      '$2,000 to $20,000 and two to three weeks. Most early-stage startups simply cannot afford this and waste weeks just getting quotes.',
  },
  {
    icon: '⏰',
    title: 'DIY screen recording',
    description:
      'You record, you edit, you add captions, music, and voiceover. Requires skills most founders do not have. Takes days. Usually looks amateur.',
  },
  {
    icon: '🚀',
    title: 'Skipping it entirely',
    description:
      'Most founders launch with no video or something they are embarrassed to share. First impressions matter. A bad video costs customers.',
  },
]

/** Section that highlights the three painful alternatives to Teaser. */
export default function Problem() {
  return (
    <section className="py-24 px-6 md:px-12">
      <p className="text-[#6E6E6E] text-sm tracking-widest uppercase text-center mb-4">
        The Problem
      </p>
      <h2 className="text-white text-4xl font-bold text-center mb-16">
        Making a launch video shouldn&apos;t take days
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {problems.map((problem) => (
          <div
            key={problem.title}
            className="bg-[#111111] border border-[#1F1F1F] rounded-lg p-6"
          >
            <span className="text-3xl">{problem.icon}</span>
            <h3 className="text-white font-semibold text-lg mt-4 mb-2">{problem.title}</h3>
            <p className="text-[#6E6E6E] text-sm leading-relaxed">{problem.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
