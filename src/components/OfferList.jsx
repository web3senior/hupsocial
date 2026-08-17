'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useConnection, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { formatUnits, numberToHex, zeroAddress } from 'viem'
import useSWR from 'swr'
import clsx from 'clsx'
// From config/contracts, never config/wagmi: this list renders on server-evaluated route
// graphs (the listing page), and importing the wagmi config there constructs connectors
// during that pass
import { appChains, CONTRACTS } from '@/config/contracts'
import offersAbi from '@/abis/HupOffers.json'
import { toast } from '@/components/NextToast'
import Profile from './Profile'
import styles from './OfferList.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const erc721Abi = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getApproved',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'isApprovedForAll',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'setApprovalForAll',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
]

// LSP8 Identifiable Digital Asset (LUKSO) — per-token operator equivalents of approve
const lsp8Abi = [
  {
    type: 'function',
    name: 'tokenOwnerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'isOperatorFor',
    stateMutability: 'view',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'tokenId', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'authorizeOperator',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'tokenId', type: 'bytes32' },
      { name: 'operatorNotificationData', type: 'bytes' },
    ],
    outputs: [],
  },
]

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'always' })
const dayFormat = new Intl.NumberFormat('en', { style: 'unit', unit: 'day', unitDisplay: 'long' })
const hourFormat = new Intl.NumberFormat('en', { style: 'unit', unit: 'hour', unitDisplay: 'long' })

// "in 3 days" / "in 5 hours" — offers expire on hour-to-month horizons, so two units cover it
const formatExpiry = (expiresAt) => {
  const seconds = expiresAt - Math.floor(Date.now() / 1000)
  if (seconds <= 0) return 'expired'
  if (seconds >= 86400) return relativeTime.format(Math.round(seconds / 86400), 'day')
  return relativeTime.format(Math.max(Math.round(seconds / 3600), 1), 'hour')
}

// Bare duration ("6 days" / "5 hours") for the table's "Expires in" column, where the
// header already carries the preposition
const formatTimeLeft = (expiresAt) => {
  const seconds = expiresAt - Math.floor(Date.now() / 1000)
  if (seconds <= 0) return 'Expired'
  if (seconds >= 86400) return dayFormat.format(Math.round(seconds / 86400))
  return hourFormat.format(Math.max(Math.round(seconds / 3600), 1))
}

// HupOffers keys tokens by bytes32 for both standards. Indexed rows already carry the hex
// form; chain-enumerated ERC721 ids can arrive as plain decimals, so normalize once here.
const toBytes32TokenId = (raw) => {
  const value = String(raw)
  if (value.startsWith('0x')) return value
  try {
    return numberToHex(BigInt(value), { size: 32 })
  } catch {
    return value
  }
}

/**
 * Offer List
 * The single implementation of an asset's live offer book — rows from the cidex-indexed
 * nft_offers read model, cancel for the viewer's own offer, and the approve-then-accept
 * flow when the viewer owns the token. Two layouts share the identical logic: `stack`
 * renders the OfferModal tab's compact rows, `table` the listing page's
 * Price / From / Expires in / Actions columns.
 * @param {Object} props
 * @param {number} props.chainId The asset's chain.
 * @param {string} props.collection The NFT contract address.
 * @param {string} props.tokenId The token id (bytes32 hex or plain decimal).
 * @param {boolean} props.isLsp8 True for LSP8 collections, false for ERC721.
 * @param {string} [props.ownerAddress] The token's current owner when the caller already
 *        knows it (a live listing's seller). Omit it and the list reads the owner from the
 *        chain instead — either way it unlocks the accept flow.
 * @param {('stack'|'table')} [props.variant] Layout to render. Defaults to 'stack'.
 */
const OfferList = ({ chainId, collection, tokenId: tokenIdProp, isLsp8, ownerAddress, variant = 'stack' }) => {
  const tokenId = toBytes32TokenId(tokenIdProp)
  // The offer row a pending accept/cancel belongs to, so only that row's button spins
  const [pendingOfferId, setPendingOfferId] = useState(null)
  const { address } = useConnection()
  const lastActionRef = useRef(null)

  const offersAddress = CONTRACTS[`chain${chainId}`]?.offers || null
  const nativeSymbol = appChains.find((c) => c.id === chainId)?.nativeCurrency?.symbol || ''

  // Ownership decides whether the accept flow appears. Callers that already know the owner
  // (a live listing's seller) pass it in; everywhere else it comes from the chain, which is
  // also the only source that can't be stale.
  const { data: erc721Owner } = useReadContract({
    abi: erc721Abi,
    address: collection,
    functionName: 'ownerOf',
    args: [tokenId ? BigInt(tokenId) : 0n],
    chainId,
    query: { enabled: Boolean(!ownerAddress && !isLsp8 && tokenId && collection) },
  })

  const { data: lsp8Owner } = useReadContract({
    abi: lsp8Abi,
    address: collection,
    functionName: 'tokenOwnerOf',
    args: [tokenId],
    chainId,
    query: { enabled: Boolean(!ownerAddress && isLsp8 && tokenId && collection) },
  })

  const owner = ownerAddress || (isLsp8 ? lsp8Owner : erc721Owner) || null
  const isOwner = Boolean(address && owner && address.toLowerCase() === owner.toLowerCase())

  // Accept side: the owner delivers the token non-custodially, so the offers contract needs
  // transfer rights at accept time — the same approval dance the sell flow does for HupTrade
  const { data: erc721Approved, refetch: refetchErc721Approved } = useReadContract({
    abi: erc721Abi,
    address: collection,
    functionName: 'getApproved',
    args: [tokenId ? BigInt(tokenId) : 0n],
    chainId,
    query: { enabled: Boolean(isOwner && !isLsp8 && tokenId && offersAddress) },
  })

  const { data: erc721ApprovedForAll, refetch: refetchErc721ApprovedForAll } = useReadContract({
    abi: erc721Abi,
    address: collection,
    functionName: 'isApprovedForAll',
    args: [address, offersAddress],
    chainId,
    query: { enabled: Boolean(isOwner && !isLsp8 && address && offersAddress) },
  })

  const { data: lsp8IsOperator, refetch: refetchLsp8Operator } = useReadContract({
    abi: lsp8Abi,
    address: collection,
    functionName: 'isOperatorFor',
    args: [offersAddress, tokenId],
    chainId,
    query: { enabled: Boolean(isOwner && isLsp8 && tokenId && offersAddress) },
  })

  const hasTransferRights = isLsp8
    ? Boolean(lsp8IsOperator)
    : erc721Approved?.toLowerCase() === offersAddress?.toLowerCase() || Boolean(erc721ApprovedForAll)
  const refetchTransferRights = () => {
    if (isLsp8) refetchLsp8Operator()
    else {
      refetchErc721Approved()
      refetchErc721ApprovedForAll()
    }
  }

  const offersKey = offersAddress
    ? `/api/v1/nfts/offers?networkId=${chainId}&collection=${collection.toLowerCase()}&tokenId=${tokenId.toLowerCase()}`
    : null
  const { data: offersData, mutate: mutateOffers } = useSWR(offersKey, fetcher)
  const offers = offersData?.data ?? []

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const isBusy = isPending || isConfirming

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    if (lastActionRef.current === 'approve-nft') {
      toast(isLsp8 ? 'NFT approved — you can accept the offer now' : 'Collection approved — you can accept the offer now', 'success')
      refetchTransferRights()
    } else if (lastActionRef.current === 'accept') {
      toast('Offer accepted — the NFT was delivered and the payment is yours', 'success')
      setPendingOfferId(null)
      mutateOffers()
    } else if (lastActionRef.current === 'cancel') {
      toast('Offer cancelled — your escrow was refunded', 'success')
      setPendingOfferId(null)
      mutateOffers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const handleApproveNft = () => {
    if (!offersAddress) return

    lastActionRef.current = 'approve-nft'
    if (isLsp8) {
      // LSP8 operators are additive — authorizing this contract leaves HupTrade's
      // authorization for the same token intact, so a live listing survives
      writeContract({
        abi: lsp8Abi,
        address: collection,
        functionName: 'authorizeOperator',
        args: [offersAddress, tokenId, '0x'],
        chainId,
      })
    } else {
      // setApprovalForAll, never approve(offers, tokenId): ERC721's per-token approval is
      // exclusive, so granting it here would silently revoke the one the seller gave HupTrade
      // when they listed — the listing would stay visible and every buy() would revert. The
      // operator flag is a separate slot, so both contracts can hold transfer rights at once.
      writeContract({
        abi: erc721Abi,
        address: collection,
        functionName: 'setApprovalForAll',
        args: [offersAddress, true],
        chainId,
      })
    }
  }

  // Every offers write goes through the connected wallet. HupOffers has no forwarder and no
  // burner-session resolution — it credits msg.sender and nothing else — because both sides of
  // an offer must already control value, so relaying would only add an impersonation surface.
  const handleAccept = (offer) => {
    if (!offersAddress) return

    lastActionRef.current = 'accept'
    setPendingOfferId(offer.offer_id)
    writeContract({
      abi: offersAbi,
      address: offersAddress,
      functionName: 'acceptOffer',
      args: [BigInt(offer.offer_id), 1n],
      chainId,
    })
  }

  const handleCancel = (offer) => {
    if (!offersAddress) return

    lastActionRef.current = 'cancel'
    setPendingOfferId(offer.offer_id)
    writeContract({
      abi: offersAbi,
      address: offersAddress,
      functionName: 'cancelOffer',
      args: [BigInt(offer.offer_id)],
      chainId,
    })
  }

  const formatPrice = (offer) => {
    const value = amountFormat.format(Number(formatUnits(BigInt(offer.price), offer.payment_decimals ?? 18)))
    // Native offers have no store_tokens row — the chain's own currency symbol fills in
    const symbol = offer.payment_symbol ?? (offer.payment_token === zeroAddress ? nativeSymbol : '')
    return symbol ? `${value} ${symbol}` : value
  }

  const renderAction = (offer) => {
    const isOwn = address && offer.offerer.toLowerCase() === address.toLowerCase()
    const offerBusy = isBusy && pendingOfferId === offer.offer_id

    if (isOwn) {
      return (
        <button
          type="button"
          className={clsx(styles.offerList__action, styles['offerList__action--cancel'])}
          onClick={() => handleCancel(offer)}
          disabled={isBusy}
        >
          {offerBusy ? 'Confirming...' : 'Cancel'}
        </button>
      )
    }
    if (isOwner && hasTransferRights) {
      return (
        <button type="button" className={styles.offerList__action} onClick={() => handleAccept(offer)} disabled={isBusy}>
          {offerBusy ? 'Confirming...' : 'Accept'}
        </button>
      )
    }
    return null
  }

  return (
    <div className={clsx(styles.offerList, styles[`offerList--${variant}`])}>
      {/* Approval is granted once for the token, not per offer — as a button on every row
          it read as "accept this one", and since they all share the pending write every
          row said "Confirming..." at once. One notice above the list is the honest shape:
          a gate to open before any Accept button exists. */}
      {isOwner && !hasTransferRights && offers.length > 0 && (
        <div className={styles.offerList__approve}>
          <p className={styles.offerList__approveNote}>
            {isLsp8
              ? 'Approve this NFT once to accept any offer below. It stays in your wallet — the approval only lets the offers contract move it at the moment you accept.'
              : 'Approve this collection once to accept any offer below. Your NFTs stay in your wallet — the approval only lets the offers contract move one at the moment you accept, and it leaves any live listing you have untouched.'}
          </p>
          <button type="button" className={styles.offerList__approveButton} onClick={handleApproveNft} disabled={isBusy}>
            {isBusy ? 'Confirming...' : isLsp8 ? 'Approve NFT' : 'Approve collection'}
          </button>
        </div>
      )}

      {/* Until the first response lands, render nothing rather than a flash of "no offers" */}
      {offersData &&
        (offers.length === 0 ? (
          <p className={styles.offerList__empty}>No active offers yet — be the first.</p>
        ) : variant === 'table' ? (
          <div className={styles.offerList__scroller}>
            <table className={styles.offerList__table}>
              <thead>
                <tr>
                  <th scope="col">Price</th>
                  <th scope="col">From</th>
                  <th scope="col">Expires in</th>
                  <th scope="col" className={styles.offerList__actionsCell}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {offers.map((offer) => {
                  const isOwn = address && offer.offerer.toLowerCase() === address.toLowerCase()
                  // data-label feeds the global _table.scss mobile pattern: under 600px rows
                  // stack into cards and each cell's label renders from this attribute
                  const action = renderAction(offer)
                  return (
                    <tr key={offer.offer_id}>
                      <td data-label="Price" className={styles.offerList__price}>
                        {formatPrice(offer)}
                      </td>
                      <td data-label="From">
                        <div className={styles.offerList__from}>
                          {/* Same identity treatment every other surface gives a wallet — avatar,
                              resolved name, hover card and profile link, Universal Profiles included */}
                          <Profile variant="fullWithoutTime" creator={offer.offerer} networkId={chainId} />
                          {isOwn && (
                            <Link href="/nfts/offers" className={styles.offerList__mine} title="See all offers you've made">
                              Your offer
                            </Link>
                          )}
                        </div>
                      </td>
                      <td
                        data-label="Expires in"
                        className={styles.offerList__expires}
                        title={new Date(offer.expires_at * 1000).toLocaleString()}
                      >
                        {formatTimeLeft(offer.expires_at)}
                      </td>
                      <td
                        data-label="Actions"
                        className={clsx(styles.offerList__actionsCell, !action && styles['offerList__actionsCell--none'])}
                      >
                        {action ?? <span className={styles.offerList__noAction}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className={styles.offerList__offers}>
            {offers.map((offer) => {
              const isOwn = address && offer.offerer.toLowerCase() === address.toLowerCase()
              return (
                <li key={offer.offer_id} className={styles.offerList__offer}>
                  <div className={styles.offerList__offerWho}>
                    <Profile variant="fullWithoutTime" creator={offer.offerer} networkId={chainId} />
                    <span className={styles.offerList__offerExpiry}>
                      {isOwn && 'Your offer · '}expires {formatExpiry(offer.expires_at)}
                    </span>
                  </div>
                  <span className={styles.offerList__offerAmount}>{formatPrice(offer)}</span>
                  {renderAction(offer)}
                </li>
              )
            })}
          </ul>
        ))}
    </div>
  )
}

export default OfferList
