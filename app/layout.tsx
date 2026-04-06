import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Teaser — Professional launch videos, automatically',
  description:
    'Paste your product URL. Teaser visits your product, records a real demo, writes the script, generates the voiceover, and delivers a publish-ready launch video in under 10 minutes.',
}

/** Root layout. Dark mode only. Geist font. No light mode. */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full bg-[#0A0A0A] text-white">{children}</body>
    </html>
  )
}
