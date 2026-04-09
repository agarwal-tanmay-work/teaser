'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase'

type SignupState = 'form' | 'check-email'

/**
 * Signup page. Creates a new Supabase account with email + password.
 * If email confirmation is enabled, shows a "check your inbox" screen.
 * Otherwise redirects straight to /dashboard.
 */
export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<SignupState>('form')

  const supabase = createBrowserClient()

  /** Submits new account details to Supabase Auth. */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)

    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    // If a session exists immediately, email confirmation is disabled — go straight in
    if (data.session) {
      router.push('/dashboard')
      router.refresh()
      return
    }

    // Otherwise show the confirmation prompt
    setState('check-email')
    setLoading(false)
  }

  if (state === 'check-email') {
    return (
      <div className="w-full max-w-sm text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-surface-container-low border border-outline-variant/20 flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="font-headline font-bold text-2xl text-on-surface">Check your inbox</h1>
        <p className="text-on-surface-variant font-body text-sm leading-relaxed">
          We sent a confirmation link to{' '}
          <span className="text-on-surface font-medium">{email}</span>.
          Click the link to activate your account and you'll be taken straight to your dashboard.
        </p>
        <p className="text-on-surface-variant font-body text-xs pt-2">
          Already confirmed?{' '}
          <Link href="/login" className="text-primary hover:text-primary-fixed-dim transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="font-headline font-bold text-2xl text-on-surface mb-2">
          Create your account
        </h1>
        <p className="text-on-surface-variant font-body text-sm">
          Free to start. URL in, professional video out.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block font-label text-xs uppercase tracking-wider text-on-surface-variant mb-1.5">
            Email
          </label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourproduct.com"
            className="w-full px-4 py-3 rounded-lg bg-surface-container border border-outline-variant/20 text-on-surface placeholder:text-on-surface-variant/50 font-body text-sm outline-none focus:border-primary/60 transition-colors"
          />
        </div>

        <div>
          <label className="block font-label text-xs uppercase tracking-wider text-on-surface-variant mb-1.5">
            Password
          </label>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            className="w-full px-4 py-3 rounded-lg bg-surface-container border border-outline-variant/20 text-on-surface placeholder:text-on-surface-variant/50 font-body text-sm outline-none focus:border-primary/60 transition-colors"
          />
        </div>

        {error && (
          <p className="text-sm font-body text-error">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-lg font-headline font-bold text-sm ai-energy-gradient text-[#000] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
              Creating account...
            </>
          ) : (
            'Create free account'
          )}
        </button>

        <p className="text-center text-on-surface-variant/60 font-body text-xs">
          By signing up you agree to our Terms of Service.
        </p>
      </form>

      {/* Divider */}
      <div className="my-6 flex items-center gap-3">
        <div className="flex-1 h-px bg-outline-variant/20" />
        <span className="text-on-surface-variant text-xs font-label">or</span>
        <div className="flex-1 h-px bg-outline-variant/20" />
      </div>

      {/* Switch to login */}
      <p className="text-center text-on-surface-variant font-body text-sm">
        Already have an account?{' '}
        <Link href="/login" className="text-primary hover:text-primary-fixed-dim transition-colors font-medium">
          Sign in
        </Link>
      </p>
    </div>
  )
}
