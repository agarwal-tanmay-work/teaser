import { createServerClient as createSSRServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

/**
 * Creates a Supabase client for use in API routes and server components.
 * Uses the anon key and respects Row Level Security.
 */
export function createServerClient() {
  return createSSRServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return []
        },
        setAll() {
          // No-op for API routes — cookies managed by middleware or request handlers
        },
      },
    }
  )
}

/**
 * Creates a Supabase client for use in React client components (browser).
 * Uses only NEXT_PUBLIC_ prefixed environment variables.
 */
export function createBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// WORKERS ONLY — never import in /app/ or /components/
/**
 * Creates a Supabase client using the service role key.
 * Bypasses Row Level Security — use only in server-side worker processes.
 * NEVER import this function in browser-bundled files.
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
