'use client'

// A select replacement: a trigger showing the current choice, and a NativePopover menu where
// every option can carry a one-line explanation underneath — the part a native <select> can't
// show. Anchored, non-modal UI, so it's a popover (not a dialog) per the app's top-layer rules;
// it works from inside a modal too since both live in the top layer.
//
// `options`: [{ value, label, icon?, note?, disabled?, disabledNote? }]. An icon is any node —
// a chain's picture, a glyph — and the chosen one leads the trigger too, so a row of pickers
// can be read without captions over it. A disabled option stays visible (greyed, with
// disabledNote replacing its note) so people can see what unlocks it.

import { useCallback, useRef, useState } from 'react'
import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import NativePopover from '@/components/ui/NativePopover'
import styles from './OptionPicker.module.scss'

export default function OptionPicker({ value, onChange, options, ariaLabel, triggerClassName, panelClassName, placement = 'bottom-start' }) {
  const current = options.find((option) => option.value === value)

  // The menu is exactly as wide as its trigger, like a native select's dropdown — a fixed width
  // ran past the modal's edge from the right-hand column. Measured when the popover is about to
  // open (the trigger fills its field, so the wrapper's width is the trigger's width) and handed
  // to the panel through a CSS variable, since NativePopover owns the panel element.
  const wrapperRef = useRef(null)
  const [panelWidth, setPanelWidth] = useState(null)
  const measure = useCallback((event) => {
    if (event.newState === 'open' && wrapperRef.current) setPanelWidth(wrapperRef.current.offsetWidth)
  }, [])

  return (
    <div ref={wrapperRef} className={styles.picker} style={panelWidth ? { '--picker-width': `${panelWidth}px` } : undefined}>
      <NativePopover
        placement={placement}
        onBeforeToggle={measure}
        className={clsx(styles.picker__popover, panelClassName)}
        trigger={
          <button type="button" className={clsx(styles.picker__trigger, triggerClassName)} aria-label={ariaLabel} aria-haspopup="listbox">
            {current?.icon && (
              <span className={styles.picker__icon} aria-hidden="true">
                {current.icon}
              </span>
            )}
            <span className={styles.picker__triggerLabel}>{current?.label ?? '—'}</span>
            <CaretDownIcon size={16} className={styles.picker__chevron} aria-hidden="true" />
          </button>
        }
      >
        {({ close }) => (
          <div className={styles.picker__panel} role="listbox" aria-label={ariaLabel}>
            {options.map((option) => {
              const isActive = option.value === value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={Boolean(option.disabled)}
                  className={clsx(styles.picker__option, isActive && styles['picker__option--active'])}
                  onClick={() => {
                    onChange(option.value)
                    close()
                  }}
                >
                  {option.icon && (
                    <span className={styles.picker__icon} aria-hidden="true">
                      {option.icon}
                    </span>
                  )}
                  <span className={styles.picker__optionText}>
                    <span className={styles.picker__optionLabel}>{option.label}</span>
                    {(option.disabled && option.disabledNote) || option.note ? (
                      <span className={styles.picker__optionNote}>
                        {option.disabled && option.disabledNote ? option.disabledNote : option.note}
                      </span>
                    ) : null}
                  </span>
                  {isActive && <CheckIcon size={16} className={styles.picker__check} aria-hidden="true" />}
                </button>
              )
            })}
          </div>
        )}
      </NativePopover>
    </div>
  )
}
