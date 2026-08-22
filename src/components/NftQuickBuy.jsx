'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnection, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, zeroAddress } from 'viem'
import clsx from 'clsx'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { formatStake } from '@/hooks/useStakeToken'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { lsp7Abi } from '@/components/TradeCard'
import tradeAbi from '@/abis/HupTrade.json'
import { toast } from '@/components/NextToast'
import styles from './NftQuickBuy.module.scss'

// IHupTrade.ListingStatus
const STATUS_ACTIVE = 1

/**
 * NFT Quick Buy
 * One-tap purchase button for NFT Market grid tiles. The tile renders purely from its
 * indexed row, so this button makes zero onchain reads until tapped — the first tap
 * verifies the listing live (status, purchasability, terms, allowance) and only then
 * moves funds, the same guarantees TradeCard gives the detail page. Terms that drifted
 * from what the tile shows never buy silently: a raised price demands a second tap on
 * the new number, a swapped payment token sends the buyer to the item page.
 * Renders nothing for inactive listings and the seller's own tiles.
 * @param {Object} props
 * @param {Object} props.listing Row from GET /api/v1/nfts.
 * @param {'overlay'|'inline'} [props.variant='overlay'] 'overlay' is the pill that lands on
 * artwork and holds its own ground in any theme; 'inline' is for a row on the page's own
 * surface — a table cell — where fixed white would read as a hole.
 */
export default function NftQuickBuy({ listing, variant = 'overlay' }) {
  // idle → (tap) checking → approve | confirm | buying; done and gone are terminal
  const [phase, setPhase] = useState('idle')
  const [isBurnerBusy, setIsBurnerBusy] = useState(false)
  const [confirmPrice, setConfirmPrice] = useState(null)
  const { address } = useConnection()
  const liveRef = useRef(null)
  const lastActionRef = useRef(null)

  const chainId = Number(listing.network_id)
  const publicClient = usePublicClient({ chainId })
  const chainInfo = appChains.find((c) => c.id === chainId)
  const tradeAddress = CONTRACTS[`chain${chainId}`]?.trade || null
  const listingId = listing.listing_id ? BigInt(listing.listing_id) : null

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const isBusy = phase === 'checking' || isPending || isConfirming || isBurnerBusy

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    if (lastActionRef.current === 'approve') {
      toast('Token approved — tap Buy to finish', 'success')
      setPhase('confirm')
    } else {
      toast('NFT purchased — it now belongs to you', 'success')
      setPhase('done')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const isSeller = Boolean(address && listing.wallet_address && address.toLowerCase() === listing.wallet_address.toLowerCase())
  if (Number(listing.status) !== STATUS_ACTIVE || isSeller || !tradeAddress || !listingId) return null

  const runBuy = async (live) => {
    const isNativePrice = !live.token || live.token === zeroAddress
    // The grid has no repost context, so no referral rides along
    const args = [address, listingId, zeroAddress]

    // Burner session skips the wallet popup, same as TradeCard; approvals stay wagmi-only
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))
    if (session.active) {
      setIsBurnerBusy(true)
      try {
        await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: tradeAddress,
          abi: tradeAbi,
          functionName: 'buy',
          args: isNativePrice ? [...args, { value: live.price }] : args,
        })
        toast('NFT purchased — it now belongs to you', 'success')
        setPhase('done')
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
        setPhase('confirm')
      } finally {
        setIsBurnerBusy(false)
      }
      return
    }

    lastActionRef.current = 'buy'
    // A rejected wallet popup lands back here — retries skip straight to buying
    setPhase('confirm')
    writeContract({
      abi: tradeAbi,
      address: tradeAddress,
      functionName: 'buy',
      args,
      chainId,
      ...(isNativePrice ? { value: live.price } : {}),
    })
  }

  const runApprove = (live) => {
    lastActionRef.current = 'approve'
    if (live.isTokenLsp7) {
      writeContract({
        abi: lsp7Abi,
        address: live.token,
        functionName: 'authorizeOperator',
        args: [tradeAddress, live.price, '0x'],
        chainId,
      })
    } else {
      writeContract({
        abi: erc20Abi,
        address: live.token,
        functionName: 'approve',
        args: [tradeAddress, live.price],
        chainId,
      })
    }
  }

  const handleClick = async (e) => {
    // The tile is a link right up to this button — buying must never navigate
    e.preventDefault()
    e.stopPropagation()
    if (isBusy || phase === 'done' || phase === 'gone') return
    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }

    if (phase === 'approve') return runApprove(liveRef.current)
    if (phase === 'confirm') return runBuy(liveRef.current)

    setPhase('checking')
    try {
      const [live, purchasable] = await Promise.all([
        publicClient.readContract({ abi: tradeAbi, address: tradeAddress, functionName: 'getListing', args: [listingId] }),
        publicClient.readContract({ abi: tradeAbi, address: tradeAddress, functionName: 'isPurchasable', args: [listingId] }),
      ])

      if (Number(live.status) !== STATUS_ACTIVE || !purchasable) {
        setPhase('gone')
        toast('This listing is no longer available', 'error')
        return
      }
      if (live.seller?.toLowerCase() === address.toLowerCase()) {
        setPhase('gone')
        toast('This is your own listing', 'error')
        return
      }

      // A swapped payment token can't be priced against what the tile shows — the item
      // page re-reads and re-labels everything, so send the buyer there
      if ((live.token || zeroAddress).toLowerCase() !== (listing.payment_token || zeroAddress).toLowerCase()) {
        setPhase('gone')
        toast('Listing terms changed — open the item to review', 'error')
        return
      }

      liveRef.current = live

      const isNativePrice = !live.token || live.token === zeroAddress
      if (!isNativePrice) {
        const allowance = live.isTokenLsp7
          ? await publicClient.readContract({
              abi: lsp7Abi,
              address: live.token,
              functionName: 'authorizedAmountFor',
              args: [tradeAddress, address],
            })
          : await publicClient.readContract({
              abi: erc20Abi,
              address: live.token,
              functionName: 'allowance',
              args: [address, tradeAddress],
            })
        if (allowance < live.price) {
          setPhase('approve')
          return
        }
      }

      // A raised price never buys on the tap that priced lower — surface the new number
      // and demand a fresh tap on it. Same or lower proceeds straight through.
      if (live.price > BigInt(listing.price ?? 0)) {
        setConfirmPrice(formatStake(live.price, listing.decimals))
        setPhase('confirm')
        toast('The price has changed — tap Buy again to confirm', 'error')
        return
      }

      await runBuy(live)
    } catch (err) {
      setPhase('idle')
      toast(err.shortMessage || err.message || 'Could not verify the listing', 'error')
    }
  }

  let label = 'Buy'
  if (phase === 'checking') label = 'Checking…'
  else if (isPending || isConfirming || isBurnerBusy) label = 'Confirming…'
  else if (phase === 'approve') label = `Approve ${listing.symbol || 'token'}`
  else if (phase === 'confirm') label = confirmPrice ? `Buy ${confirmPrice} ${listing.symbol || ''}`.trim() : 'Buy'
  else if (phase === 'done') label = 'Bought'
  else if (phase === 'gone') label = 'Unavailable'

  return (
    <button
      type="button"
      className={clsx(styles.quickBuy, {
        [styles['quickBuy--inline']]: variant === 'inline',
        [styles['quickBuy--done']]: phase === 'done',
        [styles['quickBuy--gone']]: phase === 'gone',
      })}
      onClick={handleClick}
      disabled={isBusy || phase === 'done' || phase === 'gone'}
      aria-label="Buy this NFT now"
    >
      {label}
    </button>
  )
}
