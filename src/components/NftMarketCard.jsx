'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { DiamondIcon, StorefrontIcon } from '@phosphor-icons/react'
import { formatStake } from '@/hooks/useStakeToken'
import useNftMetadata from '@/hooks/useNftMetadata'
import styles from './NftMarketCard.module.scss'

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

// ERC721 decimal ids print whole; LSP8 bytes32 ids (or oversized decimals) shorten to
// first-4…last-4 — mirrors the listing detail page's formatting
const formatTokenId = (tokenId) => {
  const raw = String(tokenId ?? '')
  try {
    const numeric = BigInt(raw)
    if (numeric < 10n ** 12n) return numeric.toString()
  } catch {
    // Non-numeric (bytes32 hex) — fall through to shortening
  }
  return raw.length > 12 ? `${raw.slice(0, 4)}…${raw.slice(-4)}` : raw
}

/**
 * NFT Market Card
 * Grid tile for the NFT Market page — image, collection + token id, seller, price. Reads
 * from an indexed nft_listings row (price/status/seller already resolved server-side);
 * only the image/name come from a live per-token metadata read, same source TradeCard uses.
 * @param {Object} props
 * @param {Object} props.listing Row from GET /api/v1/nfts.
 * @param {string} [props.nameFilter] Case-insensitive substring — hides the card once
 * metadata resolves and neither its name nor collection name matches.
 * @param {Function} [props.onCollectionResolved] Called once with (collectionAddress,
 * collectionName) as soon as this card's metadata resolves a name — lets the grid build
 * a "Collection" filter option list from cards actually on screen, since collection
 * names aren't indexed anywhere server-side.
 */
export default function NftMarketCard({ listing, nameFilter, onCollectionResolved }) {
  const networkId = Number(listing.network_id)
  const isLsp8 = Boolean(Number(listing.is_lsp8))
  const isSold = Number(listing.status) === 2

  const metadata = useNftMetadata({
    chainId: networkId,
    collection: listing.collection,
    tokenId: listing.token_id,
    isLsp8,
    enabled: Boolean(listing.collection && listing.token_id),
    still: true,
  })

  const isMetaLoading = metadata.isLoading && !metadata.name

  useEffect(() => {
    if (isMetaLoading || !metadata.collectionName) return
    onCollectionResolved?.(listing.collection.toLowerCase(), metadata.collectionName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMetaLoading, metadata.collectionName])

  if (nameFilter && !isMetaLoading) {
    const haystack = `${metadata.name || ''} ${metadata.collectionName || ''}`.toLowerCase()
    if (!haystack.includes(nameFilter.toLowerCase())) return null
  }

  const formattedPrice = formatStake(listing.price, listing.decimals)
  const sellerName = listing.display_name || shortAddress(listing.wallet_address)

  // Seller-set referral share, same formatting as TradeCard — reposters filter on it,
  // so it has to be readable on the tile. Moot once sold, so it rides with the badge.
  const referralBps = Number(listing.referral_bps) || 0
  const referralPercent = referralBps > 0 ? new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(referralBps / 100) : null

  return (
    <Link href={`/nfts/${networkId}/${listing.listing_id}`} className={styles.nftCard} onClick={(e) => e.stopPropagation()}>
      <div className={styles.nftCard__media}>
        {metadata.image ? (
          <img src={metadata.image} alt={metadata.name || 'NFT'} loading="lazy" />
        ) : (
          <div className={styles.nftCard__mediaFallback}>
            <StorefrontIcon size={28} weight="duotone" />
          </div>
        )}
        {isSold && <span className={styles.nftCard__sold}>Sold</span>}
        {!isSold && referralPercent && <span className={styles.nftCard__referral}>{referralPercent}% ref</span>}
      </div>

      <div className={styles.nftCard__body}>
        <div className={styles.nftCard__titleRow}>
          {isMetaLoading ? (
            <span className={styles.nftCard__skeleton} />
          ) : (
            <span className={styles.nftCard__title}>{metadata.collectionName || metadata.name || 'Unnamed'}</span>
          )}
          <span className={styles.nftCard__tokenId}>
            <DiamondIcon size={11} weight="fill" />
            {formatTokenId(listing.token_id)}
          </span>
        </div>

        <div className={styles.nftCard__seller}>
          {listing.profile_image ? (
            <img src={listing.profile_image} alt="" loading="lazy" />
          ) : (
            <span className={styles.nftCard__sellerFallback} aria-hidden />
          )}
          <span>{sellerName}</span>
        </div>

        <div className={styles.nftCard__price}>
          {formattedPrice ?? '…'} {listing.symbol || ''}
        </div>
      </div>
    </Link>
  )
}
