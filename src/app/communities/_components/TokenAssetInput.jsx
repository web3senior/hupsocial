'use client'

// Asset field for a token-balance requirement: type a token's name to search the chain's known
// tokens (lib/tokenSearch — Envio on LUKSO, GeckoTerminal elsewhere), pick one to fill the
// address, or paste a 0x address directly. A blank field is the chain's native coin, which is
// how the contract spells a NativeBalance requirement — so the placeholder says so instead of
// demanding an address. onChange(address, pickedResult?) — the second argument is set only when a
// search result was picked, so a consumer can read its isLsp7 flag without a second lookup.

import { useEffect, useId, useState } from 'react'
import { isAddress } from 'viem'
import clsx from 'clsx'
import { formatTokenPopularity, searchTokens } from '@/lib/tokenSearch'
import { getNativeCurrency, useTokenMeta } from '../tokenUnits'
import styles from './TokenAssetInput.module.scss'

const MIN_QUERY_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 350

export default function TokenAssetInput({ value, onChange, chainId, inputClassName, style, allowNative = true, required = false }) {
  const listId = useId()
  const [results, setResults] = useState([])
  const [isFocused, setIsFocused] = useState(false)

  const trimmed = (value ?? '').trim()
  const isQuery = !isAddress(trimmed) && trimmed.length >= MIN_QUERY_LENGTH
  const nativeSymbol = getNativeCurrency(chainId).symbol
  // Echo what a pasted/picked address resolved to, so a wrong address is obvious before saving
  const { symbol: resolvedSymbol } = useTokenMeta(isAddress(trimmed) ? trimmed : '', chainId)

  // Debounced name search — a pasted address never triggers one (isAddress short-circuits it),
  // same rhythm as the tip/offer modals' custom-token fields
  useEffect(() => {
    if (!isQuery || !chainId) return

    let cancelled = false
    const timeout = setTimeout(() => {
      searchTokens(chainId, trimmed).then((found) => {
        if (!cancelled) setResults(found)
      })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [isQuery, trimmed, chainId])

  // Derived at render rather than cleared from the effect, so a pasted address or an emptied
  // field hides the previous query's list immediately instead of one debounce later
  const visibleResults = isFocused && isQuery ? results : []

  return (
    <div className={styles.assetInput} style={style}>
      <input
        className={inputClassName}
        placeholder={allowNative && nativeSymbol ? `Token name or 0x… — blank = ${nativeSymbol}` : 'Token name or 0x… address'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        // Delayed so a click on a result lands before the list unmounts
        onBlur={() => setTimeout(() => setIsFocused(false), 150)}
        autoComplete="off"
        spellCheck={false}
        required={required}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={visibleResults.length > 0}
      />
      {resolvedSymbol && isAddress(trimmed) && (
        <span className={styles.assetInput__resolved} title={trimmed}>
          {resolvedSymbol}
        </span>
      )}
      {visibleResults.length > 0 && (
        <ul id={listId} className={styles.assetInput__results} role="listbox">
          {visibleResults.map((result) => {
            const popularity = formatTokenPopularity(result)
            return (
              <li key={result.address} role="option" aria-selected={false}>
                <button
                  type="button"
                  className={styles.assetInput__result}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onChange(result.address, result)}
                >
                  <span className={styles.assetInput__resultMain}>
                    <span className={styles.assetInput__resultSymbol}>{result.symbol}</span>
                    {result.name && <span className={styles.assetInput__resultName}>{result.name}</span>}
                  </span>
                  <span className={styles.assetInput__resultMeta}>
                    <span className={clsx(styles.assetInput__resultAddress)}>
                      {result.address.slice(0, 6)}…{result.address.slice(-4)}
                    </span>
                    {popularity && <span>{popularity}</span>}
                  </span>
                </button>
              </li>
            )
          })}
          <li className={styles.assetInput__warning} role="presentation">
            Anyone can create a token with any name — check the address before saving.
          </li>
        </ul>
      )}
    </div>
  )
}
