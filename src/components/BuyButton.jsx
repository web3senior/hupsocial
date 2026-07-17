'use client'

import { erc20Abi, formatEther, formatUnits, zeroAddress } from 'viem'
import { lukso, celo, sepolia, base, monad, bsc, monadTestnet, arbitrumSepolia, somniaTestnet, unichainSepolia, optimismSepolia, lineaSepolia } from 'wagmi/chains'
import { useConnection, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { useEffect, useRef, useState } from 'react'
import { CONTRACTS } from '@/config/wagmi'
import { USDC } from '@/lib/tokens'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import storeAbi from '@/abis/HupBazzar.json'
import { toast } from '@/components/NextToast'
import { SparkleIcon, TrendUpIcon } from '@phosphor-icons/react'
import RevealGatedContent from './RevealGatedContent'
import styles from './BuyButton.module.scss'

const CHAINS = [lukso, celo, sepolia, base, monad, bsc, monadTestnet, arbitrumSepolia, somniaTestnet, unichainSepolia, optimismSepolia, lineaSepolia]

// Compact ("1.2K") for large amounts, but sub-1 amounts keep their significant digits —
// compact's 2-fraction-digit rounding would collapse e.g. 0.00005 ETH raised to "0 ETH".
const formatTokenAmount = (n) =>
  new Intl.NumberFormat(undefined, n > 0 && n < 1 ? { maximumSignificantDigits: 4 } : { notation: 'compact', maximumFractionDigits: 2 }).format(n)

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
  const chainId = Number(item.network_id)
  const publicClient = usePublicClient({ chainId })
  const targetChain = CONTRACTS[`chain${item.network_id}`]
  const storeAddress = targetChain?.store
  const chainInfo = CHAINS.find((c) => c.id === chainId)
  const currencySymbol = chainInfo?.nativeCurrency?.symbol || ''
  const [isBurnerBusy, setIsBurnerBusy] = useState(false)

  const { data: listing } = useReadContract({
    abi: storeAbi,
    address: storeAddress,
    functionName: 'getListing',
    args: [BigInt(item.id)],
    chainId,
    query: { enabled: Boolean(storeAddress) },
  })

  const { data: purchasedAmount, refetch: refetchPurchased } = useReadContract({
    abi: storeAbi,
    address: storeAddress,
    functionName: 'amountPurchased',
    args: [BigInt(item.id), address],
    chainId,
    query: { enabled: Boolean(storeAddress && address) },
  })

  const paymentToken = listing?.paymentToken
  const isTokenListing = Boolean(paymentToken && paymentToken.toLowerCase() !== zeroAddress)
  const isLsp7 = Boolean(isTokenListing && listing?.isLsp7)

  // Revenue is tracked per-payment-token on-chain (not a single flat sum), so it stays correct
  // even if a seller changes a listing's payment token after some sales already happened in a
  // different one — this reads only the revenue earned in the listing's *current* token.
  const { data: revenueInCurrentToken } = useReadContract({
    abi: storeAbi,
    address: storeAddress,
    functionName: 'revenueByToken',
    args: [BigInt(item.id), paymentToken ?? zeroAddress],
    chainId,
    query: { enabled: Boolean(storeAddress && listing) },
  })

  // If the listing has ever changed payment tokens, "totalSold" spans multiple currencies but
  // revenueInCurrentToken only reflects the current one — pairing them (e.g. "2 sold · 1 LYX
  // raised" when 1 of those 2 sales was actually in USDC) would misleadingly imply all sales
  // raised that amount. Safest is to just not show a revenue figure once that's ambiguous.
  const { data: tokensUsedData } = useReadContract({
    abi: storeAbi,
    address: storeAddress,
    functionName: 'getTokensUsed',
    args: [BigInt(item.id)],
    chainId,
    query: { enabled: Boolean(storeAddress && listing) },
  })
  const hasMultipleTokens = (tokensUsedData?.length ?? 0) > 1

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
    args: [address, storeAddress],
    chainId,
    query: { enabled: Boolean(isTokenListing && !isLsp7 && address && storeAddress) },
  })

  const { data: lsp7Allowance, refetch: refetchLsp7Allowance } = useReadContract({
    abi: lsp7Abi,
    address: paymentToken,
    functionName: 'authorizedAmountFor',
    args: [storeAddress, address],
    chainId,
    query: { enabled: Boolean(isLsp7 && address && storeAddress) },
  })

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
  const hasPurchased = Boolean(purchasedAmount && purchasedAmount > 0n)
  const isBusy = isPending || isConfirming || isBurnerBusy

  // Once purchased, keep showing the reveal action even if the listing later goes
  // inactive (e.g. sold out) — access shouldn't disappear just because stock ran out.
  if (!storeAddress || !hasListing) return null
  const isInactive = !hasPurchased && !listing.isActive

  const needsApproval = isTokenListing && allowance !== undefined && allowance < listing.price

  const priceLabel = isTokenListing
    ? tokenDecimals !== undefined
      ? `${formatUnits(listing.price, tokenDecimals)} ${tokenSymbol || ''}`.trim()
      : '...'
    : `${formatEther(listing.price)} ${currencySymbol}`.trim()

  const volumeLabel =
    revenueInCurrentToken > 0n &&
    !hasMultipleTokens &&
    (isTokenListing
      ? tokenDecimals !== undefined
        ? `${formatTokenAmount(Number(formatUnits(revenueInCurrentToken, tokenDecimals)))} ${tokenSymbol || ''}`.trim()
        : null
      : `${formatTokenAmount(Number(formatEther(revenueInCurrentToken)))} ${currencySymbol}`.trim())

  const handleApprove = (e) => {
    e.stopPropagation()

    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }

    lastActionRef.current = 'approve'
    if (isLsp7) {
      writeContract({
        abi: lsp7Abi,
        address: paymentToken,
        functionName: 'authorizeOperator',
        args: [storeAddress, listing.price, '0x'],
        chainId,
      })
    } else {
      writeContract({
        abi: erc20Abi,
        address: paymentToken,
        functionName: 'approve',
        args: [storeAddress, listing.price],
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

    // Committing the displayed price/token/standard onchain: buyItem reverts with ListingChanged
    // if the seller updates the listing between render and inclusion, so a stale UI (or a seller
    // front-run) can never charge more than the price shown on this button
    const args = [address, BigInt(item.id), 1n, listing.price, listing.paymentToken, isLsp7, '0x']

    // Route through the burner session key if one's active — same convenience the rest of the
    // app already gets (e.g. Like), skipping the wallet popup. Approve/authorizeOperator stays
    // wagmi-only regardless (see handleApprove) since those calls have no session awareness.
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsBurnerBusy(true)
      try {
        await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: storeAddress,
          abi: storeAbi,
          functionName: 'buyItem',
          args: isTokenListing ? args : [...args, { value: listing.price }],
        })

        toast('Purchase complete', 'success')
        refetchPurchased()
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsBurnerBusy(false)
      }
      return
    }

    lastActionRef.current = 'buy'
    writeContract({
      abi: storeAbi,
      address: storeAddress,
      functionName: 'buyItem',
      args,
      chainId,
      ...(isTokenListing ? {} : { value: listing.price }),
    })
  }

  return (
    <div className={styles.buyBox} onClick={(e) => e.stopPropagation()}>
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

      {listing.totalSold > 0n && (
        <div className={styles.salesStat}>
          <TrendUpIcon size={13} />
          <span>
            {new Intl.NumberFormat(undefined, { notation: 'compact' }).format(listing.totalSold)} sold
            {volumeLabel ? ` · ${volumeLabel} raised` : ''}
          </span>
        </div>
      )}

      {hasPurchased && <RevealGatedContent item={item} cid={listing.metadata} />}
    </div>
  )
}
