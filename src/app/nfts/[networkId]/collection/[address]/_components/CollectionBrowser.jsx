'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { CONTRACTS } from '@/config/contracts'
import { getNftListings } from '@/lib/api'
import useCollectionTokens from '@/hooks/useCollectionTokens'
import useNftMetadata from '@/hooks/useNftMetadata'
import { displayTokenId } from '@/lib/walletNfts'
import { formatStake } from '@/hooks/useStakeToken'
import OfferModal from '@/components/OfferModal'
import CollectionTable from './CollectionTable'
import styles from './CollectionBrowser.module.scss'

const count = new Intl.NumberFormat()

// How many live listings the badge overlay reads. One page of the listings API — a collection
// with more live asks than this can miss a badge on a token past the cap. Cache-backed rows
// carry their own listing from the API's join, so the cap only ever costs chain-mode badges.
const LISTING_OVERLAY_LIMIT = 60

function TokenTile({ chainId, collection, collectionName, tokenId, isLsp8, listing, nativeCurrency, onOffer }) {
  const meta = useNftMetadata({ chainId, collection, tokenId, isLsp8, imageWidth: 320, still: true })
  const label = displayTokenId(tokenId)
  const name = meta.name || (collectionName ? `${collectionName} #${label}` : `#${label}`)

  // Native-coin listings come back with null symbol/decimals — the chain config fills both
  // in, the same rule every price in the app follows
  const symbol = listing ? listing.symbol || nativeCurrency?.symbol || '' : ''
  const decimals = listing ? (listing.decimals ?? nativeCurrency?.decimals) : undefined

  const body = (
    <>
      <span className={styles.browser__art}>
        {meta.image ? (
          <img src={meta.image} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={styles.browser__artFallback} aria-hidden="true" />
        )}
        {listing && (
          <span className={styles.browser__price}>
            {formatStake(listing.price, decimals)} {symbol}
          </span>
        )}
      </span>

      <span className={styles.browser__caption}>
        <span className={styles.browser__name}>{name}</span>
        <span className={styles.browser__tokenId}>#{label}</span>
      </span>
    </>
  )

  // Every tile is a door to the same place — the token's own page, which carries the price, the
  // buy, the traits and the link through to the listing page when there is one. A link rather
  // than a dialog: a reader who finds an NFT worth showing someone needs a URL for it, and the
  // page is prefetched on hover, so it opens no slower than the overlay it replaced.
  return (
    <span className={styles.browser__item}>
      <Link
        href={`/nfts/${chainId}/collection/${collection.toLowerCase()}/${encodeURIComponent(tokenId)}`}
        className={styles.browser__open}
        aria-label={listing ? `${name}, listed for ${formatStake(listing.price, decimals)} ${symbol}` : `Details for ${name}`}
      >
        {body}
      </Link>

      {/* Unlisted tokens can still be bid on — offers are escrow-backed and non-custodial, so
          they don't need the owner to have listed anything */}
      {!listing && onOffer && (
        <button
          type="button"
          className={styles.browser__offerBtn}
          onClick={() => onOffer({ tokenId, isLsp8: Boolean(Number(isLsp8)), name })}
        >
          Make offer
        </button>
      )}
    </span>
  )
}

/**
 * Collection Browser
 * The whole collection as a token grid, not just its Hup listings — enumerated live from the
 * contract when it publishes an index (ERC721Enumerable), otherwise the tokens Hup has seen,
 * with a coverage line that says plainly which of the two the reader is looking at.
 *
 * Tiles resolve artwork through the same metadata read-through every card uses, which also
 * means browsing here *fills* the cache: each rendered token becomes a row, so the fallback
 * view and the trait filter both grow as a side effect of people looking.
 *
 * Tokens with a live listing badge their price. Every tile — listed or not — links to the same
 * place, the token's own page, which is where the price, the buy, the traits and the rest of its
 * record live.
 * @param {Object} props
 * @param {number} props.chainId Chain the collection lives on.
 * @param {string} props.collection Collection contract address, lowercased.
 * @param {string|null} props.collectionName For tile names while token metadata resolves.
 * @param {boolean|null} props.isLsp8 Null until the collection's standard resolves.
 * @param {string|number|null} props.totalSupply From the collection header's info, for the
 * cache-mode coverage line; chain mode reads its own.
 * @param {Object} [props.chainInfo] Entry from appChains — native currency symbol/decimals.
 * @param {boolean} [props.enabled=true] Only fetch while the tab is actually showing.
 * @param {string} [props.layout='comfortable'] Grid density, shared with the listings grid
 * above so switching tabs doesn't switch the shape of the page. 'list' is the table.
 * @param {Object} [props.rarity] From useCollectionRarity, fetched once by the page.
 * @param {Object} [props.floor] From useCollectionFloor, fetched once by the page.
 * @param {Object} [props.topOffers] From useCollectionTopOffers, fetched once by the page.
 */
export default function CollectionBrowser({
  chainId,
  collection,
  collectionName,
  isLsp8,
  totalSupply,
  chainInfo,
  enabled = true,
  layout = 'comfortable',
  rarity,
  floor,
  topOffers,
}) {
  const { mode, tokens, total, hasMore, isLoading, isFetchingMore, loadMore } = useCollectionTokens({
    chainId,
    collection,
    isLsp8,
    enabled,
  })

  // Live listings overlaid onto chain-enumerated rows, so a token that is up for sale badges
  // its price. Cache-backed rows already carry their listing from the API's own join.
  const [listingByToken, setListingByToken] = useState(null)

  // One shared offer dialog; unlisted tiles open it directly on their token, which spares the
  // reader a trip through the token's page to bid on something nobody has listed
  const [offerTarget, setOfferTarget] = useState(null)
  const offersEnabled = Boolean(CONTRACTS[`chain${chainId}`]?.offers)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const load = async () => {
      try {
        const res = await getNftListings(1, LISTING_OVERLAY_LIMIT, { networkId: String(chainId), collection, status: '' })
        if (cancelled) return
        const map = new Map()
        for (const listing of res.data || []) {
          map.set(String(listing.token_id), {
            listing_id: listing.listing_id,
            price: listing.price,
            symbol: listing.symbol,
            decimals: listing.decimals,
          })
        }
        setListingByToken(map)
      } catch {
        if (!cancelled) setListingByToken(new Map())
      }
    }
    load()

    return () => {
      cancelled = true
    }
  }, [enabled, chainId, collection])

  const supply = totalSupply ? Number(totalSupply) : null

  const isTable = layout === 'list'

  const tableRows = tokens.map((token) => {
    const listing = token.listing || listingByToken?.get(String(token.token_id)) || null

    return {
      key: token.token_id,
      tokenId: token.token_id,
      isLsp8: token.is_lsp8,
      listingId: listing?.listing_id || null,
      price: listing?.price || null,
      symbol: listing ? listing.symbol || chainInfo?.nativeCurrency?.symbol || '' : '',
      decimals: listing ? listing.decimals ?? chainInfo?.nativeCurrency?.decimals : undefined,
      // The tokens API answers with live listings only — a sale history, an owner and a
      // listing age would each be another query for a token that mostly isn't listed at all.
      // The table prints a dash for all three rather than half-filling the columns.
      lastSalePrice: null,
      owner: null,
      listedAt: null,
      isSold: false,
    }
  })

  return (
    <div className={clsx(styles.browser, layout === 'compact' && styles['browser--compact'])}>
      {/* The two modes make very different claims — "all of it" versus "what we've seen" —
          and this line is where the difference is owned rather than blurred */}
      {!isLoading && mode && (
        <p className={styles.browser__coverage}>
          {mode === 'chain'
            ? `All ${count.format(total)} tokens, read straight from the contract.`
            : total > 0
              ? `The ${count.format(total)} token${total === 1 ? '' : 's'} Hup has seen${supply ? ` of ${count.format(supply)}` : ''} — this collection doesn't publish a token index, so tokens appear here as they're listed, traded or browsed.`
              : ''}
        </p>
      )}

      {/* mode is still null while the collection's standard resolves — that's loading too,
          not an empty collection. The table carries its own skeletons, and an empty
          collection falls past it to the line that can explain why it's empty. */}
      {isTable && (isLoading || !mode || tokens.length > 0) ? (
        <CollectionTable
          chainId={chainId}
          collection={collection}
          collectionName={collectionName}
          rows={tableRows}
          rarity={rarity}
          floor={floor}
          topOffers={topOffers}
          isLoading={isLoading || !mode}
          onOffer={offersEnabled ? setOfferTarget : null}
        />
      ) : isLoading || !mode ? (
        <div className={styles.browser__grid}>
          {/* 12 divides by both column counts, so the skeleton never ends on an orphan row */}
          {Array.from({ length: 12 }).map((_, i) => (
            <span key={i} className={styles.browser__skeleton} />
          ))}
        </div>
      ) : tokens.length === 0 ? (
        <p className={styles.browser__empty}>
          {mode === 'cache'
            ? "Hup hasn't seen any tokens from this collection yet — they'll show up here as they're listed, traded or browsed."
            : 'This collection has no tokens yet.'}
        </p>
      ) : (
        <div className={styles.browser__grid}>
          {tokens.map((token) => (
            <TokenTile
              key={token.token_id}
              chainId={chainId}
              collection={collection}
              collectionName={collectionName}
              tokenId={token.token_id}
              isLsp8={token.is_lsp8}
              listing={token.listing || listingByToken?.get(String(token.token_id)) || null}
              nativeCurrency={chainInfo?.nativeCurrency}
              onOffer={offersEnabled ? setOfferTarget : null}
            />
          ))}
        </div>
      )}

      {offerTarget && (
        <OfferModal
          chainId={chainId}
          collection={collection}
          tokenId={offerTarget.tokenId}
          isLsp8={offerTarget.isLsp8}
          assetName={offerTarget.name}
          onClose={() => setOfferTarget(null)}
        />
      )}

      {hasMore && !isLoading && (
        <div className={styles.browser__loadMoreWrap}>
          <button type="button" className={styles.browser__loadMore} onClick={loadMore} disabled={isFetchingMore}>
            {isFetchingMore ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
