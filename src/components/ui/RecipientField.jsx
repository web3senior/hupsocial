'use client'

/**
 * @file components/ui/RecipientField.jsx
 * @description The one recipient input in the app. Wherever a user has to say which wallet
 * something goes to, this is the field: type a name, a Universal Profile, an ENS name, or paste an
 * address, and it resolves to one wallet with a face on it.
 *
 * It is a text field first and a picker second, on purpose. Pasting an address must never get
 * slower or less reliable than it was as a plain input — the suggestions are an addition to that,
 * not a gate in front of it, which is why the field stays usable with every upstream down.
 *
 * The suggestion list is a NativePopover, not a dialog: it is anchored, non-modal, and must never
 * block the form behind it.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { CheckCircleIcon } from '@phosphor-icons/react'
import {
  EMPTY_RECIPIENT,
  RECIPIENT_GROUP_LABELS,
  recipientFromInput,
  recipientFromSuggestion,
} from '@/lib/recipientSearch'
import useRecipientSuggestions from '@/hooks/useRecipientSuggestions'
import NativePopover from './NativePopover'
import styles from './RecipientField.module.scss'

const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

const shortAddress = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`

const initialFor = (suggestion) => (suggestion.name || suggestion.address.slice(2)).slice(0, 1).toUpperCase()

/**
 * @param {Object} props
 * @param {{input: string, address: string|null, profile: Object|null}} props.value Field value.
 * @param {(next: {input: string, address: string|null, profile: Object|null}) => void} props.onChange
 * @param {string|null} [props.viewer] The sending wallet — seeds recents and the "you follow" list.
 * @param {string[]} [props.exclude] Addresses to leave out of the suggestions.
 * @param {string} [props.label] Field label; pass null to render the input on its own.
 * @param {string} [props.className] Applied to the field wrapper.
 * @param {string} [props.labelClassName] Replaces the built-in label styling.
 * @param {string} [props.inputClassName] Replaces the built-in input styling, for call sites that
 * already have their own. These replace rather than append — two single-class rules have equal
 * specificity, so which one won would come down to stylesheet order.
 * @param {string} [props.hint] Explanatory line under the field.
 */
export default function RecipientField({
  value = EMPTY_RECIPIENT,
  onChange,
  viewer = null,
  exclude,
  id,
  name,
  label = 'Recipient address',
  className,
  labelClassName,
  inputClassName,
  placeholder = 'Name, ENS, or 0x address',
  hint,
  disabled = false,
  required = false,
  autoFocus = false,
}) {
  const generatedId = useId()
  const inputId = id || `recipient-${generatedId}`
  const rootRef = useRef(null)
  const popoverRef = useRef(null)
  // A text input can't be a native popover invoker (popovertarget only works on buttons), so the
  // panel is opened and closed imperatively from the input's own events — and its open state has
  // to be tracked here, since light dismiss happens without going through this component
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const { suggestions, isLoading, resolved } = useRecipientSuggestions({
    query: value.input,
    viewer,
    exclude,
    enabled: !disabled,
  })

  // onChange is called from effects and handlers alike; holding it in a ref keeps the resolution
  // effect from re-running just because the parent re-rendered with a fresh closure
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // A name only becomes an address once the server says so, and a pasted address only gets a face
  // the same way. Both land here.
  //
  // A value that already carries a profile came from an explicit pick and is left alone: a Hup
  // display name can coincide with somebody else's ENS name, and quietly retargeting a transfer
  // to whatever the resolver preferred is the one failure this field must never have. The key
  // guard is belt-and-braces against a call site that renders without applying onChange.
  const appliedRef = useRef(null)
  useEffect(() => {
    if (!resolved || value.profile) return

    const key = `${value.input}|${resolved.address}`
    if (appliedRef.current === key) return
    appliedRef.current = key

    onChangeRef.current({ input: value.input, address: resolved.address, profile: resolved })
  }, [resolved, value.input, value.profile])

  // The panel floats in the top layer, so it can't inherit a width from the input by layout —
  // the measured field width rides in as a custom property instead
  const [fieldWidth, setFieldWidth] = useState(null)
  useEffect(() => {
    const node = rootRef.current
    if (!node || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(([observed]) => setFieldWidth(observed.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const trimmed = value.input.trim()
  const picked = value.address ? value.profile : null

  const error = useMemo(() => {
    if (!trimmed || value.address || isLoading) return null
    if (trimmed.toLowerCase().startsWith('0x')) return 'That isn’t a valid wallet address.'
    if (suggestions.length > 0) return 'Pick who you mean from the list.'
    return 'No profile, ENS name, or wallet matches that.'
  }, [trimmed, value.address, isLoading, suggestions.length])

  const openPanel = () => {
    if (!disabled) popoverRef.current?.open()
  }

  const select = (suggestion) => {
    onChangeRef.current(recipientFromSuggestion(suggestion))
    setActiveIndex(0)
    popoverRef.current?.close()
  }

  const handleChange = (event) => {
    // Retyping the same name after clearing the field must resolve again
    appliedRef.current = null
    onChangeRef.current(recipientFromInput(event.target.value))
    setActiveIndex(0)
    openPanel()
  }

  // Keyboard navigation belongs to the open list and nothing else — with the panel closed, Enter
  // still submits whatever form the field was dropped into
  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      // NativePopover's own capture listener has already hidden the panel by the time this runs,
      // but the keypress is still on its way to the dialog behind it, which would cancel too.
      // Dismissing the list and dismissing the form are two decisions and deserve two presses.
      if (isOpen) {
        event.preventDefault()
        event.stopPropagation()
      }
      popoverRef.current?.close()
      return
    }
    if (!isOpen || suggestions.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      select(suggestions[Math.min(activeIndex, suggestions.length - 1)])
    }
  }

  return (
    <div
      ref={rootRef}
      className={clsx(styles.recipientField, className)}
      style={fieldWidth ? { '--recipient-field-width': `${fieldWidth}px` } : undefined}
    >
      {label && (
        <label className={labelClassName || styles.recipientField__label} htmlFor={inputId}>
          {label}
        </label>
      )}

      <NativePopover
        ref={popoverRef}
        placement="bottom-start"
        className={styles.recipientField__panel}
        onToggle={(event) => {
          setIsOpen(event.newState === 'open')
          if (event.newState !== 'open') setActiveIndex(0)
        }}
        trigger={
          <input
            type="text"
            id={inputId}
            name={name}
            className={inputClassName || styles.recipientField__input}
            value={value.input}
            onChange={handleChange}
            onFocus={openPanel}
            // A text input can't be a popover invoker (popovertarget only applies to buttons), so
            // the browser doesn't know this input owns the panel and light-dismisses it on the very
            // pointerup that focused it. The click lands after that and puts it back.
            onClick={openPanel}
            // The panel is a DOM child of this wrapper even while it floats in the top layer, so
            // reaching into it for the network filter isn't leaving the field
            onBlur={(event) => {
              if (!rootRef.current?.contains(event.relatedTarget)) popoverRef.current?.close()
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            required={required}
            autoFocus={autoFocus}
            role="combobox"
            aria-expanded={isOpen}
            aria-autocomplete="list"
            aria-activedescendant={isOpen && suggestions.length > 0 ? `${inputId}-option-${activeIndex}` : undefined}
            aria-invalid={Boolean(error)}
          />
        }
      >
        {suggestions.length > 0 ? (
          <ul className={styles.recipientField__suggestions} role="listbox" aria-label="Matching wallets">
            {suggestions.map((suggestion, index) => (
              <li key={suggestion.address} role="presentation">
                {suggestion.source !== suggestions[index - 1]?.source && (
                  <p className={styles.recipientField__group}>{RECIPIENT_GROUP_LABELS[suggestion.source]}</p>
                )}
                {/* mousedown would blur the input and close the panel before the click lands */}
                <button
                  type="button"
                  id={`${inputId}-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-active={index === activeIndex ? 'true' : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(suggestion)}
                >
                  <span className={styles.recipientField__avatar}>
                    {suggestion.avatar ? <img src={suggestion.avatar} alt="" /> : <span>{initialFor(suggestion)}</span>}
                  </span>
                  <span className={styles.recipientField__main}>
                    <span className={styles.recipientField__name}>
                      {suggestion.name || suggestion.ensName || 'Unnamed wallet'}
                    </span>
                    <span className={styles.recipientField__address}>{shortAddress(suggestion.address)}</span>
                  </span>
                  <span className={styles.recipientField__meta}>
                    {suggestion.ensName && suggestion.ensName !== suggestion.name && <span>{suggestion.ensName}</span>}
                    {suggestion.followerCount > 0 && <span>{compactNumber.format(suggestion.followerCount)} followers</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.recipientField__empty}>
            {isLoading
              ? 'Looking…'
              : trimmed.length > 0
              ? 'Nobody by that name — paste the wallet address instead.'
              : 'Type a name, a Universal Profile, an ENS name, or paste an address.'}
          </p>
        )}
      </NativePopover>

      {/* Confirming who the address belongs to is the whole point of resolving it — a send is
          irreversible, so the answer stays on screen after the picker closes. The name is absent
          until the lookup lands, which is why the address is the part that is always shown. */}
      {value.address && (
        <span className={styles.recipientField__resolved}>
          <CheckCircleIcon size={14} weight="fill" />
          {picked?.avatar && <img src={picked.avatar} alt="" />}
          {(picked?.name || picked?.ensName) && <strong>{picked.name || picked.ensName}</strong>}
          <code>{shortAddress(value.address)}</code>
        </span>
      )}

      {error && <span className={styles.recipientField__error}>{error}</span>}
      {hint && <span className={styles.recipientField__hint}>{hint}</span>}
    </div>
  )
}
