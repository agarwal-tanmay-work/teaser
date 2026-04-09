"use client"

import { useState } from 'react'

export default function Footer() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setStatus('loading')

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (res.ok) setStatus('success')
      else setStatus('error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <footer className="bg-surface-container-lowest border-t border-outline-variant/10 py-20 px-8">
      <div className="max-w-[1440px] mx-auto grid grid-cols-1 md:grid-cols-4 gap-12">
        <div className="space-y-6">
          <span className="text-2xl font-headline font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary">Teaser</span>
          <p className="text-on-surface-variant text-sm font-body leading-relaxed">The world's first autonomous video production engine for software founders. Professional results in minutes.</p>
        </div>
        <div>
          <h4 className="font-headline font-bold mb-6">Product</h4>
          <ul className="space-y-4 text-on-surface-variant text-sm font-body">
            <li><a className="hover:text-primary transition-colors" href="#">How it works</a></li>
            <li><a className="hover:text-primary transition-colors" href="#">Showcase</a></li>
            <li><a className="hover:text-primary transition-colors" href="#">Pricing</a></li>
            <li><a className="hover:text-primary transition-colors" href="#">Templates</a></li>
          </ul>
        </div>
        <div>
          <h4 className="font-headline font-bold mb-6">Company</h4>
          <ul className="space-y-4 text-on-surface-variant text-sm font-body">
            <li><a className="hover:text-primary transition-colors" href="#">About Us</a></li>
            <li><a className="hover:text-primary transition-colors" href="#">Careers</a></li>
            <li><a className="hover:text-primary transition-colors" href="#">Blog</a></li>
            <li><a className="hover:text-primary transition-colors" href="#">Contact</a></li>
          </ul>
        </div>
        <div>
          <h4 className="font-headline font-bold mb-6">Stay Updated</h4>
          <form onSubmit={handleSubscribe} className="flex gap-2">
            <input 
              required
              type="email" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={status === 'success'}
              className="bg-surface-container border border-outline-variant/15 rounded-lg px-4 py-2 text-sm w-full focus:ring-1 focus:ring-primary outline-none text-on-surface" 
              placeholder="Email address" 
            />
            <button 
              type="submit"
              disabled={status === 'loading' || status === 'success'}
              className="bg-primary text-on-primary-fixed px-4 py-2 rounded-lg font-bold disabled:opacity-50"
            >
              Join
            </button>
          </form>
          {status === 'success' && <p className="text-primary text-xs mt-2 font-label">Subscribed successfully!</p>}
          {status === 'error' && <p className="text-error text-xs mt-2 font-label">Error subscribing.</p>}
        </div>
      </div>
      <div className="max-w-[1440px] mx-auto mt-20 pt-8 border-t border-outline-variant/10 flex flex-col md:flex-row justify-between items-center gap-6">
        <p className="text-on-surface-variant text-xs font-label uppercase tracking-widest">© 2024 Ethereal Automaton Inc.</p>
        <div className="flex gap-8 text-xs font-label text-on-surface-variant uppercase tracking-widest">
          <a className="hover:text-white transition-colors" href="#">Privacy Policy</a>
          <a className="hover:text-white transition-colors" href="#">Terms of Service</a>
          <a className="hover:text-white transition-colors" href="#">Status</a>
        </div>
      </div>
    </footer>
  )
}
