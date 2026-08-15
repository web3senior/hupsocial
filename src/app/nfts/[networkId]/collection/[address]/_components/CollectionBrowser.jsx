'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CONTRACTS } from '@/config/contracts'
import { getNftListings } from '@/lib/api'
import useCollectionTokens from '@/hooks/useCollectionTokens'
import useNftMetadata from '@/hooks/useNftMetadata'
import { displayTokenId } from '@/lib/walletNfts'
import { formatStake } from '@/hooks/useStakeToken'
import OfferModal from '@/components/OfferModal'
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

  // A listed token is a door to its listing; an unlisted one is simply on display — no
  // half-page to send it to, so no pretend link
  if (listing) {
    return (
      <Link
        href={`/nfts/${chainId}/${listing.listing_id}`}
        className={styles.browser__item}
        aria-label={`${name}, listed for ${formatStake(listing.price, decimals)} ${symbol}`}
      >
        {body}
      </Link>
    )
  }

  // Unlisted tokens can still be bid on — offers are escrow-backed and non-custodial, so
  // they don't need the owner to have listed anything
  return (
    <span className={styles.browser__item}>
      {body}
      {onOffer && (
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
 * Tokens with a live listing badge their price and link to it.
 * @param {Object} props
 * @param {number} props.chainId Chain the collection lives on.
 * @param {string} props.collection Collection contract address, lowercased.
 * @param {string|null} props.collectionName For tile names while token metadata resolves.
 * @param {boolean|null} props.isLsp8 Null until the collection's standard resolves.
 * @param {string|number|null} props.totalSupply From the collection header's info, for the
 * cache-mode coverage line; chain mode reads its own.
 * @param {Object} [props.chainInfo] Entry from appChains — native currency symbol/decimals.
 * @param {boolean} [props.enabled=true] Only fetch while the tab is actually showing.
 */
export default function CollectionBrowser({ chainId, collection, collectionName, isLsp8, totalSupply, chainInfo, enabled = true }) {
  const { mode, tokens, total, hasMore, isLoading, isFetchingMore, loadMore } = useCollectionTokens({
    chainId,
    collection,
    isLsp8,
    enabled,
  })

  // Live listings overlaid onto chain-enumerated rows, so a token that is up for sale badges
  // its price. Cache-backed rows already carry their listing from the API's own join.
  const [listingByToken, setListingByToken] = useState(null)

  // One shared offer dialog for the whole grid; unlisted tiles open it on their token
  // (listed tiles route to the listing page, which carries its own offers entry)
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

  return (
    <div className={styles.browser}>
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
          not an empty collection */}
      {isLoading || !mode ? (
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
