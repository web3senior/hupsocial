'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { CubeIcon, DiamondIcon, TagIcon } from '@phosphor-icons/react'
import HupMark from '@/components/ui/HupMark'
import { formatStake } from '@/hooks/useStakeToken'
import { handleBrokenImage } from '@/lib/utils'
import useNftMetadata from '@/hooks/useNftMetadata'
import NftQuickBuy from '@/components/NftQuickBuy'
import { appChains } from '@/config/contracts'
import styles from './NftMarketCard.module.scss'
import Profile from './Profile'

const TOKEN_ID_FORMAT = new Intl.NumberFormat('en')

// ERC721 decimal ids print grouped (#1,042); LSP8 bytes32 ids (or oversized decimals)
// shorten to first-4…last-4 — mirrors the listing detail page's formatting
const formatTokenId = (tokenId) => {
  const raw = String(tokenId ?? '')
  try {
    const numeric = BigInt(raw)
    if (numeric < 10n ** 12n) return TOKEN_ID_FORMAT.format(numeric)
  } catch {
    // Non-numeric (bytes32 hex) — fall through to shortening
  }
  return raw.length > 12 ? `${raw.slice(0, 4)}…${raw.slice(-4)}` : raw
}

// wagmi's config module stamps iconUrl onto the shared chain objects as a side effect, so
// derive it here too rather than depending on that module having been evaluated first
const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

/**
 * NFT Market Card
 * Grid tile for the NFT Market page — artwork, collection + token id, price and last sale.
 * Reads from an indexed nft_listings row (price/status/last sale already resolved
 * server-side); only the image/name come from a live per-token metadata read, the same
 * source TradeCard uses.
 * @param {Object} props
 * @param {Object} props.listing Row from GET /api/v1/nfts.
 * @param {string} [props.layout='comfortable'] Grid density the tile renders at — 'compact'
 * drops the seller and last sale to stay legible in a narrower column.
 * @param {Function} [props.onCollectionResolved] Called once with (collectionAddress,
 * collectionName) as soon as this card's metadata resolves a name — lets the grid build
 * a "Collection" filter option list from cards actually on screen, since collection
 * names aren't indexed anywhere server-side.
 */
export default function NftMarketCard({ listing, onCollectionResolved, layout = 'comfortable' }) {
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

  const chain = appChains.find((c) => c.id === networkId)
  const chainIcon = chainIconFor(chain)

  // A tile whose collection name never resolved falls back to the NFT's own name, which
  // usually carries the id already ("Universal Apes #315") — and the chip beside it would
  // then print the same id twice. Compared with spaces and grouping stripped, so a chip's
  // "#1,042" still matches a name's "#1042".
  const title = metadata.collectionName || metadata.name || 'Unnamed'
  const idInTitle = title.replace(/[\s,]/g, '').toLowerCase().includes(`#${String(listing.token_id).toLowerCase()}`)

  const formattedPrice = formatStake(listing.price, listing.decimals)
  const lastSalePrice = listing.last_sale_price ? formatStake(listing.last_sale_price, listing.last_sale_decimals) : null

  // Seller-set referral share, same formatting as TradeCard — reposters filter on it,
  // so it has to be readable on the tile. Moot once sold, so it rides with the badge.
  const referralBps = Number(listing.referral_bps) || 0
  const referralPercent = referralBps > 0 ? new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(referralBps / 100) : null

  // A sale settled from an accepted offer has no listing behind it (listing_id 0), so its
  // tile opens the token page instead
  const href =
    Number(listing.listing_id) > 0
      ? `/nfts/${networkId}/${listing.listing_id}`
      : `/nfts/${networkId}/collection/${String(listing.collection).toLowerCase()}/${encodeURIComponent(listing.token_id)}`

  return (
    <div className={clsx(styles.nftCard, layout === 'compact' && styles['nftCard--compact'])}>
      <Link href={href} className={styles.nftCard__link} onClick={(e) => e.stopPropagation()}>
        <div className={styles.nftCard__media}>
          {metadata.image ? (
            <img src={metadata.image} alt={metadata.name || 'NFT'} loading="lazy" onError={handleBrokenImage} />
          ) : (
            <div className={styles.nftCard__mediaFallback}>
              <HupMark size={44} />
            </div>
          )}
          {isSold && <span className={styles.nftCard__sold}>Sold</span>}
          {!isSold && referralPercent && <span className={styles.nftCard__referral}>{referralPercent}% ref</span>}
          {/* Same badge the listing page carries, so a collection that ships meshes reads as
              one at grid scale. Every model counts, renderable or not — the detail page is
              where a glb becomes a viewer and an fbx becomes a download. */}
          {metadata.model && (
            <span
              className={styles.nftCard__model}
              title={metadata.model.fileType ? `Ships a 3D file (.${metadata.model.fileType})` : 'Ships a 3D file'}
            >
              <CubeIcon size={11} weight="fill" />
              3D
            </span>
          )}
        </div>

        <div className={styles.nftCard__body}>
          <div className={styles.nftCard__titleRow}>
            {isMetaLoading ? (
              <span className={styles.nftCard__skeleton} />
            ) : (
              <span className={styles.nftCard__title}>{title}</span>
            )}
            {/* Marked rather than removed when the title already says the id: compact hides
                the title and the chip is then the tile's whole identity, so which one shows
                is the stylesheet's call per layout */}
            <span className={clsx(styles.nftCard__tokenId, idInTitle && styles['nftCard__tokenId--inTitle'])}>
              <DiamondIcon size={11} weight="fill" />#{formatTokenId(listing.token_id)}
            </span>
          </div>

          {/* Price stays below the artwork; seller identity sits over the image. */}
          <div className={styles.nftCard__footer}>
            <span className={styles.nftCard__pricePill}>
              {formattedPrice ?? '…'}
              {listing.symbol && <span className={styles.nftCard__pricePillSymbol}>{listing.symbol}</span>}
              {chainIcon && <img className={styles.nftCard__priceIcon} src={chainIcon} alt="" title={chain?.name} />}
            </span>
          </div>

          {/* Reserved even when empty so tiles in a row keep a common baseline */}

          {lastSalePrice && (
            <div className={styles.nftCard__lastSale} title={`Last sale ${lastSalePrice} ${listing.last_sale_symbol || ''}`.trim()}>
              <TagIcon size={12} className={styles.nftCard__lastSaleIcon} aria-hidden="true" />
              <span className={styles.nftCard__lastSaleLabel}>Last sale</span>
              <span className={styles.nftCard__lastSaleValue}>{lastSalePrice}</span>
              {listing.last_sale_symbol && <span className={styles.nftCard__lastSaleSymbol}>{listing.last_sale_symbol}</span>}
            </div>
          )}
        </div>
      </Link>

      {listing.wallet_address && (
        <span className={styles.nftCard__owner}>
          <Profile creator={listing.wallet_address} networkId={networkId} variant="imageOnly" size={26} fingerprint={false} />
        </span>
      )}

      {/* Hover overlay riding the artwork's bottom edge; NftQuickBuy self-gates for
          sold/cancelled rows and the seller's own tiles, leaving an inert empty layer */}
      <div className={styles.nftCard__quickBuy}>
        <NftQuickBuy listing={listing} />
      </div>
    </div>
  )
}
