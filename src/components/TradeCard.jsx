'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useConnection, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, formatUnits, hexToString, isAddress, zeroAddress } from 'viem'
import clsx from 'clsx'
import { CaretUpDownIcon, InfoIcon, XIcon } from '@phosphor-icons/react'
import HupMark from '@/components/ui/HupMark'
import Tooltip from '@/components/ui/Tooltip'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { TIP_TOKENS } from '@/lib/tokens'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { formatBps, splitSalePrice } from '@/lib/tradeFee'
import { handleBrokenImage } from '@/lib/utils'
import tradeAbi from '@/abis/HupTrade.json'
import useTradeFee from '@/hooks/useTradeFee'
import useNftMetadata from '@/hooks/useNftMetadata'
import { toast } from '@/components/NextToast'
import EditListingModal from './EditListingModal'
import styles from './TradeCard.module.scss'

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })

// IHupTrade.ListingStatus
const STATUS_ACTIVE = 1
const STATUS_SOLD = 2
const STATUS_CANCELLED = 3

// External asset pages: Universal Everything renders LSP8 assets; ERC721 goes to OpenSea
// where a chain slug exists, falling back to the chain's block explorer elsewhere
const OPENSEA_CHAIN_SLUGS = {
  1: 'ethereum',
  56: 'bnb',
  143: 'monad',
  8453: 'base',
  42161: 'arbitrum',
  42220: 'celo',
}

export const buildAssetLinks = ({ chainId, chainInfo, collection, tokenId, isLsp8 }) => {
  if (!collection || !tokenId) return { collectionUrl: null, tokenUrl: null }

  if (isLsp8) {
    // Collections and individual assets live under different UE routes
    return {
      collectionUrl: `https://universaleverything.io/collection/${collection.toLowerCase()}`,
      tokenUrl: `https://universaleverything.io/asset/${collection.toLowerCase()}/tokenId/${tokenId}`,
    }
  }

  const openseaBase = chainId === 10143 ? 'https://testnets.opensea.io/assets/monad_testnet' : OPENSEA_CHAIN_SLUGS[chainId] ? `https://opensea.io/assets/${OPENSEA_CHAIN_SLUGS[chainId]}` : null
  if (openseaBase) {
    const collectionUrl = `${openseaBase}/${collection.toLowerCase()}`
    return { collectionUrl, tokenUrl: `${collectionUrl}/${BigInt(tokenId)}` }
  }

  const explorer = chainInfo?.blockExplorers?.default?.url
  if (!explorer) return { collectionUrl: null, tokenUrl: null }
  const collectionUrl = `${explorer.replace(/\/$/, '')}/token/${collection}`
  return { collectionUrl, tokenUrl: collectionUrl }
}

// LSP7 has no symbol() — LSP4 metadata lives in ERC725Y storage, read via getData
// with the keccak256('LSP4TokenSymbol') data key
const LSP4_TOKEN_SYMBOL_KEY = '0x2f0a68ab07768e01943a599e73362a0e17a63a72e94dd2e384d2c1d4db932756'
const erc725yAbi = [
  {
    type: 'function',
    name: 'getData',
    stateMutability: 'view',
    inputs: [{ name: 'dataKey', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
]

// LSP7 Digital Asset (LUKSO) — operator-based equivalents of allowance/approve
const lsp7Abi = [
  {
    type: 'function',
    name: 'authorizedAmountFor',
    stateMutability: 'view',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'tokenOwner', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'authorizeOperator',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'operatorNotificationData', type: 'bytes' },
    ],
    outputs: [],
  },
]

/**
 * Trade Card
 * Embedded NFT-for-sale card for posts carrying an `nftListing` content reference. The
 * content JSON is only a pointer — price, payment token, and status resolve live from
 * HupTrade so an updated or cancelled listing can never render stale terms.
 * @param {Object} props
 * @param {Object} props.listing The post's nftListing content payload (listingId, chainId, collection, tokenId, isLsp8).
 * @param {string} [props.referral] Reposter credited with the sale when the buyer arrived via a repost.
 * @param {boolean} [props.showDetailsLink] Renders the View button linking to the listing detail page (/nfts/[networkId]/[listingId]); the detail page itself passes false.
 * @param {boolean} [props.compact] Price/action panel only — no media, name, or traits. For
 * surfaces that already present the NFT (the listing detail page's media column).
 */
const TradeCard = ({ listing, referral, showDetailsLink = true, compact = false }) => {
  const [isBurnerBusy, setIsBurnerBusy] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const { address } = useConnection()
  const lastActionRef = useRef(null)

  const chainId = Number(listing?.chainId)
  const publicClient = usePublicClient({ chainId })
  const chainInfo = appChains.find((c) => c.id === chainId)
  const tradeAddress = CONTRACTS[`chain${chainId}`]?.trade || null
  const nativeCurrency = chainInfo?.nativeCurrency
  const listingId = listing?.listingId ? BigInt(listing.listingId) : null

  // Live listing state — the single source of truth for price/token/status
  const { data: liveListing, refetch: refetchListing } = useReadContract({
    abi: tradeAbi,
    address: tradeAddress,
    functionName: 'getListing',
    args: [listingId ?? 0n],
    chainId,
    query: { enabled: Boolean(tradeAddress && listingId) },
  })

  const { data: isPurchasable, refetch: refetchPurchasable } = useReadContract({
    abi: tradeAbi,
    address: tradeAddress,
    functionName: 'isPurchasable',
    args: [listingId ?? 0n],
    chainId,
    query: { enabled: Boolean(tradeAddress && listingId) },
  })

  // Read above the card's early return — the fee it quotes is only used further down
  const { feeBps, feePercent } = useTradeFee({ chainId, tradeAddress })

  const metadata = useNftMetadata({
    chainId,
    collection: listing?.collection,
    tokenId: listing?.tokenId,
    isLsp8: Boolean(listing?.isLsp8),
    enabled: Boolean(listing?.collection && listing?.tokenId),
    still: true,
  })

  const { collectionUrl, tokenUrl } = buildAssetLinks({
    chainId,
    chainInfo,
    collection: listing?.collection,
    tokenId: listing?.tokenId,
    isLsp8: Boolean(listing?.isLsp8),
  })

  const status = liveListing ? Number(liveListing.status) : null
  const seller = liveListing?.seller
  const price = liveListing?.price
  const token = liveListing?.token
  const isTokenLsp7 = Boolean(liveListing?.isTokenLsp7)
  const isNativePrice = !token || token === zeroAddress
  const isSeller = Boolean(seller && address && seller.toLowerCase() === address.toLowerCase())

  const curatedToken = !isNativePrice ? (TIP_TOKENS[chainId] ?? []).find((t) => t.address.toLowerCase() === token.toLowerCase()) : null

  const { data: tokenDecimals } = useReadContract({
    abi: erc20Abi,
    address: isNativePrice ? null : token,
    functionName: 'decimals',
    chainId,
    query: { enabled: Boolean(!isNativePrice) },
  })

  const { data: erc20Symbol } = useReadContract({
    abi: erc20Abi,
    address: isNativePrice ? null : token,
    functionName: 'symbol',
    chainId,
    query: { enabled: Boolean(!isNativePrice && !isTokenLsp7 && !curatedToken) },
  })

  const { data: lsp4SymbolBytes } = useReadContract({
    abi: erc725yAbi,
    address: isNativePrice ? null : token,
    functionName: 'getData',
    args: [LSP4_TOKEN_SYMBOL_KEY],
    chainId,
    query: { enabled: Boolean(!isNativePrice && isTokenLsp7 && !curatedToken) },
  })
  let lsp4Symbol = null
  if (lsp4SymbolBytes && lsp4SymbolBytes !== '0x') {
    try {
      lsp4Symbol = hexToString(lsp4SymbolBytes).trim() || null
    } catch {
      lsp4Symbol = null
    }
  }

  const symbol = isNativePrice ? nativeCurrency?.symbol || '' : curatedToken?.symbol || (isTokenLsp7 ? lsp4Symbol : erc20Symbol) || 'tokens'
  const decimals = isNativePrice ? nativeCurrency?.decimals ?? 18 : tokenDecimals
  const priceNumber = price !== undefined && decimals !== undefined ? Number(formatUnits(price, decimals)) : null
  const formattedPrice = priceNumber !== null ? amountFormat.format(priceNumber) : null

  // Token purchases pull the price via operator rights — same approval dance as TipModal
  const { data: erc20Allowance, refetch: refetchErc20Allowance } = useReadContract({
    abi: erc20Abi,
    address: isNativePrice ? null : token,
    functionName: 'allowance',
    args: [address, tradeAddress],
    chainId,
    query: { enabled: Boolean(!isNativePrice && !isTokenLsp7 && address && tradeAddress) },
  })

  const { data: lsp7Allowance, refetch: refetchLsp7Allowance } = useReadContract({
    abi: lsp7Abi,
    address: isNativePrice ? null : token,
    functionName: 'authorizedAmountFor',
    args: [tradeAddress, address],
    chainId,
    query: { enabled: Boolean(!isNativePrice && isTokenLsp7 && address && tradeAddress) },
  })

  const allowance = isTokenLsp7 ? lsp7Allowance : erc20Allowance
  const refetchAllowance = isTokenLsp7 ? refetchLsp7Allowance : refetchErc20Allowance
  const needsApproval = !isNativePrice && allowance !== undefined && price !== undefined && allowance < price

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const isBusy = isPending || isConfirming || isBurnerBusy

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    if (lastActionRef.current === 'approve') {
      toast('Token approved — you can buy now', 'success')
      refetchAllowance()
    } else if (lastActionRef.current === 'cancel') {
      toast('Listing cancelled', 'success')
      refetchListing()
      refetchPurchasable()
    } else {
      toast('NFT purchased — it now belongs to you', 'success')
      refetchListing()
      refetchPurchasable()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  if (!listing?.listingId || !tradeAddress) return null

  // The contract reverts buys whose referral is the buyer or the seller — silently drop
  // the attribution in those cases (seller reposting their own listing, buyer buying
  // through their own repost) instead of failing the purchase
  const referralArg =
    referral &&
    isAddress(referral) &&
    referral.toLowerCase() !== address?.toLowerCase() &&
    referral.toLowerCase() !== seller?.toLowerCase()
      ? referral
      : zeroAddress

  const handleApprove = (e) => {
    e.stopPropagation()
    if (price === undefined || isNativePrice) return

    lastActionRef.current = 'approve'
    if (isTokenLsp7) {
      writeContract({
        abi: lsp7Abi,
        address: token,
        functionName: 'authorizeOperator',
        args: [tradeAddress, price, '0x'],
        chainId,
      })
    } else {
      writeContract({
        abi: erc20Abi,
        address: token,
        functionName: 'approve',
        args: [tradeAddress, price],
        chainId,
      })
    }
  }

  const handleBuy = async (e) => {
    e.stopPropagation()
    if (price === undefined || !listingId) return

    const args = [address, listingId, referralArg]

    // Route through the burner session key if one's active — same convenience TipModal gets,
    // skipping the wallet popup. Approve/authorizeOperator stays wagmi-only regardless.
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsBurnerBusy(true)
      try {
        await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: tradeAddress,
          abi: tradeAbi,
          functionName: 'buy',
          args: isNativePrice ? [...args, { value: price }] : args,
        })

        toast('NFT purchased — it now belongs to you', 'success')
        refetchListing()
        refetchPurchasable()
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsBurnerBusy(false)
      }
      return
    }

    lastActionRef.current = 'buy'
    writeContract({
      abi: tradeAbi,
      address: tradeAddress,
      functionName: 'buy',
      args,
      chainId,
      ...(isNativePrice ? { value: price } : {}),
    })
  }

  const handleCancel = (e) => {
    e.stopPropagation()
    if (!listingId) return

    lastActionRef.current = 'cancel'
    writeContract({
      abi: tradeAbi,
      address: tradeAddress,
      functionName: 'cancelListing',
      args: [listingId],
      chainId,
    })
  }

  const isActive = status === STATUS_ACTIVE
  const isSold = status === STATUS_SOLD
  const isCancelled = status === STATUS_CANCELLED
  const isUnavailable = isActive && isPurchasable === false

  const isMetaLoading = metadata.isLoading && !metadata.name

  // Surface the seller-set referral share as a concrete number so reposters know what a
  // conversion pays them
  const referralBps = liveListing ? Number(liveListing.referralBps) : 0
  const referralPercent = referralBps > 0 ? new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(referralBps / 100) : null

  // The buyer pays the listed price exactly — the platform fee and the seller's referral
  // share both come out of what lands in the seller's wallet. The detail panel spells that
  // settlement out row by row rather than leaving the cut implied; with nothing deducted
  // there's no split to show and the panel stays away.
  const split = compact && priceNumber !== null && feeBps !== null ? splitSalePrice(priceNumber, feeBps, referralBps) : null
  const showBreakdown = Boolean(split) && (feeBps > 0 || referralBps > 0)

  return (
    <div className={clsx(styles.tradeCard, { [styles['tradeCard--compact']]: compact })} onClick={(e) => e.stopPropagation()}>
      {!compact && (
        <>
          <div className={styles.tradeCard__media}>
            {metadata.image ? (
              <img src={metadata.image} alt={metadata.name || 'NFT'} loading="lazy" onError={handleBrokenImage} />
            ) : (
              <div className={clsx(styles.tradeCard__mediaFallback, { [styles['tradeCard__mediaFallback--loading']]: isMetaLoading })}>
                <HupMark size={22} />
              </div>
            )}
            {isSold && <span className={styles.tradeCard__mediaSold}>Sold</span>}
          </div>

          <div className={styles.tradeCard__info}>
            {metadata.collectionName &&
              (collectionUrl ? (
                <a href={collectionUrl} target="_blank" rel="noopener noreferrer" className={styles.tradeCard__eyebrow}>
                  {metadata.collectionName}
                </a>
              ) : (
                <span className={styles.tradeCard__eyebrow}>{metadata.collectionName}</span>
              ))}

            {isMetaLoading ? (
              <>
                <span className={clsx(styles.tradeCard__skeleton, styles['tradeCard__skeleton--title'])} />
                <span className={clsx(styles.tradeCard__skeleton, styles['tradeCard__skeleton--line'])} />
              </>
            ) : (
              <div className={styles.tradeCard__title}>
                {tokenUrl ? (
                  <a href={tokenUrl} target="_blank" rel="noopener noreferrer">
                    {metadata.name || 'Unnamed token'}
                  </a>
                ) : (
                  metadata.name || 'Unnamed token'
                )}
              </div>
            )}

            {/* Price/referral/status as inline chips under the title — the aside column
                is buttons only in the feed card */}
            {(formattedPrice && (isActive || isSold)) || isSold || isCancelled || isUnavailable ? (
              <div className={styles.tradeCard__meta}>
                {formattedPrice && (isActive || isSold) && (
                  <span className={styles.tradeCard__chip}>
                    {formattedPrice} {symbol}
                  </span>
                )}
                {isActive && !isUnavailable && referralPercent && (
                  <span className={clsx(styles.tradeCard__chip, styles['tradeCard__chip--muted'])}>{referralPercent}% referral</span>
                )}
                {isSold && <span className={clsx(styles.tradeCard__chip, styles['tradeCard__chip--sold'])}>Sold</span>}
                {isCancelled && <span className={styles.tradeCard__chip}>Cancelled</span>}
                {isUnavailable && <span className={styles.tradeCard__chip}>Unavailable</span>}
              </div>
            ) : null}
          </div>
        </>
      )}

      <div className={styles.tradeCard__aside}>
        {/* Compact (listing detail page) keeps the full price panel + status badges —
            only the feed card's price moved to chips above */}
        {compact && formattedPrice && (isActive || isSold) && (
          <div className={styles.tradeCard__price}>
            <span>{isSold ? 'Sold for' : 'Price'}</span>
            <strong>
              {formattedPrice} {symbol}
            </strong>
          </div>
        )}

        {/* Collapsed by default — the price is the headline, and how it splits is what a
            reader opens when they want it. The divider itself is the toggle. */}
        {compact && isActive && !isUnavailable && showBreakdown && (
          <details className={styles.tradeCard__breakdown}>
            {/* Both glyphs render and CSS picks one off [open] — the label stays a plain
                summary with no open-state to mirror in React */}
            <summary className={styles.tradeCard__breakdownSummary}>
              <span>
                Details
                <CaretUpDownIcon size={12} weight="bold" className={styles.tradeCard__breakdownGlyph} />
                <XIcon size={12} weight="bold" className={clsx(styles.tradeCard__breakdownGlyph, styles['tradeCard__breakdownGlyph--open'])} />
              </span>
            </summary>

            <div className={styles.tradeCard__breakdownBody}>
              <div className={styles.tradeCard__breakdownRow}>
                <span>{!isSeller && address ? 'You pay' : 'Buyer pays'}</span>
                <strong>
                  {formattedPrice} {symbol}
                </strong>
              </div>

              {feeBps > 0 && (
                <div className={styles.tradeCard__breakdownRow}>
                  <span>
                    Platform fee ({feePercent})
                    <Tooltip content="Hup's cut of the sale. It comes out of the seller's proceeds — the buyer pays the listed price exactly.">
                      <button type="button" className={styles.tradeCard__breakdownInfo} aria-label="About the platform fee">
                        <InfoIcon size={12} />
                      </button>
                    </Tooltip>
                  </span>
                  <span>
                    −{amountFormat.format(split.fee)} {symbol}
                  </span>
                </div>
              )}

              {referralBps > 0 && (
                <div className={styles.tradeCard__breakdownRow}>
                  <span>
                    Referral ({formatBps(referralBps)})
                    <Tooltip content="Paid to whoever's repost leads to the sale. Also taken from the seller's proceeds, and only when a buyer actually arrives through a share.">
                      <button type="button" className={styles.tradeCard__breakdownInfo} aria-label="About the referral share">
                        <InfoIcon size={12} />
                      </button>
                    </Tooltip>
                  </span>
                  <span>
                    −{amountFormat.format(split.referral)} {symbol}
                  </span>
                </div>
              )}

              <div className={clsx(styles.tradeCard__breakdownRow, styles['tradeCard__breakdownRow--total'])}>
                <span>{isSeller ? 'You receive' : 'Seller receives'}</span>
                <strong>
                  {amountFormat.format(split.seller)} {symbol}
                </strong>
              </div>

              {referralBps > 0 && (
                <p className={styles.tradeCard__breakdownHint}>
                  With no referral, the seller keeps {amountFormat.format(split.seller + split.referral)} {symbol}.
                </p>
              )}
            </div>
          </details>
        )}

        {showDetailsLink && (
          <Link href={`/nfts/${chainId}/${listing.listingId}`} className={styles.tradeCard__view}>
            View
          </Link>
        )}

        {compact && isSold && <span className={clsx(styles.tradeCard__badge, styles['tradeCard__badge--sold'])}>Sold</span>}
        {compact && isCancelled && <span className={styles.tradeCard__badge}>Listing cancelled</span>}
        {compact && isUnavailable && <span className={styles.tradeCard__badge}>No longer available</span>}

        {isActive &&
          !isUnavailable &&
          (isSeller ? (
            // Management actions only appear on the listing detail page — the feed card
            // is just a reference, and links there through View NFT
            compact && (
              <>
                <button
                  type="button"
                  className={styles.tradeCard__cancelListing}
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsEditOpen(true)
                  }}
                  disabled={isBusy}
                >
                  Edit listing
                </button>
                <button type="button" className={styles.tradeCard__cancelListing} onClick={handleCancel} disabled={isBusy}>
                  {isBusy ? 'Confirming...' : 'Cancel listing'}
                </button>
              </>
            )
          ) : needsApproval ? (
            <button type="button" className={styles.tradeCard__buy} onClick={handleApprove} disabled={isBusy || !address}>
              {isBusy ? 'Confirming...' : `Approve ${symbol}`}
            </button>
          ) : (
            <button type="button" className={styles.tradeCard__buy} onClick={handleBuy} disabled={isBusy || !address}>
              {isBusy ? 'Confirming...' : 'Buy'}
            </button>
          ))}
      </div>

      {isEditOpen && (
        <EditListingModal
          chainId={chainId}
          tradeAddress={tradeAddress}
          listingId={listingId}
          initialToken={token}
          initialIsTokenLsp7={isTokenLsp7}
          initialPrice={price}
          initialReferralBps={referralBps}
          initialDecimals={decimals}
          nativeCurrency={nativeCurrency}
          tipTokens={TIP_TOKENS[chainId] ?? []}
          onClose={() => setIsEditOpen(false)}
          onUpdated={() => {
            refetchListing()
            refetchPurchasable()
          }}
        />
      )}
    </div>
  )
}

export default TradeCard
