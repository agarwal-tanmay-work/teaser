import Navbar from '@/components/landing/Navbar'
import Hero from '@/components/landing/Hero'
import Problem from '@/components/landing/Problem'
import HowItWorks from '@/components/landing/HowItWorks'
import Features from '@/components/landing/Features'
import Testimonials from '@/components/landing/Testimonials'
import Waitlist from '@/components/landing/Waitlist'
import Footer from '@/components/landing/Footer'

/** The public-facing landing page for Teaser. */
export default function LandingPage() {
  return (
    <main className="bg-[#0A0A0A] min-h-screen">
      <Navbar />
      <Hero />
      <Problem />
      <HowItWorks />
      <Features />
      <Testimonials />
      <Waitlist />
      <Footer />
    </main>
  )
}
