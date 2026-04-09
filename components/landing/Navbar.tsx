"use client"
import Link from 'next/link'

export default function Navbar() {
  return (
    <nav className="fixed top-0 w-full z-50 bg-[#0c0e11]/70 backdrop-blur-xl shadow-2xl shadow-black/40">
      <div className="flex justify-between items-center px-8 h-16 w-full max-w-[1440px] mx-auto">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-xl font-headline font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#b6a0ff] to-[#00e3fd]">
            Ethereal Automaton
          </Link>
          <div className="hidden md:flex gap-6">
            <a className="font-headline font-bold tracking-tight text-[#aaabaf] hover:text-white transition-colors" href="#">My Projects</a>
            <a className="font-headline font-bold tracking-tight text-[#aaabaf] hover:text-white transition-colors" href="#">History</a>
            <a className="font-headline font-bold tracking-tight text-[#aaabaf] hover:text-white transition-colors" href="#">Credits</a>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden sm:flex items-center bg-surface-container-highest px-4 py-1.5 rounded-full outline-variant/15 border border-outline-variant/15">
            <span className="material-symbols-outlined text-on-surface-variant text-sm mr-2">search</span>
            <input className="bg-transparent border-none focus:ring-0 text-sm placeholder:text-on-surface-variant w-40 outline-none" placeholder="Search projects..." type="text"/>
          </div>
          <div className="flex gap-4 items-center">
            <button className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors">notifications</button>
            <button className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors">settings</button>
            <Link href="/dashboard" className="w-8 h-8 rounded-full overflow-hidden border border-primary/20 block hover:scale-105 transition-transform">
              <img alt="Founder Profile" className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDqJzDE01_VnMviHNskVplGq_62UcCg5lJHgwSkj60f1WEfawRFZX5TEqyxpBPIy6vcSlLsrJrnr12kJHzd1iQ2UDiea0Rf0uDfvxYMZxTLYLpCCKPmCyy1MZRSG9r_Ki7Cr-R2G-ug1zAZVTTeMGl7SgYOIZz-IdPEsCk3fLX93iw5_6KC18UmqxGhgTAgNmpnX1pb4mS3B6LqPs9BCVDZAmg2Qrt038oKv418xbycHUQcM148MrTEZ_fqMfndetL7OypyrD_X-7U"/>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  )
}
