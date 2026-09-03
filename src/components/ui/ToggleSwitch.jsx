'use client'

import clsx from 'clsx'
import styles from './ToggleSwitch.module.scss'

/**
 * The one toggle switch: a pill track with a round knob riding inside it, painted over a real
 * checkbox so it keeps native semantics — label association, focus ring, Space to flip, form
 * participation — instead of a div pretending to be a control.
 *
 * The knob slides and a tick fades in when it is on, so the state never rests on colour alone.
 *
 * @param {boolean} checked
 * @param {(event: React.ChangeEvent<HTMLInputElement>) => void} onChange
 * @param {string} [id] so an external <label htmlFor> can drive it
 * @param {boolean} [disabled]
 * @param {string} [className] extra class for the outer label
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
      <span className={styles.toggle__track} aria-hidden="true" />
      <span className={styles.toggle__knob} aria-hidden="true">
        <svg className={styles.toggle__tick} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </label>
  )
}
