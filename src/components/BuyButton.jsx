'use client'

import { erc20Abi, formatEther, formatUnits, zeroAddress } from 'viem'
import { lukso, celo, sepolia, base, monad, bsc, monadTestnet, arbitrumSepolia, somniaTestnet, unichainSepolia, optimismSepolia /* , baseSepolia */ } from 'wagmi/chains'
import { useChainId, useConnection, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { useEffect, useRef } from 'react'
import { CONTRACTS } from '@/config/wagmi'
import { USDC } from '@/lib/tokens'
import sellAbi from '@/abis/HupSell.json'
import { resolveIdentity } from '@/lib/sellVault'
import { requestVaultUnlock } from '@/lib/vaultUnlockBus'
import { toast } from '@/components/NextToast'
import { KeyIcon, SparkleIcon, TrendUpIcon } from '@phosphor-icons/react'
import RevealGatedContent from './RevealGatedContent'
import styles from './BuyButton.module.scss'

const CHAINS = [lukso, celo, sepolia, base, monad, bsc, monadTestnet, arbitrumSepolia, somniaTestnet, unichainSepolia, optimismSepolia /* , baseSepolia */]

const compact = (n) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n)

// Matches the tip badge's formatting (ui/Tip.jsx) so the two money figures on one post
// never disagree about how a dollar looks.
const compactUsd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const plainUsd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const formatEarned = (usd) => (usd >= 1000 ? compactUsd : plainUsd).format(usd)

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

export default function BuyButton({ item }) {
  const { address } = useConnection()
  // Reactive, unlike a render-time chain snapshot: read again after switchChainAsync resolves
  const walletChainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const chainId = Number(item.network_id)
  const targetChain = CONTRACTS[`chain${item.network_id}`]
  const sellAddress = targetChain?.sell
  const chainInfo = CHAINS.find((c) => c.id === chainId)
  const currencySymbol = chainInfo?.nativeCurrency?.symbol || ''

  const { data: listing } = useReadContract({
    abi: sellAbi,
    address: sellAddress,
    functionName: 'getListing',
    args: [BigInt(item.id)],
    chainId,
    query: { enabled: Boolean(sellAddress) },
  })

  const { data: purchase, refetch: refetchPurchased } = useReadContract({
    abi: sellAbi,
    address: sellAddress,
    functionName: 'getPurchase',
    args: [BigInt(item.id), address ?? zeroAddress],
    chainId,
    query: { enabled: Boolean(sellAddress && address) },
  })

  const paymentToken = listing?.paymentToken
  const isTokenListing = Boolean(paymentToken && paymentToken.toLowerCase() !== zeroAddress)
  const isLsp7 = Boolean(isTokenListing && listing?.isLsp7)

  // decimals() shares the same selector on ERC20 and LSP7 — one read covers both
  const { data: tokenDecimals } = useReadContract({
    abi: erc20Abi,
    address: paymentToken,
    functionName: 'decimals',
    chainId,
    query: { enabled: isTokenListing },
  })

  // LSP7 has no symbol() (metadata lives in ERC725Y keys) — fall back to config/generic label
  const { data: erc20Symbol } = useReadContract({
    abi: erc20Abi,
    address: paymentToken,
    functionName: 'symbol',
    chainId,
    query: { enabled: isTokenListing && !isLsp7 },
  })

  const usdcConfig = USDC[chainId]
  const tokenSymbol = isLsp7
    ? usdcConfig?.address && paymentToken?.toLowerCase() === usdcConfig.address.toLowerCase()
      ? 'USDC'
      : 'tokens'
    : erc20Symbol

  const { data: erc20Allowance, refetch: refetchErc20Allowance } = useReadContract({
    abi: erc20Abi,
    address: paymentToken,
    functionName: 'allowance',
    args: [address, sellAddress],
    chainId,
    query: { enabled: Boolean(isTokenListing && !isLsp7 && address && sellAddress) },
  })

  const { data: lsp7Allowance, refetch: refetchLsp7Allowance } = useReadContract({
    abi: lsp7Abi,
    address: paymentToken,
    functionName: 'authorizedAmountFor',
    args: [sellAddress, address],
    chainId,
    query: { enabled: Boolean(isLsp7 && address && sellAddress) },
  })

  // The post already decides the chain — approving or buying just switches to it rather than
  // refusing. Same rule as the sell dialog: a listing is never bought on a network the buyer picked.
  const ensureWalletChain = async () => {
    if (walletChainId === chainId) return
    toast(`Switching to ${chainInfo?.name || 'the post network'}...`, 'info')
    await switchChainAsync({ chainId })
  }

  // Only the seller needs this, and only they pay the extra read: it is their task list, not
  // something a buyer could act on.
  const isSeller = Boolean(address && listing?.seller && listing.seller.toLowerCase() === address.toLowerCase())

  const { data: pendingData } = useReadContract({
    abi: sellAbi,
    address: sellAddress,
    functionName: 'getPendingGrants',
    args: [BigInt(item.id), 0n, 50n],
    chainId,
    query: { enabled: Boolean(sellAddress && isSeller), refetchInterval: 30000 },
  })
  const awaitingCount = pendingData?.[0]?.length ?? 0

  const allowance = isLsp7 ? lsp7Allowance : erc20Allowance
  const refetchAllowance = isLsp7 ? refetchLsp7Allowance : refetchErc20Allowance

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const lastActionRef = useRef(null)

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    if (lastActionRef.current === 'approve') {
      toast('Token approved — you can buy now', 'success')
      refetchAllowance()
    } else {
      toast('Purchase complete', 'success')
      refetchPurchased()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const hasListing = Boolean(listing && listing.seller && listing.seller.toLowerCase() !== zeroAddress)
  // One purchase per buyer, so this is a yes/no rather than a quantity. A refunded purchase is
  // not a purchase: the escrow went back, and the buyer may buy again.
  const hasPurchased = Boolean(purchase && Number(purchase.paidAt) !== 0 && !purchase.refunded)
  const isBusy = isPending || isConfirming

  // Once purchased, keep showing the reveal action even if the listing later goes
  // inactive (e.g. sold out) — access shouldn't disappear just because stock ran out.
  if (!sellAddress || !hasListing) return null
  const isInactive = !hasPurchased && !listing.isActive

  const needsApproval = isTokenListing && allowance !== undefined && allowance < listing.price

  const priceLabel = isTokenListing
    ? tokenDecimals !== undefined
      ? `${formatUnits(listing.price, tokenDecimals)} ${tokenSymbol || ''}`.trim()
      : '...'
    : `${formatEther(listing.price)} ${currencySymbol}`.trim()

  // What the listing has actually earned, in dollars. Summed per payment token and priced
  // server-side (lib/salesTotals.js) from store_sales, which cidex writes only on
  // AccessGranted — so this is money already paid out, never an escrow still waiting on a
  // key. Null on a chain with no market price, where the sale count stands alone, exactly
  // as the tip badge falls back.
  const earnedUsd = Number(item.sales_usd) || 0
  const hasEarned = earnedUsd > 0

  const handleApprove = async (e) => {
    e.stopPropagation()

    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }

    try {
      await ensureWalletChain()
    } catch (err) {
      toast(err.shortMessage || err.message || 'Could not switch network', 'error')
      return
    }

    lastActionRef.current = 'approve'
    if (isLsp7) {
      writeContract({
        abi: lsp7Abi,
        address: paymentToken,
        functionName: 'authorizeOperator',
        args: [sellAddress, listing.price, '0x'],
        chainId,
      })
    } else {
      writeContract({
        abi: erc20Abi,
        address: paymentToken,
        functionName: 'approve',
        args: [sellAddress, listing.price],
        chainId,
      })
    }
  }

  const handleBuy = async (e) => {
    e.stopPropagation()

    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }

    try {
      await ensureWalletChain()
    } catch (err) {
      toast(err.shortMessage || err.message || 'Could not switch network', 'error')
      return
    }

    // The buyer's own public key rides along with the payment: it is what the seller wraps the
    // content key to, and putting it in the purchase means there is no separate registration
    // step to forget. Derived from the Security Vault, so it is reproducible on any device.
    let identity
    try {
      identity = await resolveIdentity()
      if (!identity) {
        await requestVaultUnlock({ reason: 'Preparing the key this content will be delivered to' })
        identity = await resolveIdentity()
      }
      if (!identity) throw new Error('Your Security Vault is locked')
    } catch (err) {
      toast(err.code === 4001 ? 'Purchase cancelled' : err.message || 'Could not prepare your key', 'error')
      return
    }

    // Committing the displayed price/token/standard onchain: buy reverts with ListingChanged
    // if the seller updates the listing between render and inclusion, so a stale UI (or a seller
    // front-run) can never charge more than the price shown on this button
    const args = [address, BigInt(item.id), listing.price, listing.paymentToken, isLsp7, identity.pubKeyHex]

    // Deliberately NOT routed through the burner session, unlike a like or a post. A purchase
    // spends the user's money, and value always leaves the connected wallet — the same rule tips
    // and predict bets follow. Routing it through the session key would also split the approve
    // from the spend: handleApprove authorises from the connected wallet, so a burner buy would
    // arrive with no allowance. The wallet prompt here is the user's consent to pay.
    lastActionRef.current = 'buy'
    writeContract({
      abi: sellAbi,
      address: sellAddress,
      functionName: 'buy',
      args,
      chainId,
      ...(isTokenListing ? {} : { value: listing.price }),
    })
  }

  return (
    <div className={styles.buyBox} onClick={(e) => e.stopPropagation()}>
      {isSeller && awaitingCount > 0 && (
        <div className={styles.awaitingBadge}>
          <KeyIcon size={13} weight="fill" />
          <span>
            {awaitingCount} buyer{awaitingCount === 1 ? '' : 's'} awaiting a key — open Sell to release
          </span>
        </div>
      )}

      <div className={styles.actionRow}>
        <span className={styles.badge}>
          <SparkleIcon size={12} />
          Premium
        </span>

        {hasPurchased ? null : isInactive ? (
          <span className={styles.inactiveLabel}>Sold out / not for sale right now</span>
        ) : needsApproval ? (
          <button type="button" onClick={handleApprove} disabled={isBusy} className={styles.buyButton}>
            {isBusy ? 'Confirming...' : `Approve ${priceLabel}`}
          </button>
        ) : (
          <button type="button" onClick={handleBuy} disabled={isBusy} className={styles.buyButton}>
            {isBusy ? 'Confirming...' : `Buy for ${priceLabel}`}
          </button>
        )}
      </div>

      {(listing.totalSold > 0n || listing.quantity > 0n) && (
        <div className={styles.salesStat}>
          <TrendUpIcon size={13} />
          <span>
            {hasEarned && <span className={styles.earned}>{formatEarned(earnedUsd)} earned</span>}
            {hasEarned && listing.totalSold > 0n && ' · '}
            {listing.totalSold > 0n && `${compact(listing.totalSold)} sold`}
            {listing.totalSold > 0n && listing.quantity > 0n && ' · '}
            {/* Remaining slots, not units: one purchase per buyer, so this is how many more
                people can buy. Scarcity is the thing a buyer actually wants to see. */}
            {listing.quantity > 0n && (
              <span className={listing.quantity <= 5n ? styles.lowStock : undefined}>{compact(listing.quantity)} left</span>
            )}
          </span>
        </div>
      )}

      {hasPurchased && <RevealGatedContent item={item} cid={listing.contentURI} />}
    </div>
  )
}
