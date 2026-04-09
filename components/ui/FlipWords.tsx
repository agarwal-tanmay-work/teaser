'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface FlipWordsProps {
  words: string[]
  duration?: number
  className?: string
}

/**
 * FlipWords — 21st.dev / Aceternity-inspired word cycling animation.
 * Rotates through words with smooth exit/enter transitions per-character.
 */
export function FlipWords({ words, duration = 3000, className = '' }: FlipWordsProps) {
  const [currentWord, setCurrentWord] = useState(words[0])
  const [isAnimating, setIsAnimating] = useState(false)

  const startAnimation = useCallback(() => {
    const currentIndex = words.indexOf(currentWord)
    const nextIndex = (currentIndex + 1) % words.length
    setCurrentWord(words[nextIndex])
    setIsAnimating(true)
  }, [currentWord, words])

  useEffect(() => {
    if (!isAnimating) {
      const timer = setTimeout(startAnimation, duration)
      return () => clearTimeout(timer)
    }
  }, [isAnimating, duration, startAnimation])

  return (
    <span className="inline-block relative" style={{ verticalAlign: 'baseline' }}>
      <AnimatePresence
        mode="wait"
        onExitComplete={() => setIsAnimating(false)}
      >
        <motion.span
          key={currentWord}
          initial={{ opacity: 0, y: 10, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -10, filter: 'blur(8px)' }}
          transition={{
            type: 'spring',
            stiffness: 120,
            damping: 14,
            duration: 0.35,
          }}
          className={`inline-block ${className}`}
        >
          {currentWord.split('').map((letter, index) => (
            <motion.span
              key={`${currentWord}-${index}`}
              initial={{ opacity: 0, y: 10, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{
                delay: index * 0.03,
                duration: 0.25,
              }}
              className="inline-block"
            >
              {letter === ' ' ? '\u00A0' : letter}
            </motion.span>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
