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
