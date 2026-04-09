'use client'

import Link from 'next/link'

/** Top navigation bar for the landing page. */
export default function Navbar() {
  return (
    <nav className="fixed top-0 w-full z-50 bg-background/70 backdrop-blur-xl border-b border-outline-variant/10">
      <div className="flex justify-between items-center px-8 h-16 w-full max-w-[1440px] mx-auto">
        <Link
          href="/"
          className="font-headline font-bold text-xl bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary"
        >
          Teaser
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="font-label font-bold text-sm text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="font-label font-bold text-sm px-5 py-2 rounded-lg ai-energy-gradient text-[#000] hover:opacity-90 transition-opacity"
          >
            Get started
          </Link>
        </div>
      </div>
    </nav>
  )
}
