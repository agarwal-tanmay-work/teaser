'use client'

/** Fixed top navigation bar with logo and waitlist CTA button. */
export default function Navbar() {
  /** Smoothly scrolls the page to the #waitlist section. */
  function scrollToWaitlist() {
    document.getElementById('waitlist')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-16 flex items-center justify-between px-6 md:px-12 bg-[#0A0A0A]/80 backdrop-blur-sm border-b border-[#1F1F1F]">
      <span className="text-white font-semibold text-lg">Teaser</span>
      <button
        onClick={scrollToWaitlist}
        className="px-4 py-2 text-white text-sm border border-[#1F1F1F] rounded-md bg-transparent hover:bg-[#111111] transition-colors"
      >
        Join the waitlist
      </button>
    </nav>
  )
}
