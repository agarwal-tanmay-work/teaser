'use client'

import { useState, useEffect, Suspense } from 'react'
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

/** Google OAuth sign-in button — shared by login and signup. */
function GoogleButton({ label }: { label: string }) {
  const searchParams = useSearchParams()

  async function handleGoogleSignIn() {
    const supabase = getSupabase()
    const next = searchParams.get('next') ?? '/dashboard'
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
  }

  return (
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
      {label}
    </button>
  )
}

/** Inner form — uses useSearchParams so must be inside Suspense. */
function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const urlError = searchParams.get('error')
    if (urlError) setError(urlError)
  }, [searchParams])

  /** Submits login credentials to Supabase Auth. */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = getSupabase()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError('Invalid email or password. Please try again.')
      setLoading(false)
      return
    }

    const next = searchParams.get('next') ?? '/dashboard'
    const urlParam = searchParams.get('url')
    const destination = urlParam ? `${next}?url=${encodeURIComponent(urlParam)}` : next
    router.push(destination)
    router.refresh()
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="font-headline font-bold text-2xl text-on-surface mb-2">Welcome back</h1>
        <p className="text-on-surface-variant font-body text-sm">Sign in to generate your launch video</p>
      </div>

      {/* Google */}
      <GoogleButton label="Continue with Google" />

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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
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
              Signing in...
            </>
          ) : (
            'Sign in'
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-on-surface-variant font-body text-sm">
        No account yet?{' '}
        <Link href="/signup" className="text-primary hover:text-primary-fixed-dim transition-colors font-medium">
          Create one free
        </Link>
      </p>
    </div>
  )
}

/**
 * Login page — wrapped in Suspense because the inner form uses useSearchParams.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-sm h-96 animate-pulse rounded-lg bg-surface-container" />}>
      <LoginForm />
    </Suspense>
  )
}
