'use client'

import { forwardRef } from 'react'
import clsx from 'clsx'
import Field from './Field'
import styles from './Field.module.scss'

/**
 * A text input in the shared boxed shell. Pass `multiline` for a textarea in the same box.
 * Every other prop lands on the control, so type, value, onChange, placeholder, inputMode,
 * maxLength and the rest work exactly as they do on a bare input.
 *
 * @param {React.ReactNode} [props.label]
 * @param {React.ReactNode} [props.hint]
 * @param {React.ReactNode} [props.error] Marks the box invalid and prints under it.
 * @param {boolean} [props.multiline]
 * @param {React.ReactNode} [props.trailing] Right-hand adornment inside the box.
 */
const TextField = forwardRef(function TextField(
  {
    id,
    label,
    hint,
    error,
    disabled = false,
    multiline = false,
    rows = 3,
    trailing,
    className,
    boxClassName,
    inputClassName,
    ...controlProps
  },
  ref
) {
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      disabled={disabled}
      trailing={trailing}
      className={className}
      boxClassName={boxClassName}
    >
      {({ id: controlId, describedBy, invalid }) => {
        const shared = {
          id: controlId,
          ref,
          disabled,
          'aria-describedby': describedBy,
          'aria-invalid': invalid || undefined,
          className: clsx(styles.field__input, multiline && styles['field__input--multiline'], inputClassName),
          ...controlProps,
        }

        return multiline ? <textarea rows={rows} {...shared} /> : <input type="text" {...shared} />
      }}
    </Field>
  )
})

export default TextField
