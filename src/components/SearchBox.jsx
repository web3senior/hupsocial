'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useConnection } from 'wagmi'
import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import Profile from '@/components/Profile'
import useRecipientSuggestions from '@/hooks/useRecipientSuggestions'
import { anchorElement } from '@/components/ui/NativePopover'
import styles from './SearchBox.module.scss'

export const MIN_SEARCH_LENGTH = 2
const PANEL_MIN_WIDTH = 360
const PANEL_MARGIN = 16
const PERSON_AVATAR_SIZE = 36

// The same page the profile itself canonicalizes to, so a result opens where a byline would
export const profileHref = (person) => (person.username ? `/@${person.username}` : `/${person.address}`)

/**
 * The one search box, wherever it sits: the home header and /search both render it. Typing looks
 * people up as a typeahead under the box — the people route merges Hup handles, display names, ENS
 * and Universal Profile names, and answers fast enough to run per keystroke. Posts are a LIKE scan
 * over every chain's content, so they wait for a submit: Enter, the search icon, or the "Search
 * posts for" row. What a submit does is the caller's — the header navigates to /search, the search
 * page renders results in place.
 *
 * The panel is a manual popover anchored under the box, so a click back into the input never
 * light-dismisses it; the box owns open/closed from focus and blur, like MentionPicker does.
 *
 * @param {Object} props
 * @param {string} [props.initialQuery] What the box starts with (the URL's ?q= on /search).
 * @param {(query: string) => void} props.onSubmit Called with the trimmed query on a submit.
 * @param {string} [props.className] The pill chrome around the icon and input.
 * @param {string} [props.inputClassName] Chrome for the input itself.
 * @param {string} [props.placeholder]
 */
export default function SearchBox({ initialQuery = '', onSubmit, className, inputClassName, placeholder = 'Search' }) {
  const router = useRouter()
  const { address } = useConnection()
  const formRef = useRef(null)
  const panelRef = useRef(null)

  const [query, setQuery] = useState(initialQuery)
  const [isFocused, setIsFocused] = useState(false)
  // 0 is the "Search posts" row, so Enter searches unless a person was arrowed to
  const [activeIndex, setActiveIndex] = useState(0)

  const trimmed = query.trim()
  const isActive = trimmed.length >= MIN_SEARCH_LENGTH
  const isOpen = isFocused && isActive

  const { suggestions: people, isLoading } = useRecipientSuggestions({ query: trimmed, viewer: address, enabled: isOpen })
  const optionCount = 1 + people.length

  useEffect(() => {
    setActiveIndex(0)
  }, [trimmed])

  useLayoutEffect(() => {
    const panel = panelRef.current
    const form = formRef.current
    if (!panel || !form) return

    if (!isOpen) {
      if (panel.matches(':popover-open')) panel.hidePopover()
      return
    }
    if (!panel.matches(':popover-open')) panel.showPopover()

    // As wide as the box, but never narrower than a list of names needs; anchorElement then
    // measures that width when it clamps the panel to the viewport
    const { width } = form.getBoundingClientRect()
    panel.style.width = `${Math.max(width, Math.min(PANEL_MIN_WIDTH, window.innerWidth - PANEL_MARGIN))}px`
    anchorElement(panel, form, 'bottom-start')
  }, [isOpen, people.length, isLoading])

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

  const submit = useCallback(() => {
    if (!isActive) return
    setIsFocused(false)
    formRef.current?.querySelector('input')?.blur()
    onSubmit?.(trimmed)
  }, [isActive, trimmed, onSubmit])

  const openPerson = useCallback(
    (person) => {
      setIsFocused(false)
      router.push(profileHref(person))
    },
    [router]
  )

  const handleSubmit = (event) => {
    event.preventDefault()
    const person = activeIndex > 0 ? people[activeIndex - 1] : null
    if (person) openPerson(person)
    else submit()
  }

  const handleKeyDown = (event) => {
    if (!isOpen) return
    if (event.key === 'Escape') {
      event.preventDefault()
      setIsFocused(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((index) => (index + step + optionCount) % optionCount)
    }
  }

  return (
    <>
      <form ref={formRef} role="search" className={clsx(styles.box, className)} onSubmit={handleSubmit}>
        <button type="submit" className={styles.box__submit} aria-label="Search">
          <MagnifyingGlassIcon size={18} aria-hidden="true" />
        </button>
        <input
          type="search"
          className={clsx(styles.box__input, inputClassName)}
          placeholder={placeholder}
          aria-label="Search posts and people"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          autoComplete="off"
          enterKeyHint="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setIsFocused(true)
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
        />
      </form>

      <div ref={panelRef} popover="manual" className={styles.panel}>
        {isOpen && (
          <ul className={styles.panel__list} role="listbox" aria-label="Search suggestions">
            <li
              role="option"
              aria-selected={activeIndex === 0}
              data-active={activeIndex === 0}
              className={clsx(styles.option, styles['option--search'])}
              // Keeps the input's focus, so the blur that closes the panel never beats the click
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(0)}
              onClick={submit}
            >
              <MagnifyingGlassIcon size={20} aria-hidden="true" />
              <span className={styles.option__label}>
                Search posts for <strong>{trimmed}</strong>
              </span>
            </li>

            {people.map((person, index) => (
              <li
                key={person.address}
                role="option"
                aria-selected={activeIndex === index + 1}
                data-active={activeIndex === index + 1}
                className={styles.option}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index + 1)}
                onClick={() => openPerson(person)}
                onTouchStart={() => router.prefetch(profileHref(person))}
              >
                <Profile creator={person.address} variant="fullWithoutTime" size={PERSON_AVATAR_SIZE} hoverCard={false} />
                {person.ensName && <code className={styles.option__ens}>{person.ensName}</code>}
              </li>
            ))}

            {people.length === 0 && <li className={styles.panel__status}>{isLoading ? 'Searching people…' : 'No people found'}</li>}
          </ul>
        )}
      </div>
    </>
  )
}
