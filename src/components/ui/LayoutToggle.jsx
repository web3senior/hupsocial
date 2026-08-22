'use client'

import clsx from 'clsx'
import { GridNineIcon, ListDashesIcon, SquaresFourIcon } from '@phosphor-icons/react'
import styles from './LayoutToggle.module.scss'

// Ordered loosest to tightest, so the control reads as one axis rather than three moods
const LAYOUTS = [
  { value: 'comfortable', label: 'Large grid', Icon: SquaresFourIcon },
  { value: 'compact', label: 'Small grid', Icon: GridNineIcon },
  { value: 'list', label: 'List', Icon: ListDashesIcon },
]

/**
 * Layout Toggle
 * Segmented control for a grid's density. Buttons rather than links or a select: the
 * choice changes nothing but presentation, so it stays out of the URL and off the page's
 * data, and each option is one press away instead of two.
 *
 * There is one background for the whole control, not one per segment — it slides to the
 * pressed option so the eye follows the move instead of hunting for what lit up. The track
 * around it is cut to the same pill as the toolbar filters it sits beside.
 * @param {Object} props
 * @param {string} props.value Current layout — 'comfortable' | 'compact' | 'list'.
 * @param {Function} props.onChange Called with the chosen layout.
 * @param {string} [props.label='Layout'] Accessible name for the group.
 * @param {string} [props.className] Extra class for toolbar placement.
 */
export default function LayoutToggle({ value, onChange, label = 'Layout', className }) {
  // Clamped rather than left at -1: an unknown value parks the slider under the first
  // segment instead of off the left edge of the track
  const activeIndex = Math.max(
    0,
    LAYOUTS.findIndex((layout) => layout.value === value),
  )

  return (
    <div
      className={clsx(styles.layoutToggle, className)}
      role="group"
      aria-label={label}
      style={{ '--layout-toggle-index': activeIndex }}
    >
      <span className={styles.layoutToggle__slider} aria-hidden="true" />

      {LAYOUTS.map((layout) => {
        const isActive = value === layout.value

        return (
          <button
            key={layout.value}
            type="button"
            className={clsx(styles.layoutToggle__option, isActive && styles['layoutToggle__option--active'])}
            aria-pressed={isActive}
            aria-label={layout.label}
            title={layout.label}
            onClick={() => onChange(layout.value)}
          >
            <layout.Icon size={16} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
