'use client'

import { useEffect, useRef } from 'react'
import { appChains } from '@/config/contracts'

const ARM_STAR_COUNT = 1700
const FIELD_STAR_COUNT = 260
const DUST_COUNT = 36
const ARMS = 2
const WINDING = 2.7 * Math.PI
const TILT = 0.36
const DEPTH = 0.22
const SPIN = 0.045

// Violet core -> purple -> cyan -> emerald rim, keyed on normalized radius
const RAMP = [
  [0, [196, 141, 255]],
  [0.3, [168, 85, 247]],
  [0.68, [34, 211, 238]],
  [1, [52, 211, 153]],
]

const rampRgb = (t) => {
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1]
      const [t1, c1] = RAMP[i]
      const k = (t - t0) / (t1 - t0)
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * k))
    }
  }
  return RAMP[RAMP.length - 1][1]
}

const rampColor = (t) => `rgb(${rampRgb(t).join(',')})`

// Sum of three uniforms approximates a gaussian, keeping arms dense at the ridge
const gauss = () => Math.random() + Math.random() + Math.random() - 1.5

const parseHex = (hex) => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

// Stars are hot: lift a chain colour toward white — dark colours hardest, so every chain
// survives `lighter` compositing on the pitch-black ground
const starColor = (rgb, k) => {
  const lift = Math.min(1, k + (1 - Math.max(...rgb) / 255) * 0.55)
  return `rgb(${rgb.map((v) => Math.round(v + (255 - v) * lift)).join(',')})`
}

const chainPalette = () => appChains.filter((chain) => chain.primaryColor).map((chain) => parseHex(chain.primaryColor))

// Soft radial sprite for the cinematic variant's nebula haze
const hazeSprite = (rgb) => {
  const sprite = document.createElement('canvas')
  sprite.width = 64
  sprite.height = 64
  const g = sprite.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, `rgba(${rgb.join(',')}, 0.85)`)
  grad.addColorStop(1, `rgba(${rgb.join(',')}, 0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return sprite
}

// `dense` bumps particle counts for large canvases (fullscreen), where the fixed
// band-sized population spreads too thin
const buildScene = (variant, dense = false) => {
  const chainColors = variant === 'chains' ? chainPalette() : null
  const cinematic = variant === 'cinematic'
  const starCount = Math.round((cinematic ? 2600 : ARM_STAR_COUNT) * (dense ? 1.7 : 1))
  const winding = cinematic ? 2.95 * Math.PI : WINDING
  // Chains own concentric bands of the disk; the jitter blends the seams into clusters
  const armColor = (radial) => {
    if (!chainColors) return rampColor(Math.min(1, radial + gauss() * 0.07))
    const idx = Math.round(radial * (chainColors.length - 1) + gauss() * 0.8)
    return starColor(chainColors[Math.min(chainColors.length - 1, Math.max(0, idx))], 0.08 + Math.random() * 0.3)
  }
  const dustColor = () => {
    if (!chainColors) return Math.random() < 0.5 ? 'rgb(168,85,247)' : 'rgb(103,232,249)'
    return starColor(chainColors[Math.floor(Math.random() * chainColors.length)], 0.15)
  }
  const stars = []
  for (let i = 0; i < starCount; i++) {
    const radial = Math.pow(Math.random(), 0.62)
    const r = 0.06 + radial * 1.02
    // Cinematic arms scatter less, so the two spiral lanes stay defined
    const scatter = gauss() * (cinematic ? 0.4 - 0.24 * radial : 0.55 - 0.3 * radial)
    stars.push({
      r,
      theta: (i % ARMS) * Math.PI + radial * winding + scatter,
      h: gauss() * 0.02 * (1 - radial * 0.6),
      size: 0.6 + Math.random() * (Math.random() < (cinematic ? 0.09 : 0.06) ? 2.1 : 1),
      alpha: (0.35 + Math.random() * 0.55) * (1 - radial * 0.25),
      color: armColor(radial),
      twSpeed: 0.6 + Math.random() * 2.4,
      twPhase: Math.random() * Math.PI * 2,
    })
  }

  const field = []
  for (let i = 0; i < FIELD_STAR_COUNT * (dense ? 2 : 1); i++) {
    field.push({
      ux: Math.random(),
      uy: Math.random(),
      size: 0.4 + Math.random() * 0.9,
      alpha: 0.1 + Math.random() * 0.35,
      color: Math.random() < 0.3 ? 'rgb(157,180,255)' : 'rgb(228,231,255)',
      twSpeed: 0.3 + Math.random() * 1.2,
      twPhase: Math.random() * Math.PI * 2,
    })
  }

  const dust = []
  for (let i = 0; i < Math.round((cinematic ? 60 : DUST_COUNT) * (dense ? 1.5 : 1)); i++) {
    dust.push({
      r: 0.2 + Math.random() * 0.95,
      theta: Math.random() * Math.PI * 2,
      lift: 0.02 + Math.random() * 0.09,
      size: 1.2 + Math.random() * 2.2,
      alpha: 0.04 + Math.random() * 0.09,
      color: dustColor(),
      bob: 0.2 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
    })
  }

  const haze = []
  if (cinematic) {
    const sprites = [0.05, 0.3, 0.55, 0.8, 1].map((t) => hazeSprite(rampRgb(t)))
    for (let i = 0; i < 150; i++) {
      const radial = Math.pow(Math.random(), 0.7)
      haze.push({
        r: 0.08 + radial,
        theta: (i % ARMS) * Math.PI + radial * winding + gauss() * 0.3,
        h: gauss() * 0.015,
        size: 0.035 + Math.random() * 0.055,
        alpha: 0.05 + Math.random() * 0.07,
        sprite: sprites[Math.min(sprites.length - 1, Math.floor(radial * sprites.length))],
      })
    }
  }

  return { stars, field, dust, haze, dense }
}

/**
 * Decorative spiral-galaxy particle animation for the drops hero. Pure Canvas 2D — pauses when
 * offscreen or the tab hides, and prefers-reduced-motion gets a single static frame.
 * Variants: 'nebula' (violet-to-emerald ramp), 'chains' (stars keyed to app-chain colours,
 * Hup pink core), 'cinematic' (tighter arms, denser stars, nebula haze).
 */
export default function GalaxyCanvas({ className, variant = 'nebula' }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let scene = buildScene(variant)

    let frame = 0
    let width = 0
    let height = 0
    let inView = true
    let pageVisible = !document.hidden

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = rect.width
      height = rect.height
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const dense = width * height > 900_000
      if (dense !== scene.dense) scene = buildScene(variant, dense)
    }

    const draw = (t) => {
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.fillStyle = '#030014'
      ctx.fillRect(0, 0, width, height)

      // Wide bands push the galaxy right of the copy; square canvases and fullscreen centre it
      const wide = width > height * 1.5
      const fullscreen = document.fullscreenElement?.contains(canvas) ?? false
      const cx = width * (wide && !fullscreen ? 0.62 : 0.5)
      const cy = height * (wide && !fullscreen ? 0.54 : 0.5)
      const scale = wide ? Math.max(width * 0.34, height * 0.85) : Math.min(width, height) * 0.45
      // Square framing raises the camera so the disk fills the frame instead of a thin band
      const tilt = wide ? TILT : 0.52
      // Particle sizes track the galaxy radius, so a big canvas grows stars instead of thinning them
      const starScale = Math.min(3, Math.max(1, scale / 340))
      const spin = t * SPIN

      ctx.globalCompositeOperation = 'lighter'

      for (const s of scene.field) {
        ctx.globalAlpha = s.alpha * (0.7 + 0.3 * Math.sin(t * s.twSpeed + s.twPhase))
        ctx.fillStyle = s.color
        const size = s.size * (0.6 + 0.4 * starScale)
        ctx.fillRect(s.ux * width, s.uy * height, size, size)
      }

      // Core glow, squashed onto the tilted disk plane
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(1, tilt + 0.16)
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, scale * 0.55)
      if (variant === 'chains') {
        glow.addColorStop(0, 'rgba(251, 207, 232, 0.55)')
        glow.addColorStop(0.2, 'rgba(236, 72, 153, 0.26)')
        glow.addColorStop(1, 'rgba(236, 72, 153, 0)')
      } else if (variant === 'cinematic') {
        glow.addColorStop(0, 'rgba(233, 213, 255, 0.6)')
        glow.addColorStop(0.18, 'rgba(168, 85, 247, 0.3)')
        glow.addColorStop(0.5, 'rgba(124, 58, 237, 0.12)')
        glow.addColorStop(1, 'rgba(124, 58, 237, 0)')
      } else {
        glow.addColorStop(0, 'rgba(216, 180, 254, 0.5)')
        glow.addColorStop(0.2, 'rgba(139, 92, 246, 0.26)')
        glow.addColorStop(1, 'rgba(139, 92, 246, 0)')
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = glow
      ctx.fillRect(-scale * 0.55, -scale * 0.55, scale * 1.1, scale * 1.1)
      ctx.restore()

      for (const hz of scene.haze) {
        const theta = hz.theta + spin
        const sin = Math.sin(theta)
        const persp = 1 / (1 - sin * hz.r * DEPTH)
        const x = cx + Math.cos(theta) * hz.r * scale * persp
        const y = cy + (sin * hz.r * tilt + hz.h) * scale * persp
        const size = hz.size * scale * persp
        if (x < -size * 2 || x > width + size * 2 || y < -size * 2 || y > height + size * 2) continue
        ctx.globalAlpha = hz.alpha
        ctx.drawImage(hz.sprite, x - size, y - size, size * 2, size * 2)
      }

      for (const s of scene.stars) {
        const theta = s.theta + spin
        const sin = Math.sin(theta)
        // Far half of the disk (sin < 0) recedes: smaller and dimmer
        const persp = 1 / (1 - sin * s.r * DEPTH)
        const x = cx + Math.cos(theta) * s.r * scale * persp
        const y = cy + (sin * s.r * tilt + s.h) * scale * persp
        if (x < -8 || x > width + 8 || y < -8 || y > height + 8) continue
        ctx.globalAlpha = s.alpha * (0.72 + 0.28 * Math.sin(t * s.twSpeed + s.twPhase)) * (0.55 + 0.45 * persp)
        ctx.fillStyle = s.color
        const size = s.size * persp * starScale
        if (size > 2.4) {
          // Big stars go round — scaled-up squares read as pixels
          ctx.beginPath()
          ctx.arc(x, y, size / 2, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillRect(x - size / 2, y - size / 2, size, size)
        }
      }

      for (const d of scene.dust) {
        const theta = d.theta + spin * 0.6
        const x = cx + Math.cos(theta) * d.r * scale
        const y = cy + (Math.sin(theta) * d.r * tilt - d.lift) * scale + Math.sin(t * d.bob + d.phase) * 3
        if (x < -12 || x > width + 12 || y < -12 || y > height + 12) continue
        ctx.globalAlpha = d.alpha * (0.7 + 0.3 * Math.sin(t * d.bob * 1.7 + d.phase))
        ctx.fillStyle = d.color
        ctx.beginPath()
        ctx.arc(x, y, d.size * (0.7 + 0.3 * starScale), 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }

    const tick = (now) => {
      draw(now / 1000)
      frame = requestAnimationFrame(tick)
    }

    const sync = () => {
      cancelAnimationFrame(frame)
      if (!inView || !pageVisible) return
      if (reducedMotion.matches) {
        draw(0)
        return
      }
      frame = requestAnimationFrame(tick)
    }

    const resizeObserver = new ResizeObserver(() => {
      resize()
      if (reducedMotion.matches) draw(0)
    })
    resizeObserver.observe(canvas)

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      sync()
    })
    intersectionObserver.observe(canvas)

    const onVisibility = () => {
      pageVisible = !document.hidden
      sync()
    }
    document.addEventListener('visibilitychange', onVisibility)
    reducedMotion.addEventListener('change', sync)

    resize()
    sync()

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      reducedMotion.removeEventListener('change', sync)
    }
  }, [variant])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
