'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MagnifyingGlassIcon, SmileyIcon, XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import NativePopover from '@/components/ui/NativePopover'
import { EMOJI_GROUPS, loadRecentEmoji, rememberEmoji, searchEmoji } from '@/lib/emoji'
import styles from '@/components/EmojiPicker.module.scss'

const RECENT_SECTION = { key: 'recent', label: 'Recently used', icon: '\u{1F550}' }

/**
 * The composer's emoji tool: an anchored, non-modal panel (menus and pickers that do not need to
 * block the page are popovers here, never dialogs) holding a search field, a category strip and
 * the grid. Picking hands the glyph to `onSelect` and leaves the panel open — emoji arrive in
 * handfuls, and reopening the panel between each one is the whole cost of the feature.
 *
 * Nothing in here touches the editor. The caller owns the caret, which matters because the search
 * field takes focus away from it: see the insert path in components/NewPost.jsx.
 */
export default function EmojiPicker({ onSelect, disabled = false }) {
  const bodyRef = useRef(null)
  const searchRef = useRef(null)
  const sectionRefs = useRef({})
  const scrollFrameRef = useRef(null)

  // The grid is ~1100 buttons. None of them exist until the panel is opened for the first time.
  const [hasOpened, setHasOpened] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState([])
  const [activeSection, setActiveSection] = useState(EMOJI_GROUPS[0].key)

  const results = useMemo(() => searchEmoji(query), [query])
  const isSearching = query.trim().length > 0

  // Recents are read on open and then held still: re-sorting them under the pointer would move
  // the next emoji out from under a second click.
  const sections = useMemo(
    () =>
      recent.length > 0
        ? [{ ...RECENT_SECTION, items: recent.map((char) => ({ char, keywords: 'recently used' })) }, ...EMOJI_GROUPS]
        : EMOJI_GROUPS,
    [recent]
  )

  const handleBeforeToggle = useCallback((event) => {
    if (event.newState !== 'open') return
    // Mount and seed before the primitive measures the panel, so it anchors to the real box
    setHasOpened(true)
    setQuery('')
    setRecent(loadRecentEmoji())
  }, [])

  const handleToggle = useCallback((event) => {
    const open = event.newState === 'open'
    setIsOpen(open)
    if (!open) return
    if (bodyRef.current) bodyRef.current.scrollTop = 0
    setActiveSection(loadRecentEmoji().length > 0 ? RECENT_SECTION.key : EMOJI_GROUPS[0].key)
    // Touch has no keyboard until one is asked for: autofocusing the search field there raises the
    // software keyboard over the panel the user just opened.
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) searchRef.current?.focus()
  }, [])

  // Escape belongs to the panel while it is open. Without this the composer's own <dialog> takes
  // the same keypress as a cancel and the whole composer closes behind the picker.
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') event.preventDefault()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen])

  useEffect(() => () => cancelAnimationFrame(scrollFrameRef.current), [])

  const jumpToSection = (key) => {
    const body = bodyRef.current
    const section = sectionRefs.current[key]
    if (!body || !section) return
    setActiveSection(key)
    // offsetTop against the scroll box itself — scrollIntoView would drag the composer's own
    // scroll container along with it, and the page's global smooth scrolling with that
    body.scrollTop = section.offsetTop
  }

  // Which category the reader is actually looking at, so the strip follows the scroll
  const handleBodyScroll = () => {
    if (scrollFrameRef.current) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      const body = bodyRef.current
      if (!body || isSearching) return
      const position = body.scrollTop + 8
      let current = sections[0]?.key
      for (const section of sections) {
        const node = sectionRefs.current[section.key]
        if (node && node.offsetTop <= position) current = section.key
      }
      setActiveSection(current)
    })
  }

  const handlePick = (char) => {
    rememberEmoji(char)
    onSelect?.(char)
  }

  const renderGrid = (items, keyPrefix) => (
    <div className={styles.picker__grid}>
      {items.map((item, index) => (
        <button
          key={`${keyPrefix}-${item.char}-${index}`}
          type="button"
          className={styles.picker__emoji}
          // Keeps the caret where the author left it: no focus change, no selection loss
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => handlePick(item.char)}
          title={item.keywords}
          aria-label={item.keywords}
        >
          {item.char}
        </button>
      ))}
    </div>
  )

  return (
    <NativePopover
      placement="top-start"
      className={styles.picker}
      onBeforeToggle={handleBeforeToggle}
      onToggle={handleToggle}
      trigger={
        <button type="button" onMouseDown={(event) => event.preventDefault()} title="Emoji" aria-label="Add emoji" disabled={disabled}>
          <SmileyIcon size={20} />
        </button>
      }
    >
      {({ close }) => (
        <div className={styles.picker__panel}>
          <div className={styles.picker__search}>
            <MagnifyingGlassIcon size={16} />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search emoji"
              aria-label="Search emoji"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // The picker lives inside the composer's form — a bare Enter would submit the post
                if (event.key !== 'Enter') return
                event.preventDefault()
                if (results.length > 0) handlePick(results[0].char)
              }}
            />
            <button type="button" className={styles.picker__close} onClick={close} aria-label="Close emoji picker">
              <XIcon size={16} />
            </button>
          </div>

          {!isSearching && (
            <div className={styles.picker__tabs} role="tablist" aria-label="Emoji categories">
              {sections.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  role="tab"
                  aria-selected={activeSection === section.key}
                  className={clsx(styles.picker__tab, { [styles['picker__tab--active']]: activeSection === section.key })}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => jumpToSection(section.key)}
                  title={section.label}
                  aria-label={section.label}
                >
                  {section.icon}
                </button>
              ))}
            </div>
          )}

          <div ref={bodyRef} className={styles.picker__body} onScroll={handleBodyScroll}>
            {!hasOpened ? null : isSearching ? (
              results.length > 0 ? (
                renderGrid(results, 'search')
              ) : (
                <p className={styles.picker__empty}>No emoji match “{query.trim()}”</p>
              )
            ) : (
              sections.map((section) => (
                <section
                  key={section.key}
                  ref={(node) => {
                    sectionRefs.current[section.key] = node
                  }}
                  className={styles.picker__section}
                >
                  <h3 className={styles.picker__heading}>{section.label}</h3>
                  {renderGrid(section.items, section.key)}
                </section>
              ))
            )}
          </div>
        </div>
      )}
    </NativePopover>
  )
}
