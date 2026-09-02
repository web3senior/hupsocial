'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import styles from './SegmentedControl.module.scss'

// The slider is placed from measured geometry, so it has to land before the browser paints or the
// control flashes with nothing selected. On the server there is nothing to measure and React warns
// about a layout effect that can never run, so the plain effect stands in there.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Segmented Control
 * One track of mutually exclusive choices — a filter row, a scope switch, a density picker.
 * Buttons rather than links or a select: the choice is a habit rather than a destination, so it
 * stays out of the URL, and each option is one press away instead of two.
 *
 * There is one background for the whole control, not one per segment — it slides to the pressed
 * option so the eye follows the move instead of hunting for what lit up. Its width travels too,
 * because labels are not all the same length and equal-width segments would cut every row to its
 * longest word.
 *
 * The geometry is measured rather than computed: a ResizeObserver watches the track and each
 * segment, so a container resize, a breakpoint, or a webfont landing late all re-place the slider
 * without the caller knowing anything about it.
 * @param {Object} props
 * @param {Array} props.options `[{ value, label, icon?, title? }]`, in reading order.
 * @param {string} props.value The selected option's value.
 * @param {Function} props.onChange Called with the chosen value.
 * @param {string} [props.label='View'] Accessible name for the control.
 * @param {'group'|'tabs'} [props.as='group'] 'tabs' when the choice swaps the content below it,
 *   'group' when it only reshapes what is already on screen.
 * @param {'sm'|'md'} [props.size='md'] Track height — 'sm' for a dense toolbar.
 * @param {boolean} [props.iconOnly=false] Render each option's icon alone, its label becoming the
 *   accessible name and the tooltip.
 * @param {string} [props.className] Extra class for toolbar placement.
 */
export default function SegmentedControl({ options, value, onChange, label = 'View', as = 'group', size = 'md', iconOnly = false, className }) {
  const shellRef = useRef(null)
  const trackRef = useRef(null)
  // First placement jumps, later ones glide — an animated scroll on mount reads as the control
  // fixing itself rather than responding to anything
  const hasPlacedRef = useRef(false)
  // null until measured. The slider is not rendered before then, which is also what keeps it from
  // travelling in from the left edge on the first paint — a freshly inserted element does not
  // transition from a previous position, it simply appears where it belongs.
  const [slider, setSlider] = useState(null)

  const isTabs = as === 'tabs'
  // Clamped rather than left at -1: an unknown value parks the slider under the first segment
  // instead of off the left edge of the track
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )

  // Only the values matter to the geometry, and callers build their option list inline, so the
  // effect keys off the shape rather than the array's identity
  const optionKey = options.map((option) => option.value).join('|')

  const measure = useCallback(() => {
    const track = trackRef.current
    if (!track) return

    const buttons = track.querySelectorAll(`.${styles.segmented__option}`)
    const active = buttons[activeIndex]
    if (!active) return

    const next = { x: active.offsetLeft, w: active.offsetWidth }
    // Same geometry, same object: a ResizeObserver that fires on every scroll-driven reflow must
    // not re-render the control for a move that never happened
    setSlider((current) => (current && current.x === next.x && current.w === next.w ? current : next))
  }, [activeIndex])

  // The track scrolls with its scrollbar hidden, so these fades are the only sign that options
  // continue past the edge. Toggled as attributes straight on the shell: scroll fires every frame
  // of a drag, and a state round-trip would re-render the whole control for two booleans.
  const updateOverflow = useCallback(() => {
    const shell = shellRef.current
    const track = trackRef.current
    if (!shell || !track) return

    shell.toggleAttribute('data-overflow-start', track.scrollLeft > 1)
    shell.toggleAttribute('data-overflow-end', track.scrollLeft + track.clientWidth < track.scrollWidth - 1)
  }, [])

  useIsomorphicLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return

    measure()
    updateOverflow()

    const handleScroll = () => updateOverflow()
    track.addEventListener('scroll', handleScroll, { passive: true })

    const observer = new ResizeObserver(() => {
      measure()
      updateOverflow()
    })
    observer.observe(track)
    // Each segment as well as the track: a label reflowing when its webfont swaps in changes the
    // slider's target without the track's own box moving at all
    track.querySelectorAll(`.${styles.segmented__option}`).forEach((button) => observer.observe(button))

    return () => {
      track.removeEventListener('scroll', handleScroll)
      observer.disconnect()
    }
  }, [measure, updateOverflow, optionKey, iconOnly, size])

  // On a track narrow enough to scroll, the chosen segment can sit half past the edge — a stored
  // choice restored on mount, or a press on a partially visible label. Bring it fully into view.
  useEffect(() => {
    const track = trackRef.current
    const active = track?.querySelectorAll(`.${styles.segmented__option}`)[activeIndex]
    if (!track || !active) return

    const behavior = hasPlacedRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant'
    hasPlacedRef.current = true

    const left = active.offsetLeft
    const right = left + active.offsetWidth
    if (left < track.scrollLeft) track.scrollTo({ left, behavior })
    else if (right > track.scrollLeft + track.clientWidth) track.scrollTo({ left: right - track.clientWidth, behavior })
  }, [activeIndex, optionKey])

  // Arrow keys walk the track, wrapping at both ends, with focus following the selection — the
  // native behaviour of the tablist this borrows its roles from
  const handleKeyDown = (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return

    event.preventDefault()
    const nextIndex = (activeIndex + step + options.length) % options.length
    onChange(options[nextIndex].value)
    trackRef.current?.querySelectorAll(`.${styles.segmented__option}`)[nextIndex]?.focus()
  }

  return (
    <div ref={shellRef} className={clsx(styles.segmented, iconOnly && styles['segmented--iconOnly'], className)} data-size={size}>
      <div ref={trackRef} className={styles.segmented__track} role={isTabs ? 'tablist' : 'group'} aria-label={label} onKeyDown={handleKeyDown}>
        {slider && <span className={styles.segmented__slider} aria-hidden="true" style={{ '--segmented-x': `${slider.x}px`, '--segmented-w': `${slider.w}px` }} />}

        {options.map((option) => {
          const isActive = option.value === value
          const Icon = option.icon

          return (
            <button
              key={option.value}
              type="button"
              role={isTabs ? 'tab' : undefined}
              aria-selected={isTabs ? isActive : undefined}
              aria-pressed={isTabs ? undefined : isActive}
              aria-label={iconOnly ? option.label : undefined}
              title={option.title ?? (iconOnly ? option.label : undefined)}
              // Only the selected segment is a tab stop, so the control is one step in the page's
              // tab order and the arrow keys move within it
              tabIndex={isActive ? 0 : -1}
              className={clsx(styles.segmented__option, isActive && styles['segmented__option--active'])}
              onClick={() => onChange(option.value)}
            >
              {Icon && <Icon size={16} aria-hidden="true" />}
              {!iconOnly && <span>{option.label}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
