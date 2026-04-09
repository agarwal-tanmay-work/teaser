'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient as createSSRBrowserClient } from '@supabase/ssr'

/** Creates a Supabase browser client for use in client components. */
function getSupabase() {
  return createSSRBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

type SignupState = 'form' | 'check-email'

/** Inner form — uses useSearchParams so must be inside Suspense. */
function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<SignupState>('form')

  /** Google OAuth. */
  async function handleGoogleSignIn() {
    const supabase = getSupabase()
    const next = searchParams.get('next') ?? '/dashboard'
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
  }

  /** Submits new account details to Supabase Auth. */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)

    const supabase = getSupabase()
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

    // Session exists immediately → email confirmation is disabled, go straight in
    if (data.session) {
      router.push('/dashboard')
      router.refresh()
      return
    }

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
          Click the link to activate your account — you'll land straight on your dashboard.
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
      <div className="mb-8 text-center">
        <h1 className="font-headline font-bold text-2xl text-on-surface mb-2">Create your account</h1>
        <p className="text-on-surface-variant font-body text-sm">Free to start. URL in, professional video out.</p>
      </div>

      {/* Google */}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        className="w-full flex items-center justify-center gap-3 py-3 rounded-lg bg-surface-container border border-outline-variant/20 text-on-surface font-label font-bold text-sm hover:bg-surface-container-high transition-colors"
      >
        <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google
      </button>

      {/* Divider */}
      <div className="my-5 flex items-center gap-3">
        <div className="flex-1 h-px bg-outline-variant/20" />
        <span className="text-on-surface-variant text-xs font-label">or continue with email</span>
        <div className="flex-1 h-px bg-outline-variant/20" />
      </div>

      {/* Email + password form */}
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

        {error && <p className="text-sm font-body text-error">{error}</p>}

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

      <p className="mt-6 text-center text-on-surface-variant font-body text-sm">
        Already have an account?{' '}
        <Link href="/login" className="text-primary hover:text-primary-fixed-dim transition-colors font-medium">
          Sign in
        </Link>
      </p>
    </div>
  )
}

/**
 * Signup page — wrapped in Suspense because the inner form uses useSearchParams.
 */
export default function SignupPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-sm h-96 animate-pulse rounded-lg bg-surface-container" />}>
      <SignupForm />
    </Suspense>
  )
}
