'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { CubeIcon, DiamondIcon } from '@phosphor-icons/react'
import useNftMetadata from '@/hooks/useNftMetadata'
import { formatStake } from '@/hooks/useStakeToken'
import { displayTokenId } from '@/lib/walletNfts'
import { handleBrokenImage } from '@/lib/utils'
import { appChains } from '@/config/contracts'
import NftQuickBuy from '@/components/NftQuickBuy'
import Profile from '@/components/Profile'
import styles from './MarketTable.module.scss'

// Narrow, because the column is barely wider than the words — the same shaping the
// collection page's table uses
const ELAPSED_FORMAT = new Intl.RelativeTimeFormat(undefined, { numeric: 'always', style: 'narrow' })

/**
 * "12 min. ago" for a unix-second timestamp, in the largest unit that still reads as a
 * number. Local like CollectionTable's copy — fifteen lines is cheaper than a coupling.
 * @param {number|string} unixSeconds
 * @returns {string|null} Null for a missing or unparseable stamp.
 */
function elapsed(unixSeconds) {
  const seconds = Number(unixSeconds)
  if (!seconds) return null

  const delta = seconds - Math.floor(Date.now() / 1000)
  const absolute = Math.abs(delta)
  if (absolute < 60) return ELAPSED_FORMAT.format(Math.trunc(delta), 'second')
  if (absolute < 3600) return ELAPSED_FORMAT.format(Math.trunc(delta / 60), 'minute')
  if (absolute < 86400) return ELAPSED_FORMAT.format(Math.trunc(delta / 3600), 'hour')
  if (absolute < 2592000) return ELAPSED_FORMAT.format(Math.trunc(delta / 86400), 'day')
  return ELAPSED_FORMAT.format(Math.trunc(delta / 2592000), 'month')
}

// Same derivation the market cards, rail and table use — wagmi's config stamps iconUrl onto
// the shared chain objects as a side effect, so don't depend on that module having been
// evaluated first
const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

/**
 * One listing's row. Artwork and name resolve through the same metadata read-through the
 * grid's tiles use, so switching layouts costs no refetch — the SWR cache is shared.
 */
function MarketRow({ listing, onCollectionResolved }) {
  const networkId = Number(listing.network_id)
  const isLsp8 = Boolean(Number(listing.is_lsp8))
  const isSold = Number(listing.status) === 2
  const chain = appChains.find((c) => c.id === networkId)

  const metadata = useNftMetadata({
    chainId: networkId,
    collection: listing.collection,
    tokenId: listing.token_id,
    isLsp8,
    enabled: Boolean(listing.collection && listing.token_id),
    imageWidth: 96,
    still: true,
  })

  // Same report the grid's tiles file, so the toolbar's collection filter fills up
  // whichever layout is on screen
  useEffect(() => {
    if (!metadata.collectionName) return
    onCollectionResolved?.(listing.collection.toLowerCase(), metadata.collectionName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata.collectionName])

  const label = displayTokenId(listing.token_id)
  const collectionName = metadata.collectionName || null
  const name = metadata.name || (collectionName ? `${collectionName} #${label}` : `#${label}`)

  // The sub-line carries only what the top line doesn't already say. Most NFTs are named
  // "<collection> #<id>", and printing the id under itself made every row stutter — so the
  // collection shows only when the name doesn't already carry the brand, the id only when
  // the name doesn't end in it, and a row whose name says both gets one clean line.
  //
  // "Carries the brand" is judged on letters alone — lowercased, separators dropped — in
  // BOTH directions: "Chill Whales #7326" matches the collection "chillwhales", and
  // "Universal Apes #315" matches "On-Chain Universal Apes", whose prefix only the
  // collection side has.
  const normalize = (value) => String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const nameBase = normalize(name.replace(`#${label}`, ''))
  const collectionBase = normalize(collectionName || '')
  const brandInName = Boolean(nameBase) && Boolean(collectionBase) && (nameBase.includes(collectionBase) || collectionBase.includes(nameBase))
  const showCollection = Boolean(collectionName) && !brandInName
  const showId = !name.includes(`#${label}`)

  // store_tokens has no row for native currency, so symbol falls back to the chain's own —
  // the same fill-in every market surface does
  const price = listing.price ? formatStake(listing.price, listing.decimals) : null
  const symbol = listing.symbol || chain?.nativeCurrency?.symbol || ''
  const lastSale = listing.last_sale_price ? formatStake(listing.last_sale_price, listing.last_sale_decimals) : null
  const lastSaleSymbol = listing.last_sale_symbol || chain?.nativeCurrency?.symbol || ''
  const listedAgo = elapsed(listing.listed_at)
  const chainIcon = chainIconFor(chain)

  return (
    <tr className={styles.table__row}>
      <td className={styles.table__cell}>
        <span className={styles.table__item}>
          {/* The same door the grid's tiles open, so a reader who switched layouts doesn't
              get a different destination for the same click */}
          <Link href={`/nfts/${networkId}/${listing.listing_id}`} className={styles.table__itemLink}>
            <span className={styles.table__thumb}>
              {metadata.image ? (
                <img src={metadata.image} alt="" loading="lazy" decoding="async" onError={handleBrokenImage} />
              ) : (
                <span className={styles.table__thumbFallback} aria-hidden="true" />
              )}
              {/* The one column CollectionTable never needs: this table mixes chains */}
              {chainIcon && <img className={styles.table__chain} src={chainIcon} alt="" title={chain?.name} />}
            </span>

            <span className={styles.table__identity}>
              <span className={styles.table__name}>{name}</span>
              {(showCollection || showId) && (
                <span className={styles.table__tokenId}>
                  {showCollection && <span className={styles.table__collection}>{collectionName}</span>}
                  {showId && (
                    <>
                      <DiamondIcon size={10} weight="fill" />#{label}
                    </>
                  )}
                </span>
              )}
            </span>
          </Link>

          {isSold && <span className={styles.table__sold}>Sold</span>}
          {metadata.model && (
            <span
              className={styles.table__model}
              title={metadata.model.fileType ? `Ships a 3D file (.${metadata.model.fileType})` : 'Ships a 3D file'}
            >
              <CubeIcon size={11} weight="fill" />
              3D
            </span>
          )}
        </span>
      </td>

      <td className={clsx(styles.table__cell, styles['table__cell--price'], styles['table__cell--numeric'])}>
        {price ? (
          <span className={styles.table__price}>
            {price} <small>{symbol}</small>
          </span>
        ) : (
          <span className={styles.table__blank}>—</span>
        )}
      </td>

      <td className={clsx(styles.table__cell, styles['table__cell--lastSale'], styles['table__cell--numeric'])}>
        {lastSale ? (
          <span className={styles.table__price}>
            {lastSale} <small>{lastSaleSymbol}</small>
          </span>
        ) : (
          <span className={styles.table__blank}>—</span>
        )}
      </td>

      <td className={clsx(styles.table__cell, styles['table__cell--seller'])}>
        {/* Escrowed by HupTrade while listed, so the seller is the owner in every sense a
            buyer cares about — rendered through the shared Profile component like every
            wallet identity in the app. The compact variant: the full one prints the address
            under a display name that already ends in its #prefix tag, and a dense row can't
            afford saying 5d4a twice. The address survives on the hover card and the profile
            page behind the click. */}
        {listing.wallet_address ? (
          <Profile variant="compact" size={28} creator={listing.wallet_address} networkId={networkId} />
        ) : (
          <span className={styles.table__blank}>—</span>
        )}
      </td>

      <td className={clsx(styles.table__cell, styles['table__cell--listed'], styles['table__cell--numeric'])}>
        {listedAgo ? (
          <span className={styles.table__listed} title={new Date(Number(listing.listed_at) * 1000).toLocaleString()}>
            {listedAgo}
          </span>
        ) : (
          <span className={styles.table__blank}>—</span>
        )}
      </td>

      <td className={clsx(styles.table__cell, styles['table__cell--action'])}>
        <NftQuickBuy listing={listing} variant="inline" />
      </td>
    </tr>
  )
}

/**
 * Market Table
 * The list layout of the NFT Market's Items view — the counterpart of the collection page's
 * CollectionTable, across every collection and chain at once. One row per listing with the
 * facts a buyer compares down a column: what it is (and where), what it costs, what it last
 * went for, who is selling, how long it has been up, and the same quick buy the tiles carry.
 *
 * The collection-scoped columns (rarity, floor diff, top offer) are deliberately absent:
 * each is an answer relative to ONE collection, and printing them across a mixed page would
 * rank unlike numbers.
 * @param {Object} props
 * @param {Array} props.listings Rows from GET /api/v1/nfts, as the grid holds them.
 * @param {boolean} [props.isLoading] Renders shimmer rows instead of content.
 * @param {number} [props.skeletonRows=12] How many shimmer rows hold the space.
 * @param {Function} [props.onCollectionResolved] Same callback the tiles get — feeds the
 * toolbar's collection filter as names resolve.
 */
export default function MarketTable({ listings, isLoading = false, skeletonRows = 12, onCollectionResolved }) {
  return (
    <div className={styles.table__scroll}>
      <table className={styles.table}>
        <thead className={styles.table__head}>
          <tr>
            <th scope="col" className={styles.table__heading}>
              Item
            </th>
            <th scope="col" className={clsx(styles.table__heading, styles['table__cell--price'], styles['table__cell--numeric'])}>
              Price
            </th>
            <th scope="col" className={clsx(styles.table__heading, styles['table__cell--lastSale'], styles['table__cell--numeric'])}>
              Last sale
            </th>
            <th scope="col" className={clsx(styles.table__heading, styles['table__cell--seller'])}>
              Seller
            </th>
            <th scope="col" className={clsx(styles.table__heading, styles['table__cell--listed'], styles['table__cell--numeric'])}>
              Listed
            </th>
            <th scope="col" className={clsx(styles.table__heading, styles['table__cell--action'])}>
              <span className={styles.table__headingHidden}>Actions</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {isLoading
            ? Array.from({ length: skeletonRows }).map((_, index) => (
                <tr key={index} className={styles.table__row}>
                  <td className={styles.table__cell} colSpan={6}>
                    <span className={styles.table__skeleton} />
                  </td>
                </tr>
              ))
            : listings.map((listing) => (
                <MarketRow
                  key={`${listing.network_id}-${listing.listing_id}`}
                  listing={listing}
                  onCollectionResolved={onCollectionResolved}
                />
              ))}
        </tbody>
      </table>
    </div>
  )
}
