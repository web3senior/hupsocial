'use client'

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import Avatar from '@/components/ui/Avatar'
import useRecipientSuggestions from '@/hooks/useRecipientSuggestions'
import styles from './MentionPicker.module.scss'

const GAP = 6
const MARGIN = 8
const AVATAR_SIZE = 32

const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`

/**
 * People suggestions for an `@query` typed in the composer.
 *
 * A manual popover, so a click back into the editor doesn't light-dismiss it behind the composer's
 * back — the composer owns open/closed through `caretRect`. It is placed against the caret rather
 * than through NativePopover's anchorElement, which needs a real element to anchor to; the composer
 * is a fixed modal, so viewport coordinates are the right frame.
 *
 * Keys arrive through the imperative `handleKeyDown`, because focus never leaves the editor.
 */
const MentionPicker = forwardRef(function MentionPicker({ query, caretRect, viewer, onPick, onDismiss }, ref) {
  const panelRef = useRef(null)
  const isOpen = Boolean(caretRect)
  const [activeIndex, setActiveIndex] = useState(0)

  const { suggestions, isLoading } = useRecipientSuggestions({
    query,
    viewer,
    exclude: viewer ? [viewer] : undefined,
    enabled: isOpen,
  })

  // An empty `@` offers who the viewer follows; with nothing to offer it stays out of the way
  const hasBody = suggestions.length > 0 || (query.length >= 2 && isOpen)
  const isVisible = isOpen && hasBody

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    if (!isVisible) {
      if (panel.matches(':popover-open')) panel.hidePopover()
      return
    }
    if (!panel.matches(':popover-open')) panel.showPopover()

    const { innerWidth: vw, innerHeight: vh } = window
    const { offsetWidth: pw, offsetHeight: ph } = panel
    const below = caretRect.bottom + GAP
    const top = below + ph > vh - MARGIN && caretRect.top - GAP - ph >= MARGIN ? caretRect.top - GAP - ph : below
    const left = Math.min(Math.max(caretRect.left, MARGIN), Math.max(MARGIN, vw - pw - MARGIN))

    panel.style.top = `${top}px`
    panel.style.left = `${left}px`
  }, [isVisible, caretRect, suggestions.length, isLoading])

  useEffect(() => {
    const panel = panelRef.current
    return () => {
      try {
        panel?.hidePopover()
      } catch {
        /* already closed */
      }
    }
  }, [])

  useEffect(() => {
    panelRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  useImperativeHandle(
    ref,
    () => ({
      // Returns true when the key was spent on the picker
      handleKeyDown(event) {
        if (!isVisible) return false

        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onDismiss()
          return true
        }
        if (suggestions.length === 0) return false

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const step = event.key === 'ArrowDown' ? 1 : -1
          setActiveIndex((index) => (index + step + suggestions.length) % suggestions.length)
          return true
        }
        if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
          event.preventDefault()
          onPick(suggestions[Math.min(activeIndex, suggestions.length - 1)])
          return true
        }
        return false
      },
    }),
    [isVisible, suggestions, activeIndex, onPick, onDismiss],
  )

  return (
    <div ref={panelRef} popover="manual" className={styles.mentionPicker}>
      {isVisible &&
        (suggestions.length > 0 ? (
          <ul className={styles.mentionPicker__list} role="listbox" aria-label="People to mention">
            {suggestions.map((suggestion, index) => (
              <li key={suggestion.address} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  data-active={index === activeIndex}
                  className={styles.mentionPicker__option}
                  // Keeps the editor's focus and caret, which the insert is measured from
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => onPick(suggestion)}
                >
                  <Avatar src={suggestion.avatar} size={AVATAR_SIZE} className={styles.mentionPicker__avatar} />
                  <span className={styles.mentionPicker__identity}>
                    <strong className={styles.mentionPicker__name}>{suggestion.name || suggestion.ensName || 'Unnamed wallet'}</strong>
                    <span className={styles.mentionPicker__address}>
                      {suggestion.username ? `@${suggestion.username}` : shortAddress(suggestion.address)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.mentionPicker__status}>{isLoading ? 'Searching…' : 'No one found'}</p>
        ))}
    </div>
  )
})

export default MentionPicker
