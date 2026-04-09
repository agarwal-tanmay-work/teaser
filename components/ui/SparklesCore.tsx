'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  opacity: number
  fadeRate: number
  color: string
}

interface SparklesCoreProps {
  id?: string
  className?: string
  background?: string
  minSize?: number
  maxSize?: number
  particleDensity?: number
  particleColor?: string
  particleColors?: string[]
  speed?: number
}

/**
 * SparklesCore — 21st.dev-inspired canvas-based particle system.
 * Renders floating, glowing dots that drift upward and fade.
 */
export function SparklesCore({
  id = 'sparkles-canvas',
  className = '',
  background = 'transparent',
  minSize = 0.6,
  maxSize = 1.4,
  particleDensity = 100,
  particleColor,
  particleColors = ['#b6a0ff', '#00e3fd', '#ffffff'],
  speed = 0.4,
}: SparklesCoreProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const animationRef = useRef<number | undefined>(undefined)

  const createParticle = useCallback(
    (w: number, h: number): Particle => {
      const colors = particleColor ? [particleColor] : particleColors
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * speed * 0.5,
        vy: -Math.random() * speed - 0.1,
        size: Math.random() * (maxSize - minSize) + minSize,
        opacity: Math.random(),
        fadeRate: Math.random() * 0.01 + 0.003,
        color: colors[Math.floor(Math.random() * colors.length)],
      }
    },
    [maxSize, minSize, particleColor, particleColors, speed],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)
    }

    resize()
    window.addEventListener('resize', resize)

    const rect = canvas.getBoundingClientRect()
    particlesRef.current = Array.from({ length: particleDensity }, () =>
      createParticle(rect.width, rect.height),
    )

    const render = () => {
      const rect = canvas.getBoundingClientRect()
      ctx.clearRect(0, 0, rect.width, rect.height)

      particlesRef.current.forEach((p, i) => {
        p.x += p.vx
        p.y += p.vy
        p.opacity += Math.sin(Date.now() * 0.001 + i) * 0.01

        if (p.y < -10 || p.opacity <= 0) {
          particlesRef.current[i] = createParticle(rect.width, rect.height)
          particlesRef.current[i].y = rect.height + 10
        }

        p.opacity = Math.max(0, Math.min(1, p.opacity))

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.globalAlpha = p.opacity * 0.8
        ctx.fill()

        // Glow effect
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.globalAlpha = p.opacity * 0.15
        ctx.fill()
      })

      ctx.globalAlpha = 1
      animationRef.current = requestAnimationFrame(render)
    }

    render()

    return () => {
      window.removeEventListener('resize', resize)
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [createParticle, particleDensity])

  return (
    <canvas
      ref={canvasRef}
      id={id}
      className={className}
      style={{
        background,
        width: '100%',
        height: '100%',
        position: 'absolute',
        inset: 0,
      }}
    />
  )
}
