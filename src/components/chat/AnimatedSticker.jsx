'use client'

import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import Shimmer from '@/components/ui/Shimmer'
import { stickerAsset } from '@/lib/chatStickers'
import styles from './Stickers.module.scss'

export default function AnimatedSticker({ sticker, inline = false }) {
  const root = useRef(null)
  const canvas = useRef(null)

  useEffect(() => {
    const element = root.current
    const target = canvas.current
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let animation
    let disposed = false
    let loading = false
    let visible = false
    let ready = false
    const sync = async () => {
      const active = visible && !document.hidden
      const playing = active && !motion.matches
      if (!active || (motion.matches && sticker.preview !== false)) {
        animation?.pause()
        if (motion.matches) element.removeAttribute('data-ready')
        return
      }
      if (animation) {
        if (!ready) return
        element.setAttribute('data-ready', '')
        if (playing) animation.play()
        else animation.goToAndStop(0, true)
        return
      }
      if (loading) return
      loading = true
      try {
        const { default: lottie } = await import('lottie-web')
        if (disposed) return
        animation = lottie.loadAnimation({
          container: target,
          renderer: sticker.renderer === 'canvas' ? 'canvas' : 'svg',
          rendererSettings: sticker.renderer === 'canvas'
            ? { dpr: Math.min(window.devicePixelRatio || 1, 2), clearCanvas: true }
            : undefined,
          loop: true,
          autoplay: false,
          path: stickerAsset(sticker, 'json'),
        })
        // Render authored frames once, rather than interpolating extra geometry on high-refresh displays.
        if (sticker.renderer === 'canvas') animation.setSubframe(false)
        animation.addEventListener('DOMLoaded', () => {
          ready = true
          if (!disposed) sync()
        })
        animation.addEventListener('data_failed', () => {
          element.removeAttribute('data-ready')
        })
      } catch {
        // The preview remains available if the player cannot load.
      }
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      sync()
    })
    observer.observe(element)
    motion.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      disposed = true
      observer.disconnect()
      motion.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
      animation?.destroy()
    }
  }, [sticker])

  return (
    <span ref={root} className={clsx(styles.sticker, inline && styles['sticker--inline'])} role="img" aria-label={`${sticker.label} animated sticker`}>
      <Shimmer as="span" className={styles.sticker__shimmer} />
      {sticker.preview !== false && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.sticker__preview}
          src={stickerAsset(sticker, 'png')}
          alt=""
          loading="lazy"
          onLoad={() => root.current?.setAttribute('data-preview-ready', '')}
          onError={() => root.current?.removeAttribute('data-preview-ready')}
        />
      )}
      <span ref={canvas} className={styles.sticker__animation} aria-hidden="true" />
    </span>
  )
}
