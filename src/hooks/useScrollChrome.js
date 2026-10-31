'use client'

import { useEffect, useRef } from 'react'
import { leave, rise } from 'cube-motion'

// Keep sticky layout space while animating mobile navigation out of view.
export function useScrollChrome(isHidden, isMounted = true, edge = 'top') {
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const mobile = window.matchMedia('(max-width: 767px)')
    let animations = []
    let generation = 0
    let hidden = false

    const update = () => {
      const nextHidden = mobile.matches && isHidden && !element.querySelector(':focus-visible')
      if (nextHidden === hidden) return
      hidden = nextHidden
      const current = ++generation
      const wasMoving = element.getAnimations().length > 0
      element.style.visibility = ''

      if (hidden) {
        animations = leave(element)
        Promise.all(animations.map((animation) => animation.finished)).then(() => {
          if (generation === current) element.style.visibility = 'hidden'
        }).catch((error) => {
          if (error.name !== 'AbortError') console.error(error)
        })
      } else {
        animations = rise(element)
      }

      animations.forEach((animation) => {
        // Cube's default lift starts below. Mirror the offscreen frame for top bars,
        // preserving the current frame when a scroll reverses an ongoing motion.
        if (edge === 'top' && (hidden || !wasMoving)) {
          const frames = animation.effect.getKeyframes()
          const frame = frames[hidden ? frames.length - 1 : 0]
          if (frame.translate) {
            frame.translate = frame.translate.replace(/(-?\d+(?:\.\d+)?)px$/, (value, distance) => `${-Math.abs(Number(distance))}px`)
            animation.effect.setKeyframes(frames)
          }
        }
        animation.updatePlaybackRate(1.6)
      })
    }

    // Previous exits retain their last frame until rise retargets them.
    hidden = element.style.visibility === 'hidden' || element.getAnimations().some((animation) => animation.effect?.getTiming().fill === 'both')
    update()
    mobile.addEventListener('change', update)
    element.addEventListener('focusin', update)
    element.addEventListener('focusout', update)

    return () => {
      generation++
      mobile.removeEventListener('change', update)
      element.removeEventListener('focusin', update)
      element.removeEventListener('focusout', update)
    }
  }, [isHidden, isMounted, edge])

  return ref
}
