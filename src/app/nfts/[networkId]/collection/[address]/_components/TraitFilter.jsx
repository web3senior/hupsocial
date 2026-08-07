'use client'

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { FunnelIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import NativePopover from '@/components/ui/NativePopover'
import Tooltip from '@/components/ui/Tooltip'
import styles from './TraitFilter.module.scss'

const COUNT_FORMAT = new Intl.NumberFormat('en')

// The panel is a filter, not a browser: past this many groups the search box is the only
// usable way in, so it appears rather than being always-on chrome
const SEARCH_THRESHOLD = 6

// A tab can't survive the server-side trim, so it can't forge a collision between pairs
const traitKey = (label, value) => `${label}\t${value}`

// A group matched by its own label keeps all of its values — "show me everything under
// Background" is a reasonable thing to type into the search box
const matchTraits = (traits, query) => {
  const needle = query.trim().toLowerCase()
  if (!needle) return traits

  return traits
    .map((group) => {
      if (group.label.toLowerCase().includes(needle)) return group
      const values = group.values.filter((entry) => entry.value.toLowerCase().includes(needle))
      return values.length > 0 ? { ...group, values } : null
    })
    .filter(Boolean)
}

/**
 * Trait Filter
 * The collection page's attribute funnel: one collapsible group per trait label, each value a
 * checkbox carrying how many of the collection's listed NFTs have it.
 *
 * Non-modal by nature — the grid behind it stays readable while values are ticked, and every
 * tick re-queries — so it is a NativePopover rather than a dialog.
 * @param {Object} props
 * @param {Array<{label: string, values: Array<{value: string, count: number}>}>} props.traits
 * Facets from useCollectionTraits.
 * @param {Array<{label: string, value: string}>} props.selected Currently applied pairs.
 * @param {Function} props.onChange Called with the next selection array.
 * @param {boolean} [props.isLoading] Facets still resolving.
 * @param {number|null} [props.listed] NFTs the current view can show.
 * @param {number|null} [props.resolved] Of those, how many have cached metadata — the traits
 * below describe exactly that many.
 */
export default function TraitFilter({ traits, selected, onChange, isLoading, listed, resolved }) {
  const [query, setQuery] = useState('')
  // Groups holding a selection start open — that is where the user was last working
  const [openGroups, setOpenGroups] = useState(() => new Set(selected.map((pair) => pair.label)))

  const selectedKeys = useMemo(() => new Set(selected.map((pair) => traitKey(pair.label, pair.value))), [selected])
  const visibleTraits = useMemo(() => matchTraits(traits, query), [traits, query])

  // Searching expands what matched — collapsed results would hide the very thing that was
  // searched for. Done here rather than by overriding `open` during render, so a group can
  // still be collapsed by hand mid-search. Clearing the box returns to the selection view.
  const handleSearch = (value) => {
    setQuery(value)
    setOpenGroups(
      value.trim() ? new Set(matchTraits(traits, value).map((group) => group.label)) : new Set(selected.map((pair) => pair.label)),
    )
  }

  const toggleValue = (label, value) => {
    const key = traitKey(label, value)
    onChange(selectedKeys.has(key) ? selected.filter((pair) => traitKey(pair.label, pair.value) !== key) : [...selected, { label, value }])
  }

  const toggleGroup = (label, isOpen) => {
    setOpenGroups((previous) => {
      const next = new Set(previous)
      if (isOpen) next.add(label)
      else next.delete(label)
      return next
    })
  }

  const hasCoverageGap = listed !== null && resolved !== null && resolved < listed

  return (
    <NativePopover
      placement="bottom-end"
      className={styles.traitFilter}
      trigger={
        <Tooltip
          placement="top-end"
          content={
            traits.length > 0
              ? 'Filter this collection by NFT traits. Values under one trait widen the results; picking two different traits narrows them.'
              : 'Traits appear here once the collection NFTs on the market have resolved theirs.'
          }
        >
          <button
            type="button"
            className={clsx(styles.traitFilter__trigger, selected.length > 0 && styles['traitFilter__trigger--active'])}
            aria-label="Filter by traits"
          >
            <FunnelIcon size={14} />
            Traits
            {selected.length > 0 && <span className={styles.traitFilter__badge}>{selected.length}</span>}
          </button>
        </Tooltip>
      }
    >
      {() => (
        <div className={styles.traitFilter__body}>
          {traits.length >= SEARCH_THRESHOLD && (
            <label className={styles.traitFilter__search}>
              <MagnifyingGlassIcon size={14} aria-hidden="true" />
              <input type="search" placeholder="Search traits" aria-label="Search traits" value={query} onChange={(e) => handleSearch(e.target.value)} />
            </label>
          )}

          {isLoading && traits.length === 0 ? (
            <p className={styles.traitFilter__hint}>Loading traits...</p>
          ) : visibleTraits.length === 0 ? (
            <p className={styles.traitFilter__hint}>
              {traits.length === 0 ? 'No NFT from this collection on the market carries traits yet.' : 'No trait matches that search.'}
            </p>
          ) : (
            <div className={styles.traitFilter__groups}>
              {visibleTraits.map((group) => {
                const selectedInGroup = group.values.filter((entry) => selectedKeys.has(traitKey(group.label, entry.value))).length

                return (
                  <details
                    key={group.label}
                    className={styles.traitFilter__group}
                    open={openGroups.has(group.label)}
                    onToggle={(e) => toggleGroup(group.label, e.currentTarget.open)}
                  >
                    <summary className={styles.traitFilter__groupSummary}>
                      <span className={styles.traitFilter__groupLabel}>{group.label}</span>
                      {selectedInGroup > 0 && <span className={styles.traitFilter__groupCount}>{selectedInGroup}</span>}
                    </summary>

                    <ul className={styles.traitFilter__values}>
                      {group.values.map((entry) => (
                        <li key={entry.value}>
                          <label className={styles.traitFilter__value}>
                            <input
                              type="checkbox"
                              checked={selectedKeys.has(traitKey(group.label, entry.value))}
                              onChange={() => toggleValue(group.label, entry.value)}
                            />
                            <span className={styles.traitFilter__valueName} title={entry.value}>
                              {entry.value}
                            </span>
                            <small>{COUNT_FORMAT.format(entry.count)}</small>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </details>
                )
              })}
            </div>
          )}

          {/* Traits are only known for NFTs the app has already resolved, so a filtered grid
              can genuinely be missing listings. Saying so beats a silently short grid. */}
          {hasCoverageGap && (
            <p className={styles.traitFilter__hint}>
              Traits known for {COUNT_FORMAT.format(resolved)} of {COUNT_FORMAT.format(listed)} NFTs here — the rest fill in as they load.
            </p>
          )}

          {selected.length > 0 && (
            <button type="button" className={styles.traitFilter__reset} onClick={() => onChange([])}>
              Clear traits
            </button>
          )}
        </div>
      )}
    </NativePopover>
  )
}
