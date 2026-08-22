'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react'
import { getNftCollectionRanking } from '@/lib/api'
import { appChains, CONTRACTS } from '@/config/contracts'
import { formatStake } from '@/hooks/useStakeToken'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { handleBrokenImage } from '@/lib/utils'
import useCollectionInfo from '@/hooks/useCollectionInfo'
import Tooltip from '@/components/ui/Tooltip'
import HupMark from '@/components/ui/HupMark'
import styles from './CollectionsTable.module.scss'

// Only chains with a HupTrade deployment can have a collection on this table at all
const tradeChains = appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.trade)

const NETWORK_OPTIONS = [{ value: '', label: 'All networks' }, ...tradeChains.map((chain) => ({ value: String(chain.id), label: chain.name }))]

const COUNT = new Intl.NumberFormat()
// The sign carries the direction, so the cell never needs the words "up"/"down"
const CHANGE = new Intl.NumberFormat(undefined, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 2 })
const SHARE = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })

const ROWS = 50
const SKELETON_ROWS = 10

/**
 * Columns, in the order they print. `sort` names the server-side ORDER BY this header asks
 * for; the two identity columns have none, because a rank is only meaningful in the order
 * something else put the rows in.
 *
 * `quoted` marks a column denominated in a collection's own dominant payment token. Ranking
 * those across chains lines up LYX against ETH against USDC, which is not a ranking of
 * anything — so every one of them says so on hover rather than quietly pretending the order
 * means more than it does.
 */
const COLUMNS = [
  { key: 'rank', label: '#', className: 'rank' },
  { key: 'collection', label: 'Collection', className: 'collection' },
  { key: 'supply', label: 'Supply', sort: 'supply', className: 'supply', tooltip: 'How many NFTs the contract has minted. Blank until Hup has read the collection once.' },
  { key: 'floor', label: 'Floor', sort: 'floor', className: 'floor', quoted: true, tooltip: 'The cheapest NFT you can buy right now.' },
  {
    key: 'bestOffer',
    label: 'Best offer',
    sort: 'bestOffer',
    className: 'bestOffer',
    quoted: true,
    tooltip: 'The highest live offer on any single NFT in this collection. HupTrade bids name a token, so this is not a price every holder can sell into — open the NFT it was made on to accept it.',
  },
  { key: 'volume24h', label: '24h vol', sort: 'volume24h', className: 'volume24h', quoted: true, tooltip: 'What this collection traded for on HupTrade in the last 24 hours.' },
  { key: 'change24h', label: '24h Δ', sort: 'change24h', className: 'change24h', tooltip: 'How the last 24 hours of volume compares with the 24 before it.' },
  { key: 'sales24h', label: 'Sales', sort: 'sales24h', className: 'sales24h', tooltip: 'Sales settled in the last 24 hours. A count, so it ranks the same on every chain.' },
  { key: 'marketCap', label: 'Market cap', sort: 'marketCap', className: 'marketCap', quoted: true, tooltip: 'Floor price times total supply — what the collection would be worth if every NFT were the cheapest one. Needs a supply, so it is blank where Hup has none.' },
  { key: 'volumeTotal', label: 'Total vol', sort: 'volumeTotal', className: 'volumeTotal', quoted: true, tooltip: 'Everything this collection has traded for on HupTrade, all time.' },
  { key: 'listed', label: 'Listed', sort: 'listed', className: 'listed', tooltip: 'How much of the supply is on the market right now, and how many NFTs that is.' },
]

const CROSS_CHAIN_NOTE = ' Quoted in each collection’s own payment token, so ordering by it across networks compares unlike currencies.'

// Same derivation NftMarketCard and the hero rail use — wagmi's config stamps iconUrl onto the
// shared chain objects as a side effect, so don't depend on that module having been evaluated
const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

/**
 * Floor times supply, exactly.
 *
 * Both sides arrive as strings — the floor in base units, the supply as a plain integer — and
 * the product of a wei-scale price and a five-figure supply overflows a double long before it
 * overflows BigInt. So it is multiplied whole and only formatted afterwards.
 * @param {string} floor Floor price, in base units.
 * @param {string} supply Total supply, as an integer string.
 * @returns {bigint|null} Null when either side is missing or unparseable.
 */
function marketCap(floor, supply) {
  if (!floor || !supply) return null
  try {
    const total = BigInt(supply)
    return total === 0n ? null : BigInt(floor) * total
  } catch {
    return null
  }
}

/**
 * A currency cell: the amount beside its symbol, or a dash. Native-coin rows carry no
 * store_tokens entry, so both symbol and decimals fall back to the chain's own currency —
 * the same fill-in the floor chart and the hero cards do.
 *
 * Zero reads as a dash rather than "0 LYX": every figure in this table is a total over a
 * window, and a total of zero means nothing happened, not that something was worth nothing.
 */
function Amount({ value, symbol, decimals, chain }) {
  const isNative = symbol == null && decimals == null
  const resolvedDecimals = decimals ?? (isNative ? chain?.nativeCurrency?.decimals : undefined)
  const resolvedSymbol = symbol || (isNative ? chain?.nativeCurrency?.symbol : '')
  const formatted = formatStake(value, resolvedDecimals)

  if (!formatted || formatted === '0') return <span className={styles.collections__blank}>—</span>

  return (
    <span className={styles.collections__amount}>
      {formatted} <small>{resolvedSymbol}</small>
    </span>
  )
}

/**
 * One collection's row.
 *
 * Name and artwork come out of nft_collection_cache where cidex or an earlier visit has
 * already put them. Where it hasn't, the row falls back to the same read-through the
 * collection page uses — which fills the cache on its way past, so a collection only pays for
 * this once and every later ranking prints it server-side.
 */
function CollectionRow({ row, rank }) {
  const networkId = Number(row.network_id)
  const chain = appChains.find((c) => c.id === networkId)
  const chainIcon = chainIconFor(chain)
  const address = String(row.collection).toLowerCase()

  const hasIdentity = Boolean(row.name)
  const info = useCollectionInfo({
    chainId: networkId,
    collection: address,
    isLsp8: Boolean(Number(row.is_lsp8)),
    enabled: !hasIdentity,
    iconWidth: 96,
  })

  const name = row.name || info.name || `${address.slice(0, 6)}…${address.slice(-4)}`
  const icon = hasIdentity ? resolveStorageImageUrl(row.icon_uri, { width: 96, still: true }) : info.icon

  const supply = row.total_supply || info.totalSupply || null
  const activeCount = Number(row.active_count) || 0
  const listedShare = supply && Number(supply) > 0 ? activeCount / Number(supply) : null

  const cap = marketCap(row.floor_price, supply)
  const change = row.change_24h === null || row.change_24h === undefined ? null : Number(row.change_24h)

  // Nothing traded yesterday and something traded today is a real event, but it isn't a
  // percentage — a change from zero has no denominator, and "+∞%" is not a number a reader
  // can rank against the row above it
  const isNew = change === null && Number(row.sales_24h) > 0

  return (
    <tr className={styles.collections__row}>
      <td className={clsx(styles.collections__cell, styles['collections__cell--rank'], styles['collections__cell--numeric'])}>{rank}</td>

      <td className={clsx(styles.collections__cell, styles['collections__cell--collection'])}>
        <Link href={`/nfts/${networkId}/collection/${address}`} className={styles.collections__identity}>
          <span className={styles.collections__thumb}>
            {icon ? (
              <img src={icon} alt="" loading="lazy" decoding="async" onError={handleBrokenImage} />
            ) : (
              <span className={styles.collections__thumbFallback} aria-hidden="true">
                <HupMark size={16} />
              </span>
            )}
            {chainIcon && <img className={styles.collections__chain} src={chainIcon} alt="" title={chain?.name} />}
          </span>

          <span className={clsx(styles.collections__name, !hasIdentity && !info.name && styles['collections__name--pending'])}>{name}</span>
        </Link>
      </td>

      <td className={clsx(styles.collections__cell, styles['collections__cell--supply'], styles['collections__cell--numeric'])}>
        {supply ? COUNT.format(Number(supply)) : <span className={styles.collections__blank}>—</span>}
      </td>

      <td className={clsx(styles.collections__cell, styles['collections__cell--floor'], styles['collections__cell--numeric'])}>
        <Amount value={row.floor_price} symbol={row.floor_symbol} decimals={row.floor_decimals} chain={chain} />
      </td>

      <td className={clsx(styles.collections__cell, styles['collections__cell--bestOffer'], styles['collections__cell--numeric'])}>
        <span title={row.offer_count > 1 ? `Best of ${COUNT.format(row.offer_count)} live offers across this collection` : undefined}>
          <Amount value={row.best_offer} symbol={row.offer_symbol} decimals={row.offer_decimals} chain={chain} />
        </span>
      </td>

      <td className={clsx(styles.collections__cell, styles['collections__cell--volume24h'], styles['collections__cell--numeric'])}>
        <Amount value={row.volume_24h} symbol={row.volume_symbol} decimals={row.volume_decimals} chain={chain} />
      </td>

      <td className={clsx(styles.collections__cell, styles['collections__cell--change24h'], styles['collections__cell--numeric'])}>
        {isNew ? (
          <span className={styles.collections__new} title="Traded today, nothing in the 24 hours before — there is no previous total to measure against">
            New
          </span>
        ) : change === null || change === 0 ? (
          <span className={styles.collections__blank}>—</span>
        ) : (
          <span className={clsx(styles.collections__change, change < 0 && styles['collections__change--down'])}>
            {change < 0 ? <CaretDownIcon size={10} weight="bold" aria-hidden="true" /> : <CaretUpIcon size={10} weight="bold" aria-hidden="true" />}
            {CHANGE.format(change)}
          </span>
        )}
      </td>

      <td className={clsx(styles.collections__cell, styles['collections__cell--sales24h'], styles['collections__cell--numeric'])}>
        {Number(row.sales_24h) > 0 ? (
          <span title={`${COUNT.format(row.sales_total)} all time`}>{COUNT.format(row.sales_24h)}</span>
        ) : (
          <span className={styles.collections__blank}>—</span>
        )}
      </td>

      <td className={clsx(styles.collections__cell, styles['collections__cell--marketCap'], styles['collections__cell--numeric'])}>
        {cap === null ? (
          <span className={styles.collections__blank} title={supply ? undefined : 'Needs a total supply, which Hup has not read for this collection yet'}>
            —
          </span>
        ) : (
          <Amount value={cap.toString()} symbol={row.floor_symbol} decimals={row.floor_decimals} chain={chain} />
        )}
      </td>

      <td className={clsx(styles.collections__cell, styles['collections__cell--volumeTotal'], styles['collections__cell--numeric'])}>
        <Amount value={row.volume_total} symbol={row.volume_symbol} decimals={row.volume_decimals} chain={chain} />
      </td>

      <td className={clsx(styles.collections__cell, styles['collections__cell--listed'], styles['collections__cell--numeric'])}>
        {activeCount === 0 ? (
          <span className={styles.collections__blank} title="Nothing on the market right now">
            —
          </span>
        ) : (
          <span className={styles.collections__listed}>
            {listedShare === null ? COUNT.format(activeCount) : SHARE.format(listedShare)}
            {listedShare !== null && <small>({COUNT.format(activeCount)})</small>}
          </span>
        )}
      </td>
    </tr>
  )
}

/**
 * Collections Table
 * The market read as a league table: every collection with something listed or something
 * traded, ranked by whichever column the reader clicks. The card rail answers "what is on the
 * shelf"; this answers "what is moving", which is a different question and needs every stat
 * computed across the whole market before a single row can be placed.
 *
 * Ordering is the server's — sorting a page of fifty in the browser would only ever reorder
 * the fifty the previous sort chose.
 * @param {Object} props
 * @param {string} props.networkId Chain filter, shared with the listings grid through the URL.
 * @param {Function} props.onNetworkChange Writes the chain filter back to the query string.
 */
export default function CollectionsTable({ networkId = '', onNetworkChange }) {
  const [sort, setSort] = useState('volume24h')
  const [rows, setRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      try {
        const res = await getNftCollectionRanking({ limit: ROWS, networkId: networkId || undefined, sort })
        if (cancelled) return
        setRows(res.data || [])
        setError(null)
      } catch {
        if (cancelled) return
        setRows([])
        setError('Could not load the collections ranking')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()

    return () => {
      cancelled = true
    }
  }, [networkId, sort])

  const chainName = useMemo(() => NETWORK_OPTIONS.find((o) => o.value === networkId)?.label ?? 'All networks', [networkId])

  return (
    <section className={styles.collections} aria-label="Collections ranking">
      <header className={styles.collections__toolbar}>
        <p className={styles.collections__caption}>
          Ranked across {chainName === 'All networks' ? 'every network' : chainName} by what has actually traded through HupTrade. Tap a
          column to reorder.
        </p>

        <Tooltip content="Rank collections on one chain. Prices are quoted per collection, so a single network is the only place a money column ranks like for like.">
          <select
            aria-label="Network"
            className={clsx(styles.collections__select, networkId && styles['collections__select--active'])}
            value={networkId}
            onChange={(e) => onNetworkChange?.(e.target.value)}
          >
            {NETWORK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Tooltip>
      </header>

      <div className={styles.collections__scroll}>
        <table className={styles.collections__table}>
          <thead className={styles.collections__head}>
            <tr>
              {COLUMNS.map((column) => {
                const isActive = column.sort === sort
                const tooltip = column.tooltip ? `${column.tooltip}${column.quoted ? CROSS_CHAIN_NOTE : ''}` : null

                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={clsx(styles.collections__heading, styles[`collections__cell--${column.className}`], column.key !== 'collection' && styles['collections__cell--numeric'])}
                    aria-sort={isActive ? 'descending' : undefined}
                  >
                    {column.sort ? (
                      <Tooltip content={tooltip}>
                        <button
                          type="button"
                          className={clsx(styles.collections__sort, isActive && styles['collections__sort--active'])}
                          onClick={() => setSort(column.sort)}
                        >
                          {column.label}
                          {isActive && <CaretDownIcon size={10} weight="bold" aria-hidden="true" />}
                        </button>
                      </Tooltip>
                    ) : (
                      column.label
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              Array.from({ length: SKELETON_ROWS }).map((_, index) => (
                <tr key={index} className={styles.collections__row}>
                  <td className={styles.collections__cell} colSpan={COLUMNS.length}>
                    <span className={styles.collections__skeleton} />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr className={styles.collections__row}>
                <td className={clsx(styles.collections__cell, styles.collections__empty)} colSpan={COLUMNS.length}>
                  {error || `Nothing has been listed or traded on ${chainName === 'All networks' ? 'any network' : chainName} yet.`}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => <CollectionRow key={`${row.network_id}-${row.collection}`} row={row} rank={index + 1} />)
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
