'use client'

import { useEffect, useRef } from 'react'
import { motion, useAnimation } from 'framer-motion'

interface SpotlightProps {
  className?: string
  fill?: string
}

/**
 * Spotlight — 21st.dev-inspired SVG spotlight beam effect.
 * Renders an animated elliptical glow that scales in on mount.
 */
export function Spotlight({ className = '', fill = 'white' }: SpotlightProps) {
  const controls = useAnimation()
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    controls.start({
      opacity: 1,
      transform: 'translate(-50%, -40%) scale(1)',
      transition: { duration: 2, ease: 'easeOut', delay: 0.75 },
    })
  }, [controls])

  return (
    <motion.svg
      ref={ref}
      initial={{ opacity: 0, transform: 'translate(-72%, -62%) scale(0.5)' }}
      animate={controls}
      className={`pointer-events-none absolute z-[1] ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 3787 2842"
      fill="none"
    >
      <g filter="url(#spotlight-filter)">
        <ellipse
          cx="1924.71"
          cy="273.501"
          rx="1924.71"
          ry="273.501"
          transform="matrix(-0.822377 -0.568943 -0.568943 0.822377 3631.88 2291.09)"
          fill={fill}
          fillOpacity="0.21"
        />
      </g>
      <defs>
        <filter
          id="spotlight-filter"
          x="0.860352"
          y="0.838989"
          width="3785.16"
          height="2840.26"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="151" result="effect1_foregroundBlur_1065_8" />
        </filter>
      </defs>
    </motion.svg>
  )
}
