'use client'

import { motion } from 'framer-motion'

const productLinks = ['How it works', 'Showcase', 'Pricing', 'Templates']
const companyLinks = ['About Us', 'Careers', 'Blog', 'Contact']

/** Site footer matching the reference design — 4-column layout with gradient logo. */
export default function Footer() {
  return (
    <footer
      style={{
        background: '#000000',
        borderTop: '1px solid rgba(70,72,75,0.1)',
        padding: '80px 32px',
      }}
    >
      <div
        className="grid gap-12"
        style={{
          maxWidth: '1440px',
          margin: '0 auto',
          gridTemplateColumns: 'repeat(1, 1fr)',
        }}
      >
        {/* Use CSS grid via inline + responsive class */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          {/* Brand */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="space-y-4"
          >
            <span
              className="text-2xl font-extrabold ai-energy-text"
              style={{ fontFamily: 'var(--font-manrope)' }}
            >
              Teaser
            </span>
            <p style={{ color: '#aaabaf', fontSize: '0.875rem', lineHeight: 1.7 }}>
              The world&apos;s first autonomous video production engine for software founders.
              Professional results in minutes.
            </p>
          </motion.div>

          {/* Product */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.05 }}
          >
            <h4
              className="font-bold mb-6"
              style={{ color: '#f9f9fd', fontFamily: 'var(--font-manrope)' }}
            >
              Product
            </h4>
            <ul className="space-y-4">
              {productLinks.map((label) => (
                <li key={label}>
                  <a
                    href="#"
                    style={{ color: '#aaabaf', fontSize: '0.875rem', transition: 'color 0.2s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#b6a0ff')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#aaabaf')}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Company */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <h4
              className="font-bold mb-6"
              style={{ color: '#f9f9fd', fontFamily: 'var(--font-manrope)' }}
            >
              Company
            </h4>
            <ul className="space-y-4">
              {companyLinks.map((label) => (
                <li key={label}>
                  <a
                    href="#"
                    style={{ color: '#aaabaf', fontSize: '0.875rem', transition: 'color 0.2s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#b6a0ff')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#aaabaf')}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Stay Updated */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <h4
              className="font-bold mb-6"
              style={{ color: '#f9f9fd', fontFamily: 'var(--font-manrope)' }}
            >
              Stay Updated
            </h4>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="Email address"
                className="flex-1 min-w-0 rounded-xl px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-[#b6a0ff]"
                style={{
                  background: '#171a1d',
                  border: '1px solid rgba(70,72,75,0.20)',
                  color: '#f9f9fd',
                }}
              />
              <button
                className="ai-energy-gradient font-bold px-4 py-2 rounded-xl text-sm shrink-0"
                style={{ color: '#000', fontFamily: 'var(--font-manrope)' }}
              >
                Join
              </button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          maxWidth: '1440px',
          margin: '80px auto 0',
          paddingTop: '32px',
          borderTop: '1px solid rgba(70,72,75,0.1)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          alignItems: 'center',
        }}
        className="md:flex-row md:justify-between"
      >
        <p
          className="text-xs uppercase tracking-widest"
          style={{ color: '#aaabaf', fontFamily: 'var(--font-space-grotesk)' }}
        >
          © 2024 Ethereal Automaton Inc.
        </p>
        <div className="flex gap-8">
          {['Privacy Policy', 'Terms of Service', 'Status'].map((label) => (
            <a
              key={label}
              href="#"
              className="text-xs uppercase tracking-widest transition-colors duration-200"
              style={{ color: '#aaabaf', fontFamily: 'var(--font-space-grotesk)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#f9f9fd')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#aaabaf')}
            >
              {label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  )
}
