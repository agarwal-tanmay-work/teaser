import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerClient as createSSRClient } from '@supabase/ssr'
import QueryProvider from '@/components/providers/QueryProvider'
import AppSidebar from '@/components/dashboard/AppSidebar'

/**
 * Layout for all authenticated app routes under /(app).
 * Redirects to /login if the user has no active session.
 * Renders a fixed sidebar and main content area.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()

  const supabase = createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // Read-only in server components — handled by middleware
        },
      },
    }
  )

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  const userEmail = session.user.email ?? ''
  const initials = userEmail.slice(0, 2).toUpperCase()

  return (
    <QueryProvider>
      <div className="flex min-h-screen bg-[#0A0A0A]">
        <AppSidebar userEmail={userEmail} initials={initials} />
        <main className="ml-60 flex-1 p-8 overflow-y-auto">{children}</main>
      </div>
    </QueryProvider>
  )
}
