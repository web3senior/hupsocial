'use client'

import { useId } from 'react'
import clsx from 'clsx'
import styles from './Field.module.scss'

/**
 * The one boxed form field: a rounded shell with its label inside, sitting above the value.
 * TextField and SelectField are the two flavours built on it; use Field directly to put any
 * other control (a date row, a token amount) in the same box.
 *
 * The shell is a <label>, so the whole box focuses the control it wraps.
 *
 * @param {string} [props.id] Control id; generated when absent.
 * @param {React.ReactNode} [props.label] Sits inside the box, above the control.
 * @param {React.ReactNode} [props.hint] Explanatory line under the box.
 * @param {React.ReactNode} [props.error] Error line under the box; also marks the box invalid.
 * @param {React.ReactNode} [props.trailing] Right-hand adornment inside the box (chevron, unit,
 * a small button).
 * @param {string} [props.className] Applied to the wrapper.
 * @param {string} [props.boxClassName] Applied to the box itself.
 * @param {React.ReactNode|((state: {id: string, describedBy: string|undefined, invalid: boolean,
 * disabled: boolean}) => React.ReactNode)} props.children The control. As a function it receives
 * the ids and state to spread onto it.
 */
export default function Field({
  id,
  label,
  hint,
  error,
  disabled = false,
  trailing,
  className,
  boxClassName,
  children,
}) {
  const generatedId = useId()
  const fieldId = id || `field-${generatedId}`
  const hintId = hint ? `${fieldId}-hint` : null
  const errorId = error ? `${fieldId}-error` : null
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined
  const invalid = Boolean(error)

  const control =
    typeof children === 'function' ? children({ id: fieldId, describedBy, invalid, disabled }) : children

  return (
    <div className={clsx(styles.field, className)}>
      <label
        className={clsx(styles.field__box, boxClassName)}
        htmlFor={fieldId}
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
      >
        <span className={styles.field__body}>
          {label && <span className={styles.field__label}>{label}</span>}
          {control}
        </span>
        {trailing && (
          <span className={styles.field__trailing} aria-hidden="true">
            {trailing}
          </span>
        )}
      </label>

      {error && (
        <span id={errorId} className={styles.field__error}>
          {error}
        </span>
      )}
      {hint && (
        <span id={hintId} className={styles.field__hint}>
          {hint}
        </span>
      )}
    </div>
  )
}
