import Navbar from '@/components/landing/Navbar'
import Hero from '@/components/landing/Hero'
import Features from '@/components/landing/Features'
import Waitlist from '@/components/landing/Waitlist'
import Footer from '@/components/landing/Footer'

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-transparent overflow-x-hidden">
      <Navbar />
      <div className="pt-16">
        <Hero />
        <Features />
        <Waitlist />
      </div>
      <Footer />
    </main>
  )
}
