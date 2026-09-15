'use client'

import { forwardRef } from 'react'
import clsx from 'clsx'
import { CaretDownIcon } from '@phosphor-icons/react'
import Field from './Field'
import styles from './Field.module.scss'

/**
 * A select in the shared boxed shell — the same box TextField renders, with a chevron.
 *
 * It stays a native <select> on purpose: that keeps the OS picker on phones, keyboard
 * type-ahead, and form participation. When the choices need a line of explanation under each
 * one, that's OptionPicker's job, not this.
 *
 * @param {{value: string|number, label: React.ReactNode, disabled?: boolean}[]} [props.options]
 * Options to render; pass `children` instead for optgroups or anything richer.
 * @param {string} [props.placeholder] Leading empty option, for a field with nothing chosen yet.
 * @param {React.ReactNode} [props.label]
 * @param {React.ReactNode} [props.hint]
 * @param {React.ReactNode} [props.error] Marks the box invalid and prints under it.
 */
const SelectField = forwardRef(function SelectField(
  {
    id,
    label,
    hint,
    error,
    disabled = false,
    options,
    placeholder,
    className,
    boxClassName,
    selectClassName,
    children,
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
      className={className}
      boxClassName={boxClassName}
      trailing={<CaretDownIcon size={16} weight="bold" />}
    >
      {({ id: controlId, describedBy, invalid }) => (
        <select
          id={controlId}
          ref={ref}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={clsx(styles.field__select, selectClassName)}
          {...controlProps}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options
            ? options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))
            : children}
        </select>
      )}
    </Field>
  )
})

export default SelectField
