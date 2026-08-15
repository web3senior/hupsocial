'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { zeroAddress } from 'viem'
import { appChains, CONTRACTS } from '@/config/contracts'
import { toRelative } from '@/lib/predict'
import { formatFeeShare } from '@/lib/tradeFee'
import { handleBrokenImage } from '@/lib/utils'
import { useProfile } from '@/hooks/useProfile'
import useStakeToken, { formatStake } from '@/hooks/useStakeToken'
import useNftMetadata from '@/hooks/useNftMetadata'
import useCollectionInfo from '@/hooks/useCollectionInfo'
import useCollectionMetadataRefresh, { collectionRefreshLabel, describeCollectionRefresh } from '@/hooks/useCollectionMetadataRefresh'
import PageTitle from '@/components/PageTitle'
import Profile from '@/components/Profile'
import TradeCard, { buildAssetLinks } from '@/components/TradeCard'
import OfferModal from '@/components/OfferModal'
import Share from '@/components/ui/Share'
import HupMark from '@/components/ui/HupMark'
import ModelViewer from '@/components/ui/ModelViewer'
import { ContentSpinner } from '@/components/Loading'
import {
  ArrowsClockwiseIcon,
  ArrowSquareOutIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ChatCircleIcon,
  CubeIcon,
  HandCoinsIcon,
  ImageIcon,
  ReceiptIcon,
  RepeatIcon,
  ShareNetworkIcon,
  StackIcon,
  TimerIcon,
  UserIcon,
  WarningIcon,
} from '@phosphor-icons/react'
import { toast } from '@/components/NextToast'
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

export default function ListingDetail({ networkId, listingId }) {
  const router = useRouter()

  // Collections that ship a 3D asset still lead with their artwork: the mesh is megabytes
  // and the renderer another few hundred KB, so both wait until someone asks for them.
  const [showModel, setShowModel] = useState(false)
  const [showOfferModal, setShowOfferModal] = useState(false)

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

  // A collection that re-pointed its artwork changed every token, not just this one — so the
  // page offers the sweep next to the single-token refresh rather than making the owner walk
  // their own collection a listing at a time.
  const collectionRefresh = useCollectionMetadataRefresh({ chainId, collection: listing?.collection })

  // Collection-level identity (icon, description, creators, supply) for the "about the
  // collection" strip — one cached fetch, shared with the collection page itself
  const collectionInfo = useCollectionInfo({ chainId, collection: listing?.collection, isLsp8, enabled: Boolean(listing?.collection) })

  const handleRefreshMetadata = async () => {
    try {
      await metadata.refresh()
      toast('Metadata refreshed from the blockchain', 'success')
    } catch (refreshError) {
      toast(refreshError.message || 'Could not refresh metadata', 'error')
    }
  }

  const handleRefreshCollection = async () => {
    try {
      const result = await collectionRefresh.refresh()
      if (!result) return
      toast(...describeCollectionRefresh(result))
    } catch (refreshError) {
      toast(refreshError.message || 'Could not refresh the collection', 'error')
    }
  }

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
  // LUKSO's standard reads as "NFT 2.0" in the UI; the literal LSP8 name lives in the tooltip
  const standard = isLsp8 ? 'NFT 2.0' : 'ERC721'
  const standardTitle = isLsp8 ? 'LSP8' : undefined
  // {url, fileType, isRenderable}, for the collections whose metadata carries a 3D file
  // next to the artwork
  const model = metadata.model

  const { collectionUrl, tokenUrl } = buildAssetLinks({
    chainId,
    chainInfo,
    collection: listing.collection,
    tokenId: listing.token_id,
    isLsp8,
  })

  // In-app collection page; the external explorer link stays on the details rows below
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
        {/* Media column — the artwork with the live price/buy panel right under it. The
            compact TradeCard resolves price/status onchain, so the page can never sell on
            stale indexed terms */}
        <aside className={styles.listing__media}>
          <div className={styles.listing__stage}>
            {showModel && model?.isRenderable ? (
              <ModelViewer src={model.url} poster={metadata.image} alt={`${title} in 3D`} />
            ) : metadata.image ? (
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
            {/* Collections that change their onchain metadata give the app no signal, so a
                cached token keeps its old name and artwork until the TTL lapses. This is the
                escape hatch for whoever made the change. */}
            <button
              type="button"
              className={styles.listing__refresh}
              onClick={handleRefreshMetadata}
              disabled={metadata.isRefreshing}
              title="Re-read this NFT's name, traits and artwork from the blockchain"
            >
              <ArrowsClockwiseIcon size={14} className={clsx(metadata.isRefreshing && styles['listing__refresh--spinning'])} />
              {metadata.isRefreshing ? 'Refreshing…' : 'Refresh metadata'}
            </button>

            {/* The same escape hatch widened to every token of the collection this app has
                cached — what a change made across a whole drop actually needs */}
            <button
              type="button"
              className={styles.listing__refresh}
              onClick={handleRefreshCollection}
              disabled={collectionRefresh.isRefreshing}
              title="Re-read every NFT in this collection from the blockchain"
            >
              {collectionRefresh.isRefreshing ? (
                <ArrowsClockwiseIcon size={14} className={styles['listing__refresh--spinning']} />
              ) : (
                <StackIcon size={14} />
              )}
              {collectionRefresh.isRefreshing ? collectionRefreshLabel(collectionRefresh.progress) : 'Refresh collection'}
            </button>

            {model && !model.isRenderable && (
              <a
                href={model.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.listing__refresh}
                title="This collection ships a 3D file the browser can't render inline"
              >
                <CubeIcon size={14} />
                3D file (.{model.fileType})
                <ArrowSquareOutIcon size={12} />
              </a>
            )}
          </div>

          {cardListing && <TradeCard listing={cardListing} compact showDetailsLink={false} />}

          {/* Offers live in HupOffers, not HupTrade — the button only renders on chains
              where the offers contract is deployed */}
          {CONTRACTS[`chain${chainId}`]?.offers && (
            <button type="button" className={styles.listing__offer} onClick={() => setShowOfferModal(true)}>
              <HandCoinsIcon size={16} />
              Make an offer
            </button>
          )}
          {showOfferModal && (
            <OfferModal
              chainId={chainId}
              collection={listing.collection}
              tokenId={listing.token_id}
              isLsp8={isLsp8}
              assetName={title}
              // While the listing is active the seller is the owner; once sold/cancelled the
              // page can't know the current owner without a chain call, so accept stays off
              ownerAddress={Number(listing.status) === 1 ? listing.wallet_address : null}
              onClose={() => setShowOfferModal(false)}
            />
          )}
        </aside>

        <div className={styles.listing__info}>
          <div className={styles.listing__badges}>
            <span className={clsx(styles.listing__badge, styles[`listing__badge--${status.key}`])}>{status.label}</span>
            {chainInfo?.name && <span className={styles.listing__chip}>{chainInfo.name}</span>}
            <span className={styles.listing__chip} title={standardTitle}>
              {standard}
            </span>
            {model && (
              <span className={styles.listing__chip}>
                <CubeIcon size={12} />
                3D
              </span>
            )}
            {referralPercent && (
              <span className={styles.listing__chip}>
                <RepeatIcon size={12} />
                Referral {referralPercent}%
              </span>
            )}
          </div>

          {metadata.collectionName && (
            <Link href={collectionHref} className={styles.listing__eyebrow}>
              {metadata.collectionName}
            </Link>
          )}

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
              <dd title={standardTitle}>{standard}</dd>
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

          {/* About the collection — the identity every token of this contract shares
              (LSP4 collection metadata), linking through to the collection's own page */}
          {(collectionInfo.name || collectionInfo.description) && (
            <aside className={styles.listing__collection} aria-label="About the collection">
              {collectionInfo.icon ? (
                <img
                  className={styles.listing__collectionIcon}
                  src={collectionInfo.icon}
                  alt=""
                  loading="lazy"
                  onError={handleBrokenImage}
                />
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
    </div>
  )
}
