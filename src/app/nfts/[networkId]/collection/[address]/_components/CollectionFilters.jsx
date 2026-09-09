'use client'

import { useEffect, useState } from 'react'
import { useReadContract } from 'wagmi'
import { erc20Abi, parseUnits } from 'viem'
import clsx from 'clsx'
import { SlidersHorizontalIcon, XIcon } from '@phosphor-icons/react'
import { getNftPaymentTokens, getNftSellers } from '@/lib/api'
import { useProfile } from '@/hooks/useProfile'
import Avatar from '@/components/ui/Avatar'
import NativePopover from '@/components/ui/NativePopover'
import Tooltip from '@/components/ui/Tooltip'
import styles from './CollectionFilters.module.scss'

// The same order keys GET /api/v1/nfts resolves in SQL
export const SORT_OPTIONS = [
  { value: 'newest', label: 'Recently listed' },
  { value: 'oldest', label: 'Oldest listed' },
  { value: 'price_asc', label: 'Lowest price' },
  { value: 'price_desc', label: 'Highest price' },
  { value: 'referral_desc', label: 'Highest referral reward' },
  { value: 'recently_sold', label: 'Recently sold' },
]

// Thresholds in basis points — the API takes 'any'/'none' or a minimum bps
export const REFERRAL_OPTIONS = [
  { value: '', label: 'Any referral' },
  { value: 'any', label: 'Pays a referral' },
  { value: '500', label: '5% or more' },
  { value: '1000', label: '10% or more' },
  { value: 'none', label: 'No referral' },
]

// minPrice/maxPrice hold what was typed; the *Base twins hold the same in the payment
// token's base units, which is what the API compares against
export const DEFAULT_COLLECTION_FILTERS = {
  sort: 'newest',
  referral: '',
  token: '',
  tokenLabel: '',
  seller: '',
  sellerName: '',
  minPrice: '',
  maxPrice: '',
  minPriceBase: '',
  maxPriceBase: '',
}

const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`

const labelOf = (options, value) => options.find((option) => option.value === value)?.label || value

const sellerLabel = (user) => user.display_name || shortAddress(user.wallet_address)

const toBaseUnits = (value, decimals) => {
  if (!value) return ''
  try {
    return parseUnits(value, decimals).toString()
  } catch {
    // Invalid number typed mid-edit — the filter sits out until it parses
    return ''
  }
}

/**
 * Every applied filter as a removable chip descriptor. `reset` is the patch that clears it,
 * so the page can render the chips without knowing what any of them mean.
 * @param {Object} filters A DEFAULT_COLLECTION_FILTERS-shaped object.
 */
export function describeFilters(filters) {
  const chips = []

  if (filters.sort !== DEFAULT_COLLECTION_FILTERS.sort) {
    chips.push({ key: 'sort', label: 'Sort', value: labelOf(SORT_OPTIONS, filters.sort), reset: { sort: DEFAULT_COLLECTION_FILTERS.sort } })
  }
  if (filters.referral) {
    chips.push({ key: 'referral', label: 'Referral', value: labelOf(REFERRAL_OPTIONS, filters.referral), reset: { referral: '' } })
  }
  if (filters.token) {
    chips.push({ key: 'token', label: 'Currency', value: filters.tokenLabel || filters.token, reset: { token: '', tokenLabel: '' } })
  }
  if (filters.seller) {
    chips.push({ key: 'seller', label: 'Seller', value: filters.sellerName || shortAddress(filters.seller), reset: { seller: '', sellerName: '' } })
  }
  if (filters.minPrice || filters.maxPrice) {
    chips.push({
      key: 'price',
      label: 'Price',
      value: `${filters.minPrice || '0'} – ${filters.maxPrice || 'any'}`,
      reset: { minPrice: '', maxPrice: '', minPriceBase: '', maxPriceBase: '' },
    })
  }

  return chips
}

export const activeFilterCount = (filters) => describeFilters(filters).length

// One chain, so every row is already this collection's own currency list
function buildTokenOptions(rows, chainInfo) {
  return rows
    .map((row) => ({
      value: row.is_native ? 'native' : String(row.token).toLowerCase(),
      label: row.is_native ? row.symbol || chainInfo?.nativeCurrency?.symbol || 'Native currency' : row.symbol || shortAddress(String(row.token)),
      decimals: row.decimals ?? (row.is_native ? (chainInfo?.nativeCurrency?.decimals ?? null) : null),
      count: row.listing_count || 0,
    }))
    .sort((a, b) => b.count - a.count)
}

// store_tokens already carries decimals for anything the indexer has named, so the onchain
// read (the same `decimals()` selector ERC20 and LSP7 share) is only a fallback
function usePriceDecimals(chainId, token, indexedDecimals, chainInfo) {
  const isSpecificToken = Boolean(token && token !== 'native')
  const needsRead = isSpecificToken && indexedDecimals == null

  const { data: tokenDecimals } = useReadContract({
    abi: erc20Abi,
    address: needsRead ? token : undefined,
    functionName: 'decimals',
    chainId,
    query: { enabled: needsRead },
  })

  if (isSpecificToken) return indexedDecimals ?? tokenDecimals ?? 18
  return chainInfo?.nativeCurrency?.decimals ?? 18
}

// The seller's own artwork, resolved from the address — the sellers API's profile_image is
// DB/UP-only and leaves plain EOAs pointing at nothing
function SellerAvatar({ address, name }) {
  const { profile } = useProfile(address)

  if (!profile?.profileImage) {
    return (
      <span className={clsx(styles.filters__sellerAvatar, styles['filters__sellerAvatar--fallback'])} aria-hidden="true">
        {(name || address).slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return <Avatar className={styles.filters__sellerAvatar} src={profile.profileImage} size={24} />
}

/**
 * Collection Filters
 * The market page's filter panel, scoped to one collection: sort, referral share, payment
 * token, seller and price range. Network, collection and NFT standard are fixed by the page
 * itself, and listing status is the tab strip beside this — so none of those appear here.
 *
 * Controlled: the page owns the filter object, because the popover's body unmounts when it
 * closes and a half-typed price range has to survive that.
 * @param {Object} props
 * @param {number} props.chainId Chain the collection lives on.
 * @param {string} props.collection Collection contract address, lowercased.
 * @param {Object} [props.chainInfo] Entry from appChains — native currency symbol/decimals.
 * @param {Object} props.value A DEFAULT_COLLECTION_FILTERS-shaped object.
 * @param {Function} props.onChange Called with the next filter object. Must be stable.
 */
export default function CollectionFilters({ chainId, collection, chainInfo, value, onChange }) {
  const [tokenOptions, setTokenOptions] = useState([])
  const [isLoadingTokens, setIsLoadingTokens] = useState(true)
  const [sellerQuery, setSellerQuery] = useState('')
  const [sellerOptions, setSellerOptions] = useState([])
  const [isLoadingSellers, setIsLoadingSellers] = useState(false)
  const [isSellerFocused, setIsSellerFocused] = useState(false)

  const selectedToken = tokenOptions.find((option) => option.value === value.token)
  const priceDecimals = usePriceDecimals(chainId, value.token, selectedToken?.decimals, chainInfo)
  const chips = describeFilters(value)

  const set = (patch) => onChange({ ...value, ...patch })

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoadingTokens(true)
      try {
        const res = await getNftPaymentTokens(chainId, collection)
        if (!cancelled) setTokenOptions(buildTokenOptions(res.data || [], chainInfo))
      } catch {
        if (!cancelled) setTokenOptions([])
      } finally {
        if (!cancelled) setIsLoadingTokens(false)
      }
    }
    load()

    return () => {
      cancelled = true
    }
  }, [chainId, collection, chainInfo])

  // An empty query still fetches — it returns this collection's busiest sellers, so the list
  // has something to offer the moment the field is focused
  useEffect(() => {
    if (value.seller) return
    let cancelled = false

    const timer = setTimeout(async () => {
      setIsLoadingSellers(true)
      try {
        const res = await getNftSellers(sellerQuery.trim(), String(chainId), collection)
        if (!cancelled) setSellerOptions(res.data || [])
      } catch {
        if (!cancelled) setSellerOptions([])
      } finally {
        if (!cancelled) setIsLoadingSellers(false)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sellerQuery, chainId, collection, value.seller])

  // A picked token's decimals can land after the price was typed, so the base units are
  // re-derived rather than converted once at the keystroke
  useEffect(() => {
    const minPriceBase = toBaseUnits(value.minPrice, priceDecimals)
    const maxPriceBase = toBaseUnits(value.maxPrice, priceDecimals)
    if (minPriceBase === value.minPriceBase && maxPriceBase === value.maxPriceBase) return
    onChange({ ...value, minPriceBase, maxPriceBase })
  }, [value, priceDecimals, onChange])

  return (
    <NativePopover
      placement="bottom-end"
      className={styles.filters}
      trigger={
        <Tooltip
          placement="top-end"
          content={
            chips.length > 0
              ? `${chips.length} ${chips.length === 1 ? 'filter is' : 'filters are'} set in this panel.`
              : 'Sort this collection and filter it by referral share, payment token, seller or price.'
          }
        >
          <button type="button" className={clsx(styles.filters__trigger, chips.length > 0 && styles['filters__trigger--active'])} aria-label="Sort and filter">
            <SlidersHorizontalIcon size={14} />
            Sort
            {chips.length > 0 && <span className={styles.filters__badge}>{chips.length}</span>}
          </button>
        </Tooltip>
      }
    >
      {() => (
        <div className={styles.filters__body}>
          <div className={styles.filters__field}>
            <label htmlFor="collectionFilterSort">Sort</label>
            <select id="collectionFilterSort" value={value.sort} onChange={(e) => set({ sort: e.target.value })}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.filters__field}>
            <label htmlFor="collectionFilterReferral">Referral reward</label>
            <select id="collectionFilterReferral" value={value.referral} onChange={(e) => set({ referral: e.target.value })}>
              {REFERRAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.filters__field}>
            <label htmlFor="collectionFilterToken">Payment token</label>
            <select
              id="collectionFilterToken"
              value={value.token}
              disabled={tokenOptions.length === 0}
              onChange={(e) => set({ token: e.target.value, tokenLabel: labelOf(tokenOptions, e.target.value) })}
            >
              <option value="">Any</option>
              {tokenOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
            {tokenOptions.length === 0 && (
              <small className={styles.filters__hint}>{isLoadingTokens ? 'Loading currencies...' : 'Nothing from this collection has been listed yet'}</small>
            )}
          </div>

          <div className={clsx(styles.filters__field, styles['filters__field--seller'])}>
            <label htmlFor="collectionFilterSeller">Seller</label>
            {value.seller ? (
              <div className={styles.filters__sellerPick}>
                <SellerAvatar address={value.seller} name={value.sellerName} />
                <span className={styles.filters__sellerName}>{value.sellerName || shortAddress(value.seller)}</span>
                <button type="button" className={styles.filters__sellerClear} aria-label="Clear seller filter" onClick={() => set({ seller: '', sellerName: '' })}>
                  <XIcon size={14} />
                </button>
              </div>
            ) : (
              <>
                <input
                  id="collectionFilterSeller"
                  type="text"
                  autoComplete="off"
                  placeholder="Name or wallet address"
                  value={sellerQuery}
                  onChange={(e) => setSellerQuery(e.target.value)}
                  onFocus={() => setIsSellerFocused(true)}
                  onBlur={() => setIsSellerFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && sellerOptions.length > 0) {
                      e.preventDefault()
                      setSellerQuery('')
                      set({ seller: sellerOptions[0].wallet_address, sellerName: sellerLabel(sellerOptions[0]) })
                    }
                  }}
                />
                {/* preventDefault on mousedown keeps the input focused while clicking inside —
                    otherwise blur hides the list before the option's click can land */}
                {(isSellerFocused || sellerQuery.trim()) && (
                  <div className={styles.filters__sellerDropdown} onMouseDown={(e) => e.preventDefault()}>
                    {sellerOptions.length > 0 ? (
                      <ul className={styles.filters__sellerList} aria-label="Matching sellers">
                        {sellerOptions.map((user) => (
                          <li key={user.wallet_address}>
                            <button
                              type="button"
                              className={styles.filters__sellerOption}
                              onClick={() => {
                                setSellerQuery('')
                                set({ seller: user.wallet_address, sellerName: sellerLabel(user) })
                              }}
                            >
                              <SellerAvatar address={user.wallet_address} name={user.display_name} />
                              <span className={styles.filters__sellerName}>{sellerLabel(user)}</span>
                              <small>{user.listing_count}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <small className={styles.filters__hint}>{isLoadingSellers ? 'Searching sellers...' : 'No sellers match'}</small>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className={styles.filters__field}>
            <label>Price range{selectedToken ? ` (${selectedToken.label})` : chainInfo?.nativeCurrency?.symbol ? ` (${chainInfo.nativeCurrency.symbol})` : ''}</label>
            <div className={styles.filters__range}>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="Min"
                aria-label="Minimum price"
                value={value.minPrice}
                onChange={(e) => set({ minPrice: e.target.value })}
              />
              <span>–</span>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="Max"
                aria-label="Maximum price"
                value={value.maxPrice}
                onChange={(e) => set({ maxPrice: e.target.value })}
              />
            </div>
            {/* Prices are compared in one currency's units — with none picked that is the
                chain's own, so a range typed against a token listing would read wrong */}
            {!value.token && <small className={styles.filters__hint}>In {chainInfo?.nativeCurrency?.symbol || 'the native currency'} unless a payment token is picked</small>}
          </div>

          {chips.length > 0 && (
            <button type="button" className={styles.filters__reset} onClick={() => onChange({ ...DEFAULT_COLLECTION_FILTERS })}>
              Reset filters
            </button>
          )}
        </div>
      )}
    </NativePopover>
  )
}
