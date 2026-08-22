'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { zeroAddress } from 'viem'
import { appChains } from '@/config/contracts'
import { toRelative } from '@/lib/predict'
import { formatFeeShare } from '@/lib/tradeFee'
import { handleBrokenImage } from '@/lib/utils'
import { useProfile } from '@/hooks/useProfile'
import useStakeToken, { formatStake } from '@/hooks/useStakeToken'
import useNftMetadata from '@/hooks/useNftMetadata'
import useCollectionInfo from '@/hooks/useCollectionInfo'
import PageTitle from '@/components/PageTitle'
import Profile from '@/components/Profile'
import TokenDetailPanel from '@/components/TokenDetailPanel'
import Share from '@/components/ui/Share'
import HupMark from '@/components/ui/HupMark'
import ModelViewer from '@/components/ui/ModelViewer'
import { ContentSpinner } from '@/components/Loading'
import {
  ArrowSquareOutIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ChatCircleIcon,
  CubeIcon,
  HandshakeIcon,
  ImageIcon,
  ReceiptIcon,
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

const formatSupply = (value) => {
  try {
    return new Intl.NumberFormat().format(BigInt(value))
  } catch {
    return String(value)
  }
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

/**
 * Listing Detail
 * One listing's own page — the shareable URL behind every NFT sold inside a post.
 *
 * The token half of this page is TokenDetailPanel, the same component the collection grid opens
 * in a dialog: identity, action card, traits with their rarity, offers, activity, price history
 * and details. Two surfaces telling a reader different things about one NFT is how they drift,
 * so this page frames the panel rather than reimplementing it.
 *
 * What stays here is what belongs to the listing row rather than to the token — its status, what
 * it asks, who listed it, and the fee and referral each sale actually paid. Those are facts about
 * one HupTrade record: a token outlives any number of them, and this page is the only place in
 * the app that shows them.
 *
 * @param {Object} props
 * @param {string|number} props.networkId Chain the listing lives on.
 * @param {string|number} props.listingId HupTrade listing id.
 */
export default function ListingDetail({ networkId, listingId }) {
  const router = useRouter()

  // Collections that ship a 3D asset still lead with their artwork: the mesh is megabytes
  // and the renderer another few hundred KB, so both wait until someone asks for them.
  const [showModel, setShowModel] = useState(false)

  const chainId = Number(networkId)
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const explorerUrl = chainInfo?.blockExplorers?.default?.url?.replace(/\/$/, '') || null

  const { data: detail, isLoading } = useSWR(`/api/v1/nfts/${listingId}?networkId=${chainId}`, fetcher)

  const listing = detail?.data?.listing
  const trades = detail?.data?.trades ?? []
  const postId = detail?.data?.postId ?? null
  const isLsp8 = Boolean(Number(listing?.is_lsp8))

  // Artwork and the document title. Shares its SWR key with the panel's own read — the width
  // hint is applied to the cached row rather than being part of the key — so mounting both
  // costs one fetch.
  const metadata = useNftMetadata({
    chainId,
    collection: listing?.collection,
    tokenId: listing?.token_id,
    isLsp8,
    enabled: Boolean(listing?.collection && listing?.token_id),
    imageWidth: 1024,
  })

  // This listing row's own currency, for the ask and the fee breakdown below. The panel resolves
  // its prices per row instead — a token can be listed in one currency and bid on in another.
  const { symbol, decimals } = useStakeToken(chainId, listing?.payment_token, Boolean(Number(listing?.is_lsp7)))

  // Collection-level identity (icon, description, creators, supply) for the "about the
  // collection" strip — one cached fetch, shared with the collection page itself
  const collectionInfo = useCollectionInfo({ chainId, collection: listing?.collection, isLsp8, enabled: Boolean(listing?.collection) })

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
  // {url, fileType, isRenderable}, for the collections whose metadata carries a 3D file
  // next to the artwork
  const model = metadata.model

  // In-app collection page; the external explorer links live in the panel's Details tab
  const collectionHref = `/nfts/${chainId}/collection/${listing.collection.toLowerCase()}`

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
        {/* Media column — the artwork, and the handful of links that are about this page
            rather than about the token */}
        <aside className={styles.listing__media}>
          <div className={styles.listing__stage}>
            {showModel && model?.isRenderable ? (
              <ModelViewer src={model.url} poster={metadata.image} alt={`${title} in 3D`} />
            ) : metadata.image ? (
              <img src={metadata.image} alt={title} onError={handleBrokenImage} />
            ) : (
              <div className={styles.listing__mediaFallback}>
                <HupMark size={56} />
              </div>
            )}

            {/* Only for formats that actually paint — an fbx or usdz gets the download link
                below instead of a button that would open an empty canvas */}
            {model?.isRenderable && (
              <button type="button" className={styles.listing__stageToggle} onClick={() => setShowModel((visible) => !visible)}>
                {showModel ? <ImageIcon size={14} weight="bold" /> : <CubeIcon size={14} weight="bold" />}
                {showModel ? 'View image' : 'View in 3D'}
              </button>
            )}
          </div>

          <div className={styles.listing__mediaActions}>
            {model && !model.isRenderable && (
              <a
                href={model.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.listing__action}
                title="This collection ships a 3D file the browser can't render inline"
              >
                <CubeIcon size={14} />
                3D file (.{model.fileType})
                <ArrowSquareOutIcon size={12} />
              </a>
            )}

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
        </aside>

        {/* The token itself, exactly as the collection grid's dialog shows it. Ownership, price
            and offers are all resolved live inside the panel, so a listing indexed a moment ago
            can never be acted on here on stale terms. */}
        <TokenDetailPanel
          chainId={chainId}
          collection={listing.collection}
          tokenId={listing.token_id}
          isLsp8={isLsp8}
          collectionName={metadata.collectionName || collectionInfo.name}
          as="h1"
          // Already the listing's own page — the panel's link through would lead back to here
          showListingLink={false}
        />
      </div>

      {/* The HupTrade record behind this URL. Deliberately not part of the panel: the fee and
          referral below were charged on this listing's terms, which a later listing of the same
          token need not share. */}
      <section className={styles.listing__record} aria-label="This listing">
        <h2>
          <ReceiptIcon size={16} />
          This listing
        </h2>

        <div className={styles.listing__badges}>
          <span className={clsx(styles.listing__badge, styles[`listing__badge--${status.key}`])}>{status.label}</span>
          <span className={styles.listing__chip}>#{listing.listing_id}</span>
          {referralPercent && (
            <span className={styles.listing__chip} title="Share of each sale paid to whoever referred the buyer">
              <HandshakeIcon size={12} />
              Referral {referralPercent}%
            </span>
          )}
        </div>

        <p className={styles.listing__meta}>
          <span>
            <TimerIcon size={14} />
            Listed {toRelative(listing.listed_at)}
          </span>
          <span>
            Asking&nbsp;
            <strong>
              {listedPrice ?? '…'} {symbol}
            </strong>
          </span>
        </p>

        {/* Who listed it, which is not necessarily who holds it now — HupTrade is
            non-custodial, and the panel above reads the current owner from the chain */}
        <div className={styles.listing__seller}>
          <small>
            <UserIcon size={12} />
            Listed by
          </small>
          <Profile variant="fullWithoutTime" creator={listing.wallet_address} networkId={chainId} />
        </div>

        {trades.length === 0 ? (
          <p className={styles.listing__salesEmpty}>
            {status.key === 'active' ? 'No sale yet — this NFT is still up for grabs.' : 'No sale was recorded for this listing.'}
          </p>
        ) : (
          <ul className={styles.listing__salesList}>
            {trades.map((trade) => {
              const hasReferral = trade.referral && trade.referral !== zeroAddress && BigInt(trade.referral_amount || '0') > 0n
              // Rows store the fee as an amount; the rate it was charged at is what a reader
              // is actually after, and the fee could have been different on an older sale
              const feeShare = formatFeeShare(trade.fee_amount, trade.price)

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
                        {feeShare ? ` (${feeShare})` : ''}
                      </span>
                    )}
                    {hasReferral && (
                      <span>
                        Referral <ReferralName address={trade.referral} /> earned {formatStake(trade.referral_amount, decimals) ?? '…'}{' '}
                        {symbol}
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

      {/* About the collection — the identity every token of this contract shares
          (LSP4 collection metadata), linking through to the collection's own page */}
      {(collectionInfo.name || collectionInfo.description) && (
        <aside className={styles.listing__collection} aria-label="About the collection">
          {collectionInfo.icon ? (
            <img className={styles.listing__collectionIcon} src={collectionInfo.icon} alt="" loading="lazy" onError={handleBrokenImage} />
          ) : (
            <span className={clsx(styles.listing__collectionIcon, styles['listing__collectionIcon--fallback'])}>
              <HupMark size={20} />
            </span>
          )}

          <div className={styles.listing__collectionBody}>
            <small>Collection</small>
            <Link href={collectionHref} className={styles.listing__collectionName}>
              {collectionInfo.name || metadata.collectionName || shortAddress(listing.collection)}
            </Link>

            {collectionInfo.totalSupply !== null && (
              <p className={styles.listing__collectionMeta}>
                <span>{formatSupply(collectionInfo.totalSupply)} items</span>
              </p>
            )}

            {collectionInfo.description && <p className={styles.listing__collectionDescription}>{collectionInfo.description}</p>}

            {/* LSP4Creators[] through the shared Profile component, exactly like the
                seller block above — avatar, resolved name, hover card, profile link */}
            {collectionInfo.creators.length > 0 && (
              <div className={styles.listing__collectionCreators}>
                <small>Created by</small>
                {collectionInfo.creators.map((creator) => (
                  <Profile key={creator} variant="fullWithoutTime" creator={creator} networkId={chainId} />
                ))}
              </div>
            )}
          </div>

          <Link href={collectionHref} className={styles.listing__collectionOpen} aria-label="View the collection page">
            <CaretRightIcon size={16} />
          </Link>
        </aside>
      )}
    </div>
  )
}
