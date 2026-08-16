'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnection, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, formatUnits, zeroAddress } from 'viem'
import useSWR from 'swr'
import clsx from 'clsx'
import { HandshakeIcon, LockKeyIcon, PlusIcon } from '@phosphor-icons/react'
import { appChains, CONTRACTS } from '@/config/contracts'
import offersAbi from '@/abis/HupOffers.json'
import { toast } from '@/components/NextToast'
import Profile from '@/components/Profile'
import { ContentSpinner } from '@/components/Loading'
import TokenIdentity from '@/components/ui/TokenIdentity'
import CreateDealModal from './CreateDealModal'
import useTokenMeta from './useTokenMeta'
import styles from './P2pDirectory.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

// IHupOffers.AssetStandard — the fungible half. The one-of-one standards belong to the NFT
// market's offer dialog, so this page asks for these three and nothing else.
//
// LSP7 and ERC20 are separate standards, not a cosmetic label: LSP7 has no allowance/approve
// and settles through authorizeOperator + transfer, so a deal that names the wrong one creates
// fine and then reverts at fill time on a function the token doesn't have.
export const STANDARD_LSP7 = 3
export const STANDARD_ERC20 = 4
export const STANDARD_NATIVE = 5

// LSP7 Digital Asset — operator-based equivalents of allowance/approve
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

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'always' })

// IHupOffers.OfferStatus, as indexed into nft_offers
const OFFER_FILLED = 2
const OFFER_CANCELLED = 3

const shortAddress = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '')

const hasExpired = (expiresAt) => expiresAt <= Math.floor(Date.now() / 1000)

const formatExpiry = (expiresAt) => {
  const seconds = expiresAt - Math.floor(Date.now() / 1000)
  if (seconds <= 0) return 'expired'
  if (seconds >= 86400) return relativeTime.format(Math.round(seconds / 86400), 'day')
  return relativeTime.format(Math.max(Math.round(seconds / 3600), 1), 'hour')
}

/**
 * One open deal. Reads its own asset ticker, since a deal names the asset by address and no
 * cache is guaranteed to know it, and owns the approve → fill sequence for that row alone.
 */
function DealCard({ deal, chain, offersAddress, address, onSettled }) {
  const lastActionRef = useRef(null)

  const isNativeAsset = deal.standard === STANDARD_NATIVE
  const isLsp7Asset = deal.standard === STANDARD_LSP7
  const assetToken = isNativeAsset ? null : deal.collection
  const asset = useTokenMeta({
    chainId: chain.id,
    token: assetToken,
    isLsp7: isLsp7Asset,
    nativeCurrency: chain.nativeCurrency,
  })

  const paymentDecimals = deal.payment_decimals ?? chain.nativeCurrency?.decimals ?? 18
  const paymentSymbol = deal.payment_symbol ?? chain.nativeCurrency?.symbol ?? ''

  const remaining = BigInt(deal.remaining)
  // All-or-nothing for divisible assets, so the whole remainder settles in one fill and the
  // payout is simply the escrow still held against it
  const payout = (BigInt(deal.price) * remaining) / BigInt(deal.amount)

  const isFilled = deal.status === OFFER_FILLED
  const isCancelled = deal.status === OFFER_CANCELLED
  const isSettled = isFilled || isCancelled
  const isExpired = !isSettled && hasExpired(deal.expires_at)

  // A settled deal's remainder is meaningless — a filled one is 0, which would render the whole
  // card as "0 for 0". What a past deal is worth reading is the size it was struck at, so those
  // rows quote the original amount and price instead, with labels in the past tense to match.
  const shownQuantity = isSettled ? BigInt(deal.amount) : remaining
  const shownPayment = isSettled ? BigInt(deal.price) : payout
  const assetLegLabel = isFilled ? 'Delivered' : isCancelled ? 'Asked for' : 'You deliver'
  const paymentLegLabel = isFilled ? 'Paid' : isCancelled ? 'Offered' : 'You receive'

  const isMine = address && deal.offerer.toLowerCase() === address.toLowerCase()
  const isLocked = Boolean(deal.counterparty)
  const isMyLock = isLocked && address && deal.counterparty.toLowerCase() === address.toLowerCase()
  const canFill = Boolean(address) && !isMine && (!isLocked || isMyLock)

  // Delivering a token asset needs rights granted first — an allowance for ERC20, an operator
  // authorization for LSP7. Native needs neither: the value attached to the fill IS the delivery.
  const { data: erc20Allowance, refetch: refetchErc20 } = useReadContract({
    abi: erc20Abi,
    address: assetToken,
    functionName: 'allowance',
    args: [address, offersAddress],
    chainId: chain.id,
    query: { enabled: Boolean(!isNativeAsset && !isLsp7Asset && assetToken && address && offersAddress && canFill) },
  })

  const { data: lsp7Allowance, refetch: refetchLsp7 } = useReadContract({
    abi: lsp7Abi,
    address: assetToken,
    functionName: 'authorizedAmountFor',
    args: [offersAddress, address],
    chainId: chain.id,
    query: { enabled: Boolean(isLsp7Asset && assetToken && address && offersAddress && canFill) },
  })

  const allowance = isLsp7Asset ? lsp7Allowance : erc20Allowance
  const refetchAllowance = isLsp7Asset ? refetchLsp7 : refetchErc20
  const needsApproval = !isNativeAsset && allowance !== undefined && allowance < remaining

  // A ticker alone identifies nothing — anyone can deploy a token called anything, and the
  // filler is the side handing over real value here. The contract address is the only thing
  // that actually says what this deal wants, so it's shown, copyable, and linked out.
  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
  const assetLabel = asset.symbol ?? (isNativeAsset ? chain.nativeCurrency?.symbol : shortAddress(assetToken))

  const { data: hash, isPending: isSubmitting, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const isBusy = isSubmitting || isConfirming

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    if (lastActionRef.current === 'approve') {
      toast('Token approved — you can fill the deal now', 'success')
      refetchAllowance()
    } else if (lastActionRef.current === 'cancel') {
      toast('Deal cancelled — your escrow was refunded', 'success')
      onSettled()
    } else {
      toast('Deal filled — the payment is yours', 'success')
      onSettled()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const handleApprove = () => {
    lastActionRef.current = 'approve'

    if (isLsp7Asset) {
      writeContract({
        abi: lsp7Abi,
        address: assetToken,
        functionName: 'authorizeOperator',
        args: [offersAddress, remaining, '0x'],
        chainId: chain.id,
      })
      return
    }

    writeContract({
      abi: erc20Abi,
      address: assetToken,
      functionName: 'approve',
      args: [offersAddress, remaining],
      chainId: chain.id,
    })
  }

  // The offerer's exit from escrow. Not gated on expiry — cancelOffer is also the reclaim path
  // for a deal that timed out, and the contract allows it even while paused, so funds are never
  // trapped by anything the app or an admin does.
  const handleCancel = () => {
    lastActionRef.current = 'cancel'
    writeContract({
      abi: offersAbi,
      address: offersAddress,
      functionName: 'cancelOffer',
      args: [BigInt(deal.offer_id)],
      chainId: chain.id,
    })
  }

  const handleFill = () => {
    lastActionRef.current = 'fill'
    writeContract({
      abi: offersAbi,
      address: offersAddress,
      functionName: 'acceptOffer',
      args: [BigInt(deal.offer_id), remaining],
      chainId: chain.id,
      // Native assets deliver by value; every other standard must send zero
      ...(isNativeAsset ? { value: remaining } : {}),
    })
  }

  return (
    <article className={styles.p2p__deal}>
      <header className={styles.p2p__dealHeader}>
        <Profile variant="fullWithoutTime" creator={deal.offerer} networkId={chain.id} />
        {isLocked && (
          <span className={clsx(styles.p2p__lock, isMyLock && styles['p2p__lock--mine'])} title={deal.counterparty}>
            <LockKeyIcon size={12} weight="bold" />
            {isMyLock ? 'Locked to you' : 'Private deal'}
          </span>
        )}
      </header>

      {/* The deal in one line, in the direction the filler experiences it: what they hand
          over, then what they get back */}
      <div className={styles.p2p__terms}>
        <div className={styles.p2p__leg}>
          <span className={styles.p2p__legLabel}>{assetLegLabel}</span>
          <strong className={styles.p2p__legValue}>
            {asset.isResolved ? amountFormat.format(Number(formatUnits(shownQuantity, asset.decimals))) : '…'} {assetLabel}
          </strong>

          {/* Native has no contract to verify, so only token assets carry the address row */}
          {!isNativeAsset && (
            <TokenIdentity
              chainId={chain.id}
              address={assetToken}
              symbol={asset.symbol}
              isLsp7={isLsp7Asset}
              explorerUrl={explorerUrl}
              size="sm"
              className={styles.p2p__legToken}
            />
          )}
        </div>
        <HandshakeIcon size={18} className={styles.p2p__swapIcon} />
        <div className={styles.p2p__leg}>
          <span className={styles.p2p__legLabel}>{paymentLegLabel}</span>
          <strong className={styles.p2p__legValue}>
            {amountFormat.format(Number(formatUnits(shownPayment, paymentDecimals)))} {paymentSymbol}
          </strong>

          {/* The payment is no longer always a curated stablecoin — a deal can be funded with
              any ERC20 or LSP7 — so it needs the same verifiable identity the asset leg has */}
          {deal.payment_token && deal.payment_token !== zeroAddress && (
            <TokenIdentity
              chainId={chain.id}
              address={deal.payment_token}
              symbol={paymentSymbol}
              isLsp7={Boolean(deal.is_lsp7)}
              explorerUrl={explorerUrl}
              size="sm"
              className={styles.p2p__legToken}
            />
          )}
        </div>
      </div>

      <footer className={styles.p2p__dealFooter}>
        <span className={styles.p2p__expiry}>
          {isFilled ? 'filled' : isCancelled ? 'cancelled' : `expires ${formatExpiry(deal.expires_at)}`}
        </span>

        {isSettled ? (
          <span className={clsx(styles.p2p__badge, isFilled && styles['p2p__badge--filled'])}>{isFilled ? 'Filled' : 'Cancelled'}</span>
        ) : isExpired ? (
          // Expired but still Active onchain: the escrow is sitting there, and only the
          // offerer can pull it back. Everyone else just sees that the window closed.
          isMine ? (
            <button
              type="button"
              className={clsx(styles.p2p__action, styles['p2p__action--cancel'])}
              onClick={handleCancel}
              disabled={isBusy}
            >
              {isBusy ? 'Confirming…' : 'Reclaim escrow'}
            </button>
          ) : (
            <span className={styles.p2p__hint}>Expired</span>
          )
        ) : isMine ? (
          <button
            type="button"
            className={clsx(styles.p2p__action, styles['p2p__action--cancel'])}
            onClick={handleCancel}
            disabled={isBusy}
          >
            {isBusy ? 'Confirming…' : 'Cancel deal'}
          </button>
        ) : !address ? (
          <span className={styles.p2p__hint}>Connect to fill</span>
        ) : isLocked && !isMyLock ? (
          <span className={styles.p2p__hint}>Locked to another wallet</span>
        ) : needsApproval ? (
          <button type="button" className={styles.p2p__action} onClick={handleApprove} disabled={isBusy}>
            {isBusy ? 'Confirming…' : `Approve ${asset.symbol}`}
          </button>
        ) : (
          <button type="button" className={styles.p2p__action} onClick={handleFill} disabled={isBusy || !asset.isResolved}>
            {isBusy ? 'Confirming…' : 'Fill deal'}
          </button>
        )}
      </footer>
    </article>
  )
}

/**
 * OTC Directory
 * Every open fungible deal on the selected chain, plus the entry point for creating one.
 * Deals are HupOffers offers whose asset is a token or the native coin, so nothing here needs
 * a listing, an NFT, or a counterparty to have signed up in advance.
 */
export default function P2pDirectory() {
  const { address } = useConnection()
  const [chainId, setChainId] = useState(null)
  const [view, setView] = useState('open')
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  // Only chains with HupOffers deployed can hold a deal — anywhere else the page would be a
  // form that can only revert
  const dealChains = appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.offers)
  const chain = dealChains.find((c) => c.id === chainId) ?? dealChains[0] ?? null
  const offersAddress = chain ? CONTRACTS[`chain${chain.id}`]?.offers : null

  const standards = `${STANDARD_LSP7},${STANDARD_ERC20},${STANDARD_NATIVE}`
  const status = view === 'past' ? 'past' : 'active'
  const key = chain ? `/api/v1/nfts/offers?networkId=${chain.id}&standard=${standards}&status=${status}` : null
  const { data, isLoading, mutate } = useSWR(key, fetcher, { refreshInterval: 30000 })
  const deals = data?.data ?? []

  if (dealChains.length === 0) {
    return <p className={styles.p2p__empty}>OTC isn&apos;t available on any configured network yet.</p>
  }

  return (
    <div className={styles.p2p}>
      <header className={styles.p2p__header}>
        <div>
          <h1 className={styles.p2p__title}>P2P Trading</h1>
          <p className={styles.p2p__subtitle}>
            Trade tokens directly with another person — <strong>OTC</strong>, or over-the-counter, if you know it by that name. The buyer
            locks the payment in escrow up front, so a deal can never be agreed and then not paid, and a deal locked to one wallet settles
            at the price you agreed without anyone else taking it first.
          </p>
        </div>

        <button type="button" className={styles.p2p__create} onClick={() => setIsCreateOpen(true)} disabled={!address}>
          <PlusIcon size={16} weight="bold" />
          {address ? 'New deal' : 'Connect to deal'}
        </button>
      </header>

      {dealChains.length > 1 && (
        <div className={styles.p2p__chains}>
          {dealChains.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={clsx(styles.p2p__chain, entry.id === chain?.id && styles['p2p__chain--active'])}
              onClick={() => setChainId(entry.id)}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}

      <div className={styles.p2p__views} role="tablist">
        {[
          { id: 'open', label: 'Open deals' },
          { id: 'past', label: 'Past deals' },
        ].map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={view === entry.id}
            className={clsx(styles.p2p__view, view === entry.id && styles['p2p__view--active'])}
            onClick={() => setView(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <ContentSpinner />
      ) : deals.length === 0 ? (
        <p className={styles.p2p__empty}>
          {view === 'past'
            ? `Nothing has settled or expired on ${chain?.name} yet.`
            : address
              ? `No open deals on ${chain?.name} yet — yours would be the first.`
              : `No open deals on ${chain?.name} yet. Connect a wallet to post one.`}
        </p>
      ) : (
        <div className={styles.p2p__grid}>
          {deals.map((deal) => (
            <DealCard key={deal.offer_id} deal={deal} chain={chain} offersAddress={offersAddress} address={address} onSettled={mutate} />
          ))}
        </div>
      )}

      {isCreateOpen && (
        <CreateDealModal chain={chain} offersAddress={offersAddress} onClose={() => setIsCreateOpen(false)} onCreated={mutate} />
      )}
    </div>
  )
}
