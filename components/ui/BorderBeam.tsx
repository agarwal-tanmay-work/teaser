'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface BorderBeamProps {
  size?: number
  duration?: number
  anchor?: number
  borderWidth?: number
  colorFrom?: string
  colorTo?: string
  delay?: number
  className?: string
}

/**
 * A reusable component that adds a moving "beam" effect along the border of its container.
 * Commonly used in premium Framer-style designs.
 */
export const BorderBeam = ({
  className,
  size = 200,
  duration = 15,
  anchor = 90,
  borderWidth = 1.5,
  colorFrom = '#a78bfa',
  colorTo = '#22d3ee',
  delay = 0,
}: BorderBeamProps) => {
  return (
    <div
      style={
        {
          '--size': `${size}px`,
          '--duration': `${duration}s`,
          '--anchor': `${anchor}`,
          '--border-width': `${borderWidth}px`,
          '--color-from': colorFrom,
          '--color-to': colorTo,
          '--delay': `-${delay}s`,
        } as React.CSSProperties
      }
      className={cn(
        'pointer-events-none absolute inset-0 rounded-[inherit] [border:calc(var(--border-width)*1px)_solid_transparent]',

        // mask-image to only show the beam on the border
        '![mask-clip:padding-box,border-box] ![mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(white,white)]',

        // pseudo-element for the animated beam
        'after:absolute after:aspect-square after:w-[calc(var(--size)*1px)] after:animate-border-beam after:[animation-delay:var(--delay)] after:[background:linear-gradient(to_left,var(--color-from),var(--color-to),transparent)] after:[offset-anchor:calc(var(--anchor)*1%)_50%] after:[offset-path:rect(0_auto_auto_0_round_calc(var(--size)*1px))]',
        className,
      )}
    />
  )
}
