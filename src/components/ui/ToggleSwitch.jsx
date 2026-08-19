'use client'

import clsx from 'clsx'
import styles from './ToggleSwitch.module.scss'

/**
 * The one toggle switch: an iOS-style slider painted over a real checkbox, so it keeps
 * native semantics — label association, focus ring, Space to flip, form participation —
 * instead of a div pretending to be a control.
 *
 * @param {boolean} checked
 * @param {(event: React.ChangeEvent<HTMLInputElement>) => void} onChange
 * @param {string} [id] so an external <label htmlFor> can drive it
 * @param {boolean} [disabled]
 * @param {string} [className] extra class for the track
 */
export default function ToggleSwitch({ checked, onChange, id, disabled = false, className, 'aria-label': ariaLabel }) {
  return (
    <label className={clsx(styles.toggle, disabled && styles['toggle--disabled'], className)}>
      <input
        id={id}
        type="checkbox"
        className={styles.toggle__input}
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={onChange}
      />
      <span className={styles.toggle__slider} />
    </label>
  )
}
