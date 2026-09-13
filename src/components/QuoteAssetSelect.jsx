'use client'

/**
 * @file components/QuoteAssetSelect.jsx
 * @description Picks what a launch is paired against — the chain's coin, a stablecoin, or one of
 * the hundreds of tokenized equities a chain's issuer lists.
 *
 * A dropdown rather than the row of buttons this replaced, because the list stopped being three
 * items the moment equities arrived. Anchored and non-modal, so NativePopover: the page behind it
 * never needs blocking, and a modal inside the launch dialog would be a dialog inside a dialog.
 *
 * The filter appears only once the list is long enough to need one — on a chain offering a coin
 * and one stablecoin, a search box is furniture.
 */

import { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import NativePopover from '@/components/ui/NativePopover'
import { CaretDownIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import styles from './QuoteAssetSelect.module.scss'

const FILTER_THRESHOLD = 8

/**
 * @param {Object} props
 * @param {Array<{address: string, symbol: string, name?: string, logo?: string|null}>} props.options
 * @param {string} props.value Selected asset address.
 * @param {Function} props.onChange Receives the chosen address.
 * @param {boolean} [props.disabled]
 */
const QuoteAssetSelect = ({ options, value, onChange, disabled = false }) => {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  const selected = options.find((option) => option.address.toLowerCase() === value?.toLowerCase()) ?? options[0]
  const showFilter = options.length > FILTER_THRESHOLD

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options

    // Ticker first: someone typing "NV" wants NVDA above every company whose name contains it
    const byTicker = options.filter((option) => option.symbol.toLowerCase().startsWith(needle))
    const byName = options.filter(
      (option) => !option.symbol.toLowerCase().startsWith(needle) && `${option.symbol} ${option.name ?? ''}`.toLowerCase().includes(needle),
    )
    return [...byTicker, ...byName]
  }, [options, query])

  const renderMark = (option) =>
    option.logo ? (
      <img className={styles.quoteSelect__logo} src={option.logo} alt="" loading="lazy" />
    ) : (
      <span className={styles.quoteSelect__logo} aria-hidden="true">
        {option.symbol.slice(0, 1)}
      </span>
    )

  return (
    <NativePopover
      placement="bottom-start"
      className={styles.quoteSelect__panel}
      onToggle={(event) => {
        if (event.newState !== 'open') {
          setQuery('')
          return
        }
        // The filter is the whole point of opening a 194-name list, so it takes the caret
        requestAnimationFrame(() => inputRef.current?.focus())
      }}
      trigger={
        <button type="button" className={styles.quoteSelect__trigger} disabled={disabled}>
          {selected && renderMark(selected)}
          <strong>{selected?.symbol ?? '—'}</strong>
          <CaretDownIcon size={14} weight="bold" />
        </button>
      }
    >
      {({ close }) => (
        <>
          {showFilter && (
            <label className={styles.quoteSelect__search}>
              <MagnifyingGlassIcon size={14} />
              <input
                ref={inputRef}
                type="search"
                value={query}
                placeholder="Search ticker or name"
                aria-label="Search paired assets"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          )}

          <ul className={styles.quoteSelect__list} role="listbox">
            {matches.map((option) => (
              <li key={option.address}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.address.toLowerCase() === value?.toLowerCase()}
                  className={clsx(
                    styles.quoteSelect__option,
                    option.address.toLowerCase() === value?.toLowerCase() && styles['quoteSelect__option--active'],
                  )}
                  onClick={() => {
                    onChange(option.address)
                    close()
                  }}
                >
                  {renderMark(option)}
                  <strong>{option.symbol}</strong>
                  <em>{option.name}</em>
                </button>
              </li>
            ))}

            {matches.length === 0 && <li className={styles.quoteSelect__empty}>Nothing matches “{query}”</li>}
          </ul>
        </>
      )}
    </NativePopover>
  )
}

export default QuoteAssetSelect
