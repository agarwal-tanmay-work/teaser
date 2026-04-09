import Link from 'next/link'

/**
 * Minimal layout for auth pages (login, signup).
 * Centers content vertically and shows the Teaser wordmark in the top-left.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-8 h-16 flex items-center border-b border-outline-variant/10">
        <Link
          href="/"
          className="font-headline font-bold text-lg bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary"
        >
          Teaser
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        {children}
      </main>
    </div>
  )
}
