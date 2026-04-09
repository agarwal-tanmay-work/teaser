'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase'

interface AppSidebarProps {
  userEmail: string
  initials: string
}

const navItems = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
]

/** Fixed left sidebar for the authenticated app. Shows navigation, user info, and sign out. */
export default function AppSidebar({ userEmail, initials }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createBrowserClient()

  /** Signs the user out and redirects to the landing page. */
  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-60 bg-[#0A0A0A] border-r border-[#1F1F1F] flex flex-col z-40">
      {/* Logo */}
      <div className="px-6 h-16 flex items-center border-b border-[#1F1F1F]">
        <span className="text-white font-semibold text-lg">Teaser</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-[#111111] text-white'
                  : 'text-[#6E6E6E] hover:text-white hover:bg-[#111111]'
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* User info + sign out */}
      <div className="px-3 py-4 border-t border-[#1F1F1F] space-y-1">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-[#111111] border border-[#1F1F1F] flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
            {initials}
          </div>
          <span className="text-[#6E6E6E] text-xs truncate flex-1">{userEmail}</span>
        </div>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-[#6E6E6E] hover:text-white hover:bg-[#111111] transition-colors"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign out
        </button>
      </div>
    </aside>
  )
}
