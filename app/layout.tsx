import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { Manrope } from 'next/font/google'
import { Space_Grotesk } from 'next/font/google'
import './globals.css'

const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
})

const manrope = Manrope({
  variable: '--font-manrope',
  subsets: ['latin'],
  weight: ['400', '700', '800'],
})

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  weight: ['500', '700'],
})

export const metadata: Metadata = {
  title: 'Teaser — Professional launch videos, automatically',
  description:
    'Paste your product URL. Teaser visits your product, records a real demo, writes the script, generates the voiceover, and delivers a publish-ready launch video in under 10 minutes.',
}

/** Root layout. Dark mode only. Geist + Manrope + Space Grotesk fonts. */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${manrope.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#0c0e11] text-[#f9f9fd]">{children}</body>
    </html>
  )
}
