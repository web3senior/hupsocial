'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { zeroAddress } from 'viem'
import { appChains } from '@/config/contracts'
import { toRelative } from '@/lib/predict'
import { handleBrokenImage } from '@/lib/utils'
import { useProfile } from '@/hooks/useProfile'
import useStakeToken, { formatStake } from '@/hooks/useStakeToken'
import useNftMetadata from '@/hooks/useNftMetadata'
import PageTitle from '@/components/PageTitle'
import Profile from '@/components/Profile'
import TradeCard, { buildAssetLinks } from '@/components/TradeCard'
import Share from '@/components/ui/Share'
import HupMark from '@/components/ui/HupMark'
import { ContentSpinner } from '@/components/Loading'
import {
  ArrowSquareOutIcon,
  CaretLeftIcon,
  ChatCircleIcon,
  ReceiptIcon,
  RepeatIcon,
  ShareNetworkIcon,
  TimerIcon,
  UserIcon,
  WarningIcon,
} from '@phosphor-icons/react'
import styles from './ListingDetail.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

// IHupTrade.ListingStatus, as indexed into nft_listings by cidex
const STATUS_META = {
  1: { key: 'active', label: 'For sale' },
  2: { key: 'sold', label: 'Sold' },
  3: { key: 'cancelled', label: 'Cancelled' },
}

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

// ERC721 decimal ids print whole; LSP8 bytes32 ids (or oversized decimals) shorten to
// first-4…last-4, with the full value preserved in the cell's title attribute
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

// Inline referral credit — resolves the wallet to a profile name (Universal Profile or
// local DB) and links to their page; the bare shortened address is only the fallback
// while loading or when the wallet has no stored name
const ReferralName = ({ address }) => {
  const { profile } = useProfile(address)
  const name = profile?.fullName || (profile?.name && profile.name !== 'new-user' ? profile.name : null)

  return (
    <Link href={`/${address}`} title={address}>
      {name || shortAddress(address)}
    </Link>
  )
}

export default function ListingDetail({ networkId, listingId }) {
  const router = useRouter()

  const chainId = Number(networkId)
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const explorerUrl = chainInfo?.blockExplorers?.default?.url?.replace(/\/$/, '') || null

  const { data: detail, isLoading } = useSWR(`/api/v1/nfts/${listingId}?networkId=${chainId}`, fetcher)

  const listing = detail?.data?.listing
  const trades = detail?.data?.trades ?? []
  const postId = detail?.data?.postId ?? null
  const isLsp8 = Boolean(Number(listing?.is_lsp8))

  // Same shape SellNftModal writes into the post's content JSON — TradeCard resolves live
  // price/status/buy actions from it exactly like it does inside a post
  const cardListing = listing
    ? {
        listingId: String(listing.listing_id),
        chainId,
        collection: listing.collection,
        tokenId: listing.token_id,
        isLsp8,
      }
    : null

  // NFT name for the fixed header + heading; deduped with TradeCard's read via SWR-immutable
  const metadata = useNftMetadata({
    chainId,
    collection: listing?.collection,
    tokenId: listing?.token_id,
    isLsp8,
    enabled: Boolean(listing?.collection && listing?.token_id),
    imageWidth: 1024,
  })

  const { symbol, decimals } = useStakeToken(chainId, listing?.payment_token, Boolean(Number(listing?.is_lsp7)))

  if (isLoading) return <ContentSpinner />

  if (!listing) {
    return (
      <div className={styles.listing__missing}>
        <PageTitle name="NFT Market" spacer={false} />
        <WarningIcon size={32} />
        <p>This listing doesn&apos;t exist on {chainInfo?.name || `network #${chainId}`} — or the indexer hasn&apos;t caught up yet.</p>
      </div>
    )
  }

  const status = STATUS_META[Number(listing.status)] ?? { key: 'active', label: 'For sale' }
  const listedPrice = formatStake(listing.price, decimals)
  const referralBps = Number(listing.referral_bps) || 0
  const referralPercent = referralBps > 0 ? new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(referralBps / 100) : null
  const title = metadata.name || `NFT listing #${listing.listing_id}`
  const standard = isLsp8 ? 'LSP8' : 'ERC721'

  const { collectionUrl, tokenUrl } = buildAssetLinks({
    chainId,
    chainInfo,
    collection: listing.collection,
    tokenId: listing.token_id,
    isLsp8,
  })

  return (
    <div className={`${styles.listing} animate fade`}>
      {/* Fixed-header + document title carry the NFT's name; the clearance spacer
          already renders at page level, outside the container */}
      <PageTitle name={title} spacer={false} />
      <button type="button" className={styles.listing__back} onClick={() => router.back()}>
        <CaretLeftIcon size={16} />
        Back
      </button>

      <div className={styles.listing__layout}>
        {/* Media column — the artwork with the live price/buy panel right under it. The
            compact TradeCard resolves price/status onchain, so the page can never sell on
            stale indexed terms */}
        <aside className={styles.listing__media}>
          {metadata.image ? (
            tokenUrl ? (
              <a href={tokenUrl} target="_blank" rel="noopener noreferrer">
                <img src={metadata.image} alt={title} onError={handleBrokenImage} />
              </a>
            ) : (
              <img src={metadata.image} alt={title} onError={handleBrokenImage} />
            )
          ) : (
            <div className={styles.listing__mediaFallback}>
              <HupMark size={56} />
            </div>
          )}

          {cardListing && <TradeCard listing={cardListing} compact showDetailsLink={false} />}
        </aside>

        <div className={styles.listing__info}>
          <div className={styles.listing__badges}>
            <span className={clsx(styles.listing__badge, styles[`listing__badge--${status.key}`])}>{status.label}</span>
            {chainInfo?.name && <span className={styles.listing__chip}>{chainInfo.name}</span>}
            <span className={styles.listing__chip}>{standard}</span>
            {referralPercent && (
              <span className={styles.listing__chip}>
                <RepeatIcon size={12} />
                Referral {referralPercent}%
              </span>
            )}
          </div>

          {metadata.collectionName &&
            (collectionUrl ? (
              <a href={collectionUrl} target="_blank" rel="noopener noreferrer" className={styles.listing__eyebrow}>
                {metadata.collectionName}
              </a>
            ) : (
              <span className={styles.listing__eyebrow}>{metadata.collectionName}</span>
            ))}

          <h1 className={styles.listing__title}>{title}</h1>

          <p className={styles.listing__meta}>
            <span>
              <TimerIcon size={14} />
              Listed {toRelative(listing.listed_at)}
            </span>
          </p>

          {metadata.description && <p className={styles.listing__description}>{metadata.description}</p>}

          {/* Seller renders through the shared Profile component — avatar hover card, follow
              affordances, and the profile link included */}
          <div className={styles.listing__seller}>
            <small>
              <UserIcon size={12} />
              Seller
            </small>
            <Profile variant="fullWithoutTime" creator={listing.wallet_address} networkId={chainId} />
          </div>

          {metadata.attributes.length > 0 && (
            <ul className={styles.listing__traits}>
              {metadata.attributes.map((attr) => (
                <li key={`${attr.label}:${attr.value}`}>
                  <small>{attr.label}</small>
                  <strong title={attr.value}>{attr.value}</strong>
                </li>
              ))}
            </ul>
          )}

          <dl className={styles.listing__details}>
            <div>
              <dt>Blockchain</dt>
              <dd>{chainInfo?.name || `Network #${chainId}`}</dd>
            </div>
            <div>
              <dt>Collection address</dt>
              <dd>
                {collectionUrl ? (
                  <a href={collectionUrl} target="_blank" rel="noopener noreferrer">
                    {shortAddress(listing.collection)}
                    <ArrowSquareOutIcon size={12} />
                  </a>
                ) : (
                  shortAddress(listing.collection)
                )}
              </dd>
            </div>
            <div>
              <dt>NFT standard</dt>
              <dd>{standard}</dd>
            </div>
            <div>
              <dt>Token id</dt>
              <dd title={String(listing.token_id)}>
                {tokenUrl ? (
                  <a href={tokenUrl} target="_blank" rel="noopener noreferrer">
                    {formatTokenId(listing.token_id)}
                    <ArrowSquareOutIcon size={12} />
                  </a>
                ) : (
                  formatTokenId(listing.token_id)
                )}
              </dd>
            </div>
            <div>
              <dt>Listing id</dt>
              <dd>#{listing.listing_id}</dd>
            </div>
            <div>
              <dt>Listed price</dt>
              <dd>
                {listedPrice ?? '…'} {symbol}
              </dd>
            </div>
          </dl>

          <div className={styles.listing__actions}>
            {postId && (
              <Link href={`/networks/${chainId}/${postId}`} className={styles.listing__action}>
                <ChatCircleIcon size={16} />
                View post
              </Link>
            )}
            {explorerUrl && listing.tx_hash && (
              <a href={`${explorerUrl}/tx/${listing.tx_hash}`} target="_blank" rel="noopener noreferrer" className={styles.listing__action}>
                <ArrowSquareOutIcon size={16} />
                Listing transaction
              </a>
            )}
            {/* Same target menu a post's share action offers (copy link, X, Telegram, ...) */}
            <Share
              url={`${window.location.origin}/nfts/${chainId}/${listing.listing_id}`}
              title={title}
              creator={listing.wallet_address}
              copyLabel="Copy listing link"
              copiedToast="Listing link copied"
              trigger={
                <button type="button" className={styles.listing__action} aria-label="Share listing">
                  <ShareNetworkIcon size={16} />
                  Share
                </button>
              }
            />
          </div>
        </div>
      </div>

      <section className={styles.listing__sales} aria-label="Sale records">
        <h2>
          <ReceiptIcon size={16} />
          Sale records
        </h2>

        {trades.length === 0 ? (
          <p className={styles.listing__salesEmpty}>
            {status.key === 'active' ? 'No sale yet — this NFT is still up for grabs.' : 'No sale was recorded for this listing.'}
          </p>
        ) : (
          <ul className={styles.listing__salesList}>
            {trades.map((trade) => {
              const hasReferral = trade.referral && trade.referral !== zeroAddress && BigInt(trade.referral_amount || '0') > 0n

              return (
                <li key={trade.tx_hash} className={styles.listing__sale}>
                  <div className={styles.listing__saleRow}>
                    <Profile variant="fullWithoutTime" creator={trade.wallet_address} networkId={chainId} />
                    <div className={styles.listing__saleAmount}>
                      <span>Bought for</span>
                      <strong>
                        {formatStake(trade.price, decimals) ?? '…'} {symbol}
                      </strong>
                    </div>
                  </div>

                  <p className={styles.listing__saleMeta}>
                    <span>{toRelative(trade.sold_at)}</span>
                    {BigInt(trade.fee_amount || '0') > 0n && (
                      <span>
                        Fee {formatStake(trade.fee_amount, decimals) ?? '…'} {symbol}
                      </span>
                    )}
                    {hasReferral && (
                      <span>
                        Referral <ReferralName address={trade.referral} /> earned {formatStake(trade.referral_amount, decimals) ?? '…'} {symbol}
                      </span>
                    )}
                    {explorerUrl && (
                      <a href={`${explorerUrl}/tx/${trade.tx_hash}`} target="_blank" rel="noopener noreferrer">
                        Transaction
                        <ArrowSquareOutIcon size={12} />
                      </a>
                    )}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
