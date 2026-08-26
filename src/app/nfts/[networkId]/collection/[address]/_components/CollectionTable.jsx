'use client'

import Link from 'next/link'
import clsx from 'clsx'
import { CubeIcon, DiamondIcon } from '@phosphor-icons/react'
import useNftMetadata from '@/hooks/useNftMetadata'
import { formatStake } from '@/hooks/useStakeToken'
import { displayTokenId } from '@/lib/walletNfts'
// Shared with the token page's offer book, so an ask and a bid on the same collection are
// measured against its floor by one rule
import { PERCENT_FORMAT, readFloorDelta } from '@/lib/nftFloorDelta'
import { handleBrokenImage } from '@/lib/utils'
import NftQuickBuy from '@/components/NftQuickBuy'
import styles from './CollectionTable.module.scss'

const RANK_FORMAT = new Intl.NumberFormat()

// Narrow, because the column is barely wider than the words: "3 hr. ago", not "3 hours ago"
const ELAPSED_FORMAT = new Intl.RelativeTimeFormat(undefined, { numeric: 'always', style: 'narrow' })

const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`

/**
 * "12 min. ago" for a unix-second timestamp, in the largest unit that still reads as a number.
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

/**
 * What a rank in this column actually means, spelled out on hover. The two sources make very
 * different claims — one is the collection's own number over its whole supply, the other is
 * this app's, over the tokens it has seen — and a bare "#7" can't carry that difference.
 * @param {number} rank
 * @param {Object} rarity From useCollectionRarity.
 */
function rankTitle(rank, rarity) {
  if (rarity.source === 'published') {
    return `Rank ${RANK_FORMAT.format(rank)} of ${RANK_FORMAT.format(rarity.total)}, as published by the collection`
  }

  const ignored = rarity.ignoredLabels?.length ? ` ${rarity.ignoredLabels.join(', ')} ignored as ${rarity.ignoredLabels.length === 1 ? 'an identifier' : 'identifiers'}.` : ''
  return `Rank ${RANK_FORMAT.format(rank)} of ${RANK_FORMAT.format(rarity.total)} by trait rarity, worked out by Hup — this collection doesn't publish ranks.${ignored}`
}

/**
 * Why a row has no rank. Either this token hasn't resolved, or the whole ranking is too thin
 * to stand behind — and the reader deserves to know which.
 * @param {Object} rarity From useCollectionRarity.
 */
function blankRankTitle(rarity) {
  if (!rarity.isTrustworthy) {
    return `Not ranked: this collection doesn't publish ranks, and only ${RANK_FORMAT.format(rarity.ranked)} of its tokens have resolved metadata — too few to rank the rest against`
  }

  return rarity.source === 'published'
    ? "This token's metadata hasn't resolved yet, so its published rank is unknown"
    : "This token's metadata hasn't resolved yet, so it isn't in the ranking"
}

/**
 * One token's row. Artwork and name resolve through the same metadata read-through the
 * tiles use, so browsing the table warms the cache exactly like browsing the grid does.
 */
function TableRow({ row, chainId, collection, collectionName, rarity, floor, topOffers, onOffer }) {
  const meta = useNftMetadata({
    chainId,
    collection,
    tokenId: row.tokenId,
    isLsp8: row.isLsp8,
    imageWidth: 96,
    still: true,
  })

  const label = displayTokenId(row.tokenId)
  const name = meta.name || row.name || (collectionName ? `${collectionName} #${label}` : `#${label}`)

  // A rank nobody can stand behind is worse than no rank: with a thin metadata cache a
  // computed ranking is sample noise, and useCollectionRarity says so
  const rank = rarity?.isTrustworthy ? rarity.rankByToken.get(String(row.tokenId)) || null : null
  const price = row.price ? formatStake(row.price, row.decimals) : null
  const lastSale = row.lastSalePrice ? formatStake(row.lastSalePrice, row.lastSaleDecimals) : null

  const offer = topOffers?.offerByToken?.get(String(row.tokenId)) || null
  const offerPrice = offer ? formatStake(offer.price, offer.decimals) : null
  const listedAgo = elapsed(row.listedAt)
  const ownerName = row.ownerName || (row.owner ? shortAddress(row.owner) : null)

  // A percentage against a floor quoted in another currency would be a made-up number, so
  // the comparison only runs when both sides speak the same token
  const { delta, atFloor } = readFloorDelta({ price: row.price, symbol: row.symbol, floor })

  const identity = (
    <>
      <span className={styles.table__thumb}>
        {meta.image ? (
          <img src={meta.image} alt="" loading="lazy" decoding="async" onError={handleBrokenImage} />
        ) : (
          <span className={styles.table__thumbFallback} aria-hidden="true" />
        )}
      </span>

      <span className={styles.table__identity}>
        <span className={styles.table__name}>{name}</span>
        <span className={styles.table__tokenId}>
          <DiamondIcon size={10} weight="fill" />#{label}
        </span>
      </span>
    </>
  )

  return (
    <tr className={styles.table__row}>
      <td className={styles.table__cell}>
        <span className={styles.table__item}>
          {/* The same door the grid's tiles open, so a reader who switched layouts doesn't get
              a different destination for the same click */}
          <Link
            href={`/nfts/${chainId}/collection/${collection.toLowerCase()}/${encodeURIComponent(row.tokenId)}`}
            className={styles.table__itemLink}
          >
            {identity}
          </Link>

          {row.isSold && <span className={styles.table__sold}>Sold</span>}
          {meta.model && (
            <span
              className={styles.table__model}
              title={meta.model.fileType ? `Ships a 3D file (.${meta.model.fileType})` : 'Ships a 3D file'}
            >
              <CubeIcon size={11} weight="fill" />
              3D
            </span>
          )}
        </span>
      </td>

      <td className={clsx(styles.table__cell, styles['table__cell--rarity'], styles['table__cell--numeric'])}>
        {rank ? (
          <span className={styles.table__rank} title={rankTitle(rank, rarity)}>
            #{RANK_FORMAT.format(rank)}
          </span>
        ) : (
          <span className={styles.table__blank} title={rarity?.source ? blankRankTitle(rarity) : undefined}>
            —
          </span>
        )}
      </td>

      <td className={clsx(styles.table__cell, styles['table__cell--price'], styles['table__cell--numeric'])}>
        {price ? (
          <span className={styles.table__price}>
            {price} <small>{row.symbol}</small>
          </span>
        ) : (
          <span className={styles.table__blank}>—</span>
        )}
      </td>

      <td className={clsx(styles.table__cell, styles['table__cell--floor'], styles['table__cell--numeric'])}>
        {delta === null ? (
          <span className={styles.table__blank}>—</span>
        ) : atFloor ? (
          <span className={styles.table__blank}>At floor</span>
        ) : (
          <span
            className={clsx(styles.table__delta, delta < 0 && styles['table__delta--under'])}
            title={`${delta < 0 ? 'Below' : 'Above'} the ${formatStake(floor.floor, floor.decimals)} ${floor.symbol} floor`}
          >
            {PERCENT_FORMAT.format(delta)}
          </span>
        )}
      </td>

      <td className={clsx(styles.table__cell, styles['table__cell--lastSale'], styles['table__cell--numeric'])}>
        {lastSale ? (
          <span className={styles.table__lastSale}>
            {lastSale} <small>{row.lastSaleSymbol}</small>
          </span>
        ) : (
          <span className={styles.table__blank}>—</span>
        )}
      </td>

      <td className={clsx(styles.table__cell, styles['table__cell--topOffer'], styles['table__cell--numeric'])}>
        {offerPrice ? (
          <span
            className={styles.table__price}
            title={offer.count > 1 ? `Best of ${offer.count} live offers` : 'The one live offer on this NFT'}
          >
            {offerPrice} <small>{offer.symbol}</small>
          </span>
        ) : (
          <span className={styles.table__blank}>—</span>
        )}
      </td>

      <td className={clsx(styles.table__cell, styles['table__cell--owner'])}>
        {/* Held in escrow by HupTrade while listed, so the seller is who it comes back to and
            who it goes from — either way, the name a buyer wants to see */}
        {row.owner ? (
          <Link href={`/${row.owner}`} className={styles.table__owner} title={row.owner}>
            {ownerName}
          </Link>
        ) : (
          <span className={styles.table__blank}>—</span>
        )}
      </td>

      <td className={clsx(styles.table__cell, styles['table__cell--listed'], styles['table__cell--numeric'])}>
        {listedAgo ? (
          <span className={styles.table__listed} title={new Date(Number(row.listedAt) * 1000).toLocaleString()}>
            {listedAgo}
          </span>
        ) : (
          <span className={styles.table__blank}>—</span>
        )}
      </td>

      <td className={clsx(styles.table__cell, styles['table__cell--action'])}>
        {/* A full listing row can be bought here and now; a token Hup only knows from the
            browse tab carries no seller or currency, so it points at its listing instead */}
        {row.listing ? (
          <NftQuickBuy listing={row.listing} variant="inline" />
        ) : row.listingId ? (
          <Link href={`/nfts/${chainId}/${row.listingId}`} className={styles.table__action}>
            View
          </Link>
        ) : onOffer ? (
          <button
            type="button"
            className={styles.table__action}
            onClick={() => onOffer({ tokenId: row.tokenId, isLsp8: Boolean(Number(row.isLsp8)), name })}
          >
            Make offer
          </button>
        ) : null}
      </td>
    </tr>
  )
}

/**
 * Collection Table
 * The list layout of the collection page: one row per NFT, with the five facts a buyer
 * compares across rows — what it is, how rare it is, what it costs, where that sits against
 * the floor, what it last changed hands for, the best live bid on it, who holds it, and how
 * long it has been up.
 *
 * Both tabs share it. The listings tabs fill every column; the whole-collection tab has no
 * ask or sale history for most of its tokens, and those cells say so with a dash rather than
 * quietly borrowing a number from somewhere else.
 * @param {Object} props
 * @param {number} props.chainId Chain the collection lives on.
 * @param {string} props.collection Collection contract address, lowercased.
 * @param {string} [props.collectionName] For row names while token metadata resolves.
 * @param {Array} props.rows Row models — see TableRow for the shape.
 * @param {Object} [props.rarity] From useCollectionRarity: {rankByToken, ranked, truncated}.
 * @param {Object} [props.floor] From useCollectionFloor: {floor, symbol, decimals}.
 * @param {Object} [props.topOffers] From useCollectionTopOffers: {offerByToken}.
 * @param {boolean} [props.isLoading] Renders shimmer rows instead of content.
 * @param {number} [props.skeletonRows=12] How many shimmer rows to hold the space with.
 * @param {Function} [props.onOffer] Opens the offer dialog for an unlisted token.
 */
export default function CollectionTable({
  chainId,
  collection,
  collectionName,
  rows,
  rarity,
  floor,
  topOffers,
  isLoading = false,
  skeletonRows = 12,
  onOffer,
}) {
  return (
    <div className={styles.table__scroll}>
      <table className={styles.table}>
        <thead className={styles.table__head}>
          <tr>
            <th scope="col" className={styles.table__heading}>
              Item
            </th>
            <th scope="col" className={clsx(styles.table__heading, styles['table__cell--rarity'], styles['table__cell--numeric'])}>
              Rarity
            </th>
            <th scope="col" className={clsx(styles.table__heading, styles['table__cell--price'], styles['table__cell--numeric'])}>
              Price
            </th>
            <th scope="col" className={clsx(styles.table__heading, styles['table__cell--floor'], styles['table__cell--numeric'])}>
              Floor diff
            </th>
            <th scope="col" className={clsx(styles.table__heading, styles['table__cell--lastSale'], styles['table__cell--numeric'])}>
              Last sale
            </th>
            <th scope="col" className={clsx(styles.table__heading, styles['table__cell--topOffer'], styles['table__cell--numeric'])}>
              Top offer
            </th>
            <th scope="col" className={clsx(styles.table__heading, styles['table__cell--owner'])}>
              Owner
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
                  <td className={styles.table__cell} colSpan={9}>
                    <span className={styles.table__skeleton} />
                  </td>
                </tr>
              ))
            : rows.map((row) => (
                <TableRow
                  key={row.key}
                  row={row}
                  chainId={chainId}
                  collection={collection}
                  collectionName={collectionName}
                  rarity={rarity}
                  floor={floor}
                  topOffers={topOffers}
                  onOffer={onOffer}
                />
              ))}
        </tbody>
      </table>
    </div>
  )
}
