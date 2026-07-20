'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { zeroAddress } from 'viem'
import { appChains } from '@/config/contracts'
import { toRelative } from '@/lib/predict'
import useStakeToken, { formatStake } from '@/hooks/useStakeToken'
import useNftMetadata from '@/hooks/useNftMetadata'
import PageTitle from '@/components/PageTitle'
import Profile from '@/components/Profile'
import TradeCard from '@/components/TradeCard'
import Share from '@/components/ui/Share'
import { ContentSpinner } from '@/components/Loading'
import {
  ArrowSquareOutIcon,
  CaretLeftIcon,
  ChatCircleIcon,
  ReceiptIcon,
  RepeatIcon,
  ShareNetworkIcon,
  StorefrontIcon,
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

export default function ListingDetail({ networkId, listingId }) {
  const router = useRouter()

  const chainId = Number(networkId)
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const explorerUrl = chainInfo?.blockExplorers?.default?.url?.replace(/\/$/, '') || null

  const { data: detail, isLoading } = useSWR(`/api/v1/nfts/${listingId}?networkId=${chainId}`, fetcher)

  const listing = detail?.data?.listing
  const trades = detail?.data?.trades ?? []
  const postId = detail?.data?.postId ?? null

  // Same shape SellNftModal writes into the post's content JSON — TradeCard resolves live
  // price/status/buy actions from it exactly like it does inside a post
  const cardListing = listing
    ? {
        listingId: String(listing.listing_id),
        chainId,
        collection: listing.collection,
        tokenId: listing.token_id,
        isLsp8: Boolean(Number(listing.is_lsp8)),
      }
    : null

  // NFT name for the fixed header + heading; deduped with TradeCard's read via SWR-immutable
  const metadata = useNftMetadata({
    chainId,
    collection: listing?.collection,
    tokenId: listing?.token_id,
    isLsp8: Boolean(Number(listing?.is_lsp8)),
    enabled: Boolean(listing?.collection && listing?.token_id),
  })

  const { symbol, decimals } = useStakeToken(chainId, listing?.payment_token, Boolean(Number(listing?.is_lsp7)))

  if (isLoading) return <ContentSpinner />

  if (!listing) {
    return (
      <div className={styles.listing__missing}>
        <PageTitle name="NFT Market" paddingTop={false} />
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

  return (
    <div className={`${styles.listing} animate fade`}>
      {/* Fixed-header + document title carry the NFT's name, like post pages */}
      <PageTitle name={title} paddingTop={false} />
      <button type="button" className={styles.listing__back} onClick={() => router.back()}>
        <CaretLeftIcon size={16} />
        Back
      </button>

      <header className={styles.listing__header}>
        <span className={clsx(styles.listing__badge, styles[`listing__badge--${status.key}`])}>{status.label}</span>
        <h1 className={styles.listing__title}>{title}</h1>

        <p className={styles.listing__meta}>
          <span>
            <TimerIcon size={14} />
            Listed {toRelative(listing.listed_at)}
          </span>
          {chainInfo?.name && (
            <span>
              <StorefrontIcon size={14} />
              {chainInfo.name}
            </span>
          )}
        </p>

        {/* Seller renders through the shared Profile component — avatar hover card, follow
            affordances, and the profile link included */}
        <div className={styles.listing__seller}>
          <small>
            <UserIcon size={12} />
            Seller
          </small>
          <Profile variant="fullWithoutTime" creator={listing.wallet_address} networkId={chainId} />
        </div>
      </header>

      {/* The live card — price, status, and buy/cancel resolve from HupTrade onchain, so the
          page can never sell on stale indexed terms */}
      {cardListing && <TradeCard listing={cardListing} showDetailsLink={false} />}

      <ul className={styles.listing__facts}>
        <li>
          <small>Listed price</small>
          <strong>
            {listedPrice ?? '…'} {symbol}
          </strong>
        </li>
        {referralPercent && (
          <li>
            <small>
              <RepeatIcon size={12} />
              Referral share
            </small>
            <strong>{referralPercent}%</strong>
          </li>
        )}
        <li>
          <small>Listing ID</small>
          <strong>#{listing.listing_id}</strong>
        </li>
      </ul>

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
                        Referral {shortAddress(trade.referral)} earned {formatStake(trade.referral_amount, decimals) ?? '…'} {symbol}
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
