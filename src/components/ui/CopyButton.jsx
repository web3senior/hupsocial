'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { CheckIcon, CopyIcon } from '@phosphor-icons/react'
import { toast } from '@/components/NextToast'
import styles from './CopyButton.module.scss'

// Long enough to be seen by someone whose eyes were on the thing they copied, short enough that
// a second copy of a different value never inherits the first one's tick
const CONFIRM_MS = 1600

/**
 * Copy Button
 * Copies a string and says so in place — the tick replaces the icon rather than firing a toast
 * nobody asked for, so a copy that happens under the reader's cursor is confirmed where they
 * are already looking. A toast is opt-in for surfaces where the button scrolls away.
 *
 * Safe inside a clickable row: the click never reaches an enclosing card, and default is
 * prevented so a button sitting on top of a stretched link does not navigate.
 * @param {Object} props
 * @param {string} props.value The text to place on the clipboard. A value starting with `/` is
 *   copied as an absolute URL against the current origin, so a caller can hand over a route
 *   without reading `window` during a render the server also performs.
 * @param {import('react').ReactNode} [props.label] Visible label beside the icon; icon-only
 *   without it, in which case `title` becomes the accessible name.
 * @param {string} [props.title='Copy link'] Tooltip and accessible name.
 * @param {string} [props.copiedTitle='Copied'] Tooltip and label once it lands.
 * @param {string} [props.toastMessage] Also toast this on success.
 * @param {number} [props.size=14] Icon size in px.
 * @param {'ghost'|'chip'} [props.variant='ghost'] 'chip' draws a bordered pill.
 * @param {string} [props.className] Placement class from the consumer's module.
 * @param {Function} [props.onCopied] Called after a successful copy.
 */
export default function CopyButton({
  value,
  label,
  title = 'Copy link',
  copiedTitle = 'Copied',
  toastMessage,
  size = 14,
  variant = 'ghost',
  className,
  onCopied,
}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const handleCopy = async (event) => {
    // Both, and in this order: a card that navigates on click must not, and neither must a
    // stretched link underneath this button
    event.preventDefault()
    event.stopPropagation()

    if (!value) return

    try {
      // Absent on an insecure origin, where the whole API is undefined rather than failing
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      // A pasted path is useless to whoever receives it — resolved here, at click time, where
      // the origin is always known
      await navigator.clipboard.writeText(value.startsWith('/') ? `${window.location.origin}${value}` : value)

      setCopied(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), CONFIRM_MS)

      if (toastMessage) toast(toastMessage, 'success')
      onCopied?.()
    } catch {
      toast('Could not copy — your browser blocked the clipboard', 'error')
    }
  }

  return (
    <button
      type="button"
      className={clsx(styles.copy, styles[`copy--${variant}`], copied && styles['copy--copied'], className)}
      onClick={handleCopy}
      title={copied ? copiedTitle : title}
      aria-label={copied ? copiedTitle : title}
    >
      {copied ? <CheckIcon size={size} weight="bold" aria-hidden="true" /> : <CopyIcon size={size} aria-hidden="true" />}
      {label && <span>{copied ? copiedTitle : label}</span>}
    </button>
  )
}
