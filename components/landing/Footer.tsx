/** Site footer with logo, navigation links, and copyright. */
export default function Footer() {
  return (
    <footer className="border-t border-[#1F1F1F] py-12 px-6 md:px-12">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
        {/* Logo and tagline */}
        <div className="flex flex-col items-center md:items-start gap-1">
          <span className="text-[#6E6E6E] font-semibold">Teaser</span>
          <span className="text-[#6E6E6E] text-sm">Paste a link. Get a launch video.</span>
        </div>

        {/* Navigation links */}
        <nav className="flex flex-wrap justify-center gap-6">
          {['Product', 'How it works', 'Pricing (coming soon)', 'Twitter', 'LinkedIn'].map(
            (link) => (
              <a
                key={link}
                href="#"
                className="text-[#6E6E6E] text-sm hover:text-white transition-colors"
              >
                {link}
              </a>
            )
          )}
        </nav>

        {/* Copyright */}
        <p className="text-[#6E6E6E] text-sm">© 2025 Teaser. All rights reserved.</p>
      </div>
    </footer>
  )
}
