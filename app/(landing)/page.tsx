import Navbar from '@/components/landing/Navbar'
import Hero from '@/components/landing/Hero'
import Features from '@/components/landing/Features'
import Waitlist from '@/components/landing/Waitlist'
import Footer from '@/components/landing/Footer'

/** The public-facing landing page for Teaser. */
export default function LandingPage() {
  return (
    <main className="min-h-screen" style={{ background: '#0c0e11' }}>
      <Navbar />
      <Hero />
      <Features />
      <Waitlist />
      <Footer />
    </main>
  )
}
