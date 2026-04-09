'use client'

import { useEffect } from 'react'
import { motion, stagger, useAnimate } from 'framer-motion'

interface TextGenerateEffectProps {
  words: string
  className?: string
  filter?: boolean
  duration?: number
}

/**
 * TextGenerateEffect — 21st.dev / Aceternity-inspired text animation.
 * Each word fades in sequentially with an optional blur-to-sharp filter.
 */
export function TextGenerateEffect({
  words,
  className = '',
  filter = true,
  duration = 0.5,
}: TextGenerateEffectProps) {
  const [scope, animate] = useAnimate()
  const wordsArray = words.split(' ')

  useEffect(() => {
    animate(
      'span',
      { opacity: 1, filter: filter ? 'blur(0px)' : 'none' },
      { duration, delay: stagger(0.1) },
    )
  }, [scope, animate, filter, duration])

  return (
    <div className={className} ref={scope}>
      <motion.div>
        {wordsArray.map((word, idx) => (
          <motion.span
            key={`${word}-${idx}`}
            className="inline-block"
            style={{
              opacity: 0,
              filter: filter ? 'blur(10px)' : 'none',
              marginRight: '0.3em',
            }}
          >
            {word}
          </motion.span>
        ))}
      </motion.div>
    </div>
  )
}
