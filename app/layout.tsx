import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Teaser - URL to Professional Launch Video',
  description: 'Transform your product link into a cinematic masterpiece instantly.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark antialiased h-full">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;700;800&family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-full bg-background text-on-background selection:bg-primary selection:text-on-primary">
        {children}
      </body>
    </html>
  )
}
