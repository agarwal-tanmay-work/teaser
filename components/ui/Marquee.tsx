'use client'

interface MarqueeProps {
  children: React.ReactNode
  className?: string
  reverse?: boolean
  pauseOnHover?: boolean
  speed?: number
}

/**
 * Marquee — 21st.dev-inspired infinite horizontal scrolling animation.
 * Uses pure CSS animation for silky-smooth performance.
 */
export function Marquee({
  children,
  className = '',
  reverse = false,
  pauseOnHover = false,
  speed = 40,
}: MarqueeProps) {
  return (
    <div
      className={`group flex overflow-hidden [--gap:1rem] ${className}`}
      style={{
        maskImage:
          'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
        WebkitMaskImage:
          'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
      }}
    >
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={i}
          className={`flex shrink-0 items-center justify-around gap-[--gap] ${
            pauseOnHover ? 'group-hover:[animation-play-state:paused]' : ''
          }`}
          style={{
            animation: `${reverse ? 'marquee-reverse' : 'marquee'} ${speed}s linear infinite`,
          }}
        >
          {children}
        </div>
      ))}
    </div>
  )
}
