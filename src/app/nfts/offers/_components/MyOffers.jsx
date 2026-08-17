'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useConnection, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { formatUnits, zeroAddress } from 'viem'
import useSWR from 'swr'
import clsx from 'clsx'
import { HandCoinsIcon } from '@phosphor-icons/react'
import { appChains, CONTRACTS } from '@/config/contracts'
import offersAbi from '@/abis/HupOffers.json'
import { displayTokenId } from '@/lib/walletNfts'
import { handleBrokenImage } from '@/lib/utils'
import useNftMetadata from '@/hooks/useNftMetadata'
import { toast } from '@/components/NextToast'
import { ContentSpinner } from '@/components/Loading'
import HupMark from '@/components/ui/HupMark'
import styles from './MyOffers.module.scss'

// Every chain the offers contract is deployed on — the page fans one read out per chain
// and merges, so a wallet's offers surface no matter where they were made
const OFFER_CHAINS = appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.offers)

// IHupOffers.OfferStatus, as indexed into nft_offers
const OFFER_ACTIVE = 1
const OFFER_FILLED = 2
const OFFER_CANCELLED = 3

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })
const dayFormat = new Intl.NumberFormat('en', { style: 'unit', unit: 'day', unitDisplay: 'long' })
const hourFormat = new Intl.NumberFormat('en', { style: 'unit', unit: 'hour', unitDisplay: 'long' })

const nowSeconds = () => Math.floor(Date.now() / 1000)

const shortAddress = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '')

// Bare duration ("6 days" / "5 hours") under the "Expires in" header, same as the listing
// page's offer table
const formatTimeLeft = (expiresAt) => {
  const seconds = expiresAt - nowSeconds()
  if (seconds <= 0) return 'Expired'
  if (seconds >= 86400) return dayFormat.format(Math.round(seconds / 86400))
  return hourFormat.format(Math.max(Math.round(seconds / 3600), 1))
}

// The `past` view is everything unfillable: settled, withdrawn, or timed out. Expired rows
// are still Active onchain — they matter most here, because they still hold escrow.
const statusLabel = (offer) => {
  const status = Number(offer.status)
  if (status === OFFER_FILLED) return 'Filled'
  if (status === OFFER_CANCELLED) return 'Cancelled'
  return offer.expires_at <= nowSeconds() ? 'Expired' : 'Active'
}

const isReclaimable = (offer) => Number(offer.status) === OFFER_ACTIVE && offer.expires_at <= nowSeconds()

// One read per offers chain, merged newest-first. A chain whose API read fails just
// contributes nothing rather than sinking the whole page — offers on the others are
// still actionable, and the next revalidation retries it.
const fetchMyOffers = async ([, wallet, status]) => {
  const perChain = await Promise.all(
    OFFER_CHAINS.map(async (chain) => {
      try {
        const res = await fetch(`/api/v1/nfts/offers?networkId=${chain.id}&offerer=${wallet.toLowerCase()}&standard=0,1&status=${status}`)
        const json = await res.json()
        return json.success ? json.data : []
      } catch {
        return []
      }
    })
  )
  return perChain.flat().sort((a, b) => b.made_at - a.made_at)
}

/**
 * The NFT the offer is on — thumbnail, resolved name, collection and chain — linking to
 * the collection page. Metadata resolves live per token (SWR-immutable, shared with every
 * other surface that already read this token), never from the offers table.
 */
function AssetCell({ offer }) {
  const chainName = appChains.find((chain) => chain.id === offer.network_id)?.name
  const metadata = useNftMetadata({
    chainId: offer.network_id,
    collection: offer.collection,
    tokenId: offer.token_id,
    isLsp8: Number(offer.standard) === 1,
    imageWidth: 96,
  })
  const name = metadata.name || `Token #${displayTokenId(offer.token_id)}`

  return (
    <Link href={`/nfts/${offer.network_id}/collection/${offer.collection.toLowerCase()}`} className={styles.myOffers__asset}>
      {metadata.image ? (
        <img src={metadata.image} alt="" loading="lazy" onError={handleBrokenImage} />
      ) : (
        <span className={styles.myOffers__assetFallback} aria-hidden="true">
          <HupMark size={16} />
        </span>
      )}
      <span className={styles.myOffers__assetText}>
        <strong>{name}</strong>
        <small>
          {metadata.collectionName || shortAddress(offer.collection)}
          {chainName ? ` · ${chainName}` : ''}
        </small>
      </span>
    </Link>
  )
}

/**
 * My Offers
 * The connected wallet's NFT offers across every offers-deployed chain, split into Active
 * (cancellable) and Past. Past is where expired offers surface with their escrow still
 * locked — Reclaim runs the same cancelOffer the contract keeps callable even while
 * paused, so an exit from escrow is never blockable.
 */
export default function MyOffers() {
  const [view, setView] = useState('active')
  // The offer a pending write belongs to — offer ids repeat across chains, so the key
  // carries the network too
  const [pendingKey, setPendingKey] = useState(null)
  const { address, isConnected } = useConnection()
  const lastActionRef = useRef(null)

  const {
    data: offers,
    isLoading,
    mutate,
  } = useSWR(address ? ['my-nft-offers', address, view] : null, fetchMyOffers)

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const isBusy = isPending || isConfirming

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    if (lastActionRef.current === 'reclaim') {
      toast('Escrow reclaimed — your payment is back in your wallet', 'success')
      setPendingKey(null)
      mutate()
    } else if (lastActionRef.current === 'cancel') {
      toast('Offer cancelled — your escrow was refunded', 'success')
      setPendingKey(null)
      mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  // Cancel and reclaim are the same onchain call — cancelOffer refunds whatever of the
  // escrow is still unfilled; only the words differ by why the user is pressing it
  const handleCancel = (offer, action) => {
    const offersAddress = CONTRACTS[`chain${offer.network_id}`]?.offers
    if (!offersAddress) return

    lastActionRef.current = action
    setPendingKey(`${offer.network_id}:${offer.offer_id}`)
    writeContract({
      abi: offersAbi,
      address: offersAddress,
      functionName: 'cancelOffer',
      args: [BigInt(offer.offer_id)],
      chainId: offer.network_id,
    })
  }

  const formatPrice = (offer) => {
    const value = amountFormat.format(Number(formatUnits(BigInt(offer.price), offer.payment_decimals ?? 18)))
    // Native offers have no store_tokens row — the chain's own currency symbol fills in
    const symbol =
      offer.payment_symbol ??
      (offer.payment_token === zeroAddress ? appChains.find((chain) => chain.id === offer.network_id)?.nativeCurrency?.symbol : '')
    return symbol ? `${value} ${symbol}` : value
  }

  if (!isConnected) {
    return (
      <div className={styles.myOffers__gate}>
        <HandCoinsIcon size={32} />
        <p>Connect your wallet to see the offers you&apos;ve made.</p>
      </div>
    )
  }

  const rows = offers ?? []

  return (
    <div className={`${styles.myOffers} animate fade`}>
      <p className={styles.myOffers__intro}>
        Offers you&apos;ve made across the market. Cancel a live one anytime — and reclaim your escrow from expired ones, since an
        expired offer keeps holding your payment until you do.
      </p>

      <div className={styles.myOffers__tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'active'}
          className={clsx(styles.myOffers__tab, view === 'active' && styles['myOffers__tab--active'])}
          onClick={() => setView('active')}
        >
          Active
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'past'}
          className={clsx(styles.myOffers__tab, view === 'past' && styles['myOffers__tab--active'])}
          onClick={() => setView('past')}
        >
          Past
        </button>
      </div>

      {isLoading ? (
        <ContentSpinner />
      ) : rows.length === 0 ? (
        <p className={styles.myOffers__empty}>
          {view === 'active' ? (
            <>
              No active offers — find something on the <Link href="/nfts">NFT market</Link> and make one.
            </>
          ) : (
            'Nothing here yet — filled, cancelled, and expired offers will show up in this view.'
          )}
        </p>
      ) : (
        <div className={styles.myOffers__scroller}>
          <table className={styles.myOffers__table}>
            <thead>
              <tr>
                <th scope="col">Asset</th>
                <th scope="col">Price</th>
                <th scope="col">{view === 'active' ? 'Expires in' : 'Status'}</th>
                <th scope="col" className={styles.myOffers__actionsCell}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((offer) => {
                const rowKey = `${offer.network_id}:${offer.offer_id}`
                const rowBusy = isBusy && pendingKey === rowKey
                const reclaimable = view === 'past' && isReclaimable(offer)
                const hasAction = view === 'active' || reclaimable
                return (
                  <tr key={rowKey}>
                    <td data-label="Asset" className={styles.myOffers__assetCell}>
                      <AssetCell offer={offer} />
                    </td>
                    <td data-label="Price" className={styles.myOffers__price}>
                      {formatPrice(offer)}
                    </td>
                    {view === 'active' ? (
                      <td
                        data-label="Expires in"
                        className={styles.myOffers__expires}
                        title={new Date(offer.expires_at * 1000).toLocaleString()}
                      >
                        {formatTimeLeft(offer.expires_at)}
                      </td>
                    ) : (
                      <td data-label="Status" className={styles.myOffers__expires}>
                        {statusLabel(offer)}
                      </td>
                    )}
                    <td
                      data-label="Actions"
                      className={clsx(styles.myOffers__actionsCell, !hasAction && styles['myOffers__actionsCell--none'])}
                    >
                      {view === 'active' ? (
                        <button
                          type="button"
                          className={clsx(styles.myOffers__action, styles['myOffers__action--cancel'])}
                          onClick={() => handleCancel(offer, 'cancel')}
                          disabled={isBusy}
                        >
                          {rowBusy ? 'Confirming...' : 'Cancel'}
                        </button>
                      ) : reclaimable ? (
                        <button
                          type="button"
                          className={styles.myOffers__action}
                          onClick={() => handleCancel(offer, 'reclaim')}
                          disabled={isBusy}
                        >
                          {rowBusy ? 'Confirming...' : 'Reclaim escrow'}
                        </button>
                      ) : (
                        <span className={styles.myOffers__noAction}>—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
