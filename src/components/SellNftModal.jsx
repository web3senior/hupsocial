'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnection, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, formatUnits, isAddress, pad, parseEventLogs, parseUnits, toHex, zeroAddress } from 'viem'
import clsx from 'clsx'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { TIP_TOKENS } from '@/lib/tokens'
import tradeAbi from '@/abis/HupTrade.json'
import useNftMetadata from '@/hooks/useNftMetadata'
import { toast } from '@/components/NextToast'
import NativeDialog from './ui/NativeDialog'
import styles from './SellNftModal.module.scss'

const LUKSO_CHAIN_IDS = [42, 4201]

// Listing terms live onchain; HupTrade caps the referral share at 50% (MAX_REFERRAL_BPS)
const MAX_REFERRAL_PERCENT = 50

const shortAddress = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`

// Numeric-ish token ids read better as numbers; hash-style bytes32 ids get truncated hex
const shortTokenId = (tokenId) => {
  try {
    const numeric = BigInt(tokenId)
    return numeric < 10n ** 12n ? `#${numeric}` : `${tokenId.slice(0, 10)}…`
  } catch {
    return tokenId
  }
}

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
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
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

// ERC721 ids are decimal-ish numbers, LSP8 ids are bytes32 — normalize both to the bytes32
// form HupTrade stores. Invalid/incomplete input resolves to null and keeps everything disabled.
const normalizeTokenId = (raw) => {
  const value = `${raw}`.trim()
  if (!value) return null
  try {
    if (value.startsWith('0x')) {
      if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) return null
      return pad(value, { size: 32 })
    }
    if (!/^\d+$/.test(value)) return null
    return toHex(BigInt(value), { size: 32 })
  } catch {
    return null
  }
}

/**
 * Sell NFT Modal
 * Lists an ERC721 or LSP8 token on HupTrade (approve → list, non-custodial) and hands the
 * resulting listing reference back to the composer so it can travel inside the post's
 * content JSON.
 * @param {Object} props
 * @param {number} props.chainId Chain the post (and therefore the listing) lands on.
 * @param {Function} props.onAttached Receives the nftListing content payload after listing.
 * @param {Function} props.onClose Clears the open-modal state on close.
 */
const SellNftModal = ({ chainId, onAttached, onClose }) => {
  const isLukso = LUKSO_CHAIN_IDS.includes(chainId)

  const [collection, setCollection] = useState('')
  const [tokenIdInput, setTokenIdInput] = useState('')
  // LSP8 is the native NFT standard on LUKSO; everywhere else ERC721 is the only option
  const [standard, setStandard] = useState(isLukso ? 'lsp8' : 'erc721')
  const [price, setPrice] = useState('')
  const [paymentChoice, setPaymentChoice] = useState('native')
  const [referralPercent, setReferralPercent] = useState('0')
  // Listings that exist onchain but may never have made it into a post (listed, then the
  // composer was abandoned) — offered for re-attach or cancel so they're never stranded
  const [myListings, setMyListings] = useState([])
  const [cancellingId, setCancellingId] = useState(null)
  const { address } = useConnection()
  const dialogRef = useRef(null)
  const lastActionRef = useRef(null)

  const chainInfo = appChains.find((c) => c.id === chainId)
  const tradeAddress = CONTRACTS[`chain${chainId}`]?.trade || null
  const nativeCurrency = chainInfo?.nativeCurrency
  const tipTokens = TIP_TOKENS[chainId] ?? []

  const isLsp8 = standard === 'lsp8'
  const trimmedCollection = collection.trim()
  const collectionAddress = isAddress(trimmedCollection) ? trimmedCollection : null
  const tokenId = normalizeTokenId(tokenIdInput)
  const hasToken = Boolean(collectionAddress && tokenId && tradeAddress)

  const listedToken = paymentChoice.startsWith('token:')
    ? tipTokens.find((t) => t.address === paymentChoice.slice('token:'.length))
    : null
  const tokenAddress = listedToken ? listedToken.address : null
  const isTokenLsp7 = Boolean(listedToken?.lsp7)

  const metadata = useNftMetadata({ chainId, collection: collectionAddress, tokenId, isLsp8, enabled: hasToken })

  // Ownership — the listing tx would revert anyway, but checking up front keeps the
  // button honest and the error readable
  const { data: erc721Owner } = useReadContract({
    abi: erc721Abi,
    address: collectionAddress,
    functionName: 'ownerOf',
    args: [tokenId ? BigInt(tokenId) : 0n],
    chainId,
    query: { enabled: Boolean(hasToken && !isLsp8) },
  })

  const { data: lsp8Owner } = useReadContract({
    abi: lsp8Abi,
    address: collectionAddress,
    functionName: 'tokenOwnerOf',
    args: [tokenId],
    chainId,
    query: { enabled: Boolean(hasToken && isLsp8) },
  })

  const owner = isLsp8 ? lsp8Owner : erc721Owner
  const isOwner = Boolean(owner && address && owner.toLowerCase() === address.toLowerCase())

  // Transfer rights — HupTrade needs approval (ERC721) / operator rights (LSP8) before list()
  const { data: approvedFor, refetch: refetchApproved } = useReadContract({
    abi: erc721Abi,
    address: collectionAddress,
    functionName: 'getApproved',
    args: [tokenId ? BigInt(tokenId) : 0n],
    chainId,
    query: { enabled: Boolean(hasToken && !isLsp8) },
  })

  const { data: approvedForAll, refetch: refetchApprovedForAll } = useReadContract({
    abi: erc721Abi,
    address: collectionAddress,
    functionName: 'isApprovedForAll',
    args: [address, tradeAddress],
    chainId,
    query: { enabled: Boolean(hasToken && !isLsp8 && address) },
  })

  const { data: isOperator, refetch: refetchOperator } = useReadContract({
    abi: lsp8Abi,
    address: collectionAddress,
    functionName: 'isOperatorFor',
    args: [tradeAddress, tokenId],
    chainId,
    query: { enabled: Boolean(hasToken && isLsp8) },
  })

  const hasTransferRights = isLsp8
    ? Boolean(isOperator)
    : approvedFor?.toLowerCase() === tradeAddress?.toLowerCase() || Boolean(approvedForAll)

  const { data: tokenDecimals } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'decimals',
    chainId,
    query: { enabled: Boolean(tokenAddress) },
  })

  const symbol = listedToken ? listedToken.symbol : nativeCurrency?.symbol || ''
  const decimals = listedToken ? tokenDecimals : nativeCurrency?.decimals ?? 18

  const parsedPrice = Number(price)
  const isValidPrice = Number.isFinite(parsedPrice) && parsedPrice > 0
  let priceUnits = null
  if (isValidPrice && decimals !== undefined) {
    try {
      priceUnits = parseUnits(price, decimals)
    } catch {
      priceUnits = null
    }
  }

  const parsedReferral = Number(referralPercent)
  const isValidReferral = Number.isFinite(parsedReferral) && parsedReferral >= 0 && parsedReferral <= MAX_REFERRAL_PERCENT
  const referralBps = isValidReferral ? Math.round(parsedReferral * 100) : null

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { data: receipt, isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const isBusy = isPending || isConfirming

  // Mount = open / unmount = close, matching the NewPost dialog contract
  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  useEffect(() => {
    if (!address || !chainId) return

    let cancelled = false
    fetch(`/api/v1/trade/listings?networkId=${chainId}&seller=${address.toLowerCase()}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json?.success) setMyListings(json.data || [])
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [address, chainId])

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    if (lastActionRef.current === 'approve') {
      toast('Transfer approved — you can list your NFT now', 'success')
      refetchApproved()
      refetchApprovedForAll()
      refetchOperator()
      return
    }
    if (lastActionRef.current === 'cancel') {
      toast('Listing cancelled', 'success')
      setMyListings((prev) => prev.filter((row) => String(row.listing_id) !== cancellingId))
      setCancellingId(null)
      return
    }

    // The listing id only exists onchain — pull it out of the receipt's Listed event
    let listingId = null
    try {
      const [listed] = parseEventLogs({ abi: tradeAbi, logs: receipt?.logs ?? [], eventName: 'Listed' })
      listingId = listed?.args?.listingId?.toString() || null
    } catch {
      listingId = null
    }
    if (!listingId) {
      toast('Listing confirmed but its id could not be read — please try again', 'error')
      return
    }

    toast('NFT listed for sale', 'success')
    onAttached({
      listingId,
      chainId,
      collection: collectionAddress,
      tokenId,
      isLsp8,
      token: tokenAddress ?? zeroAddress,
      isTokenLsp7,
      price: priceUnits.toString(),
      referralBps,
    })
    dialogRef.current?.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const handleApprove = (e) => {
    e.stopPropagation()
    if (!hasToken) return

    lastActionRef.current = 'approve'
    if (isLsp8) {
      writeContract({
        abi: lsp8Abi,
        address: collectionAddress,
        functionName: 'authorizeOperator',
        args: [tradeAddress, tokenId, '0x'],
        chainId,
      })
    } else {
      writeContract({
        abi: erc721Abi,
        address: collectionAddress,
        functionName: 'approve',
        args: [tradeAddress, BigInt(tokenId)],
        chainId,
      })
    }
  }

  const handleList = (e) => {
    e.stopPropagation()
    if (!hasToken || priceUnits === null || referralBps === null) return

    lastActionRef.current = 'list'
    writeContract({
      abi: tradeAbi,
      address: tradeAddress,
      functionName: 'list',
      args: [address, collectionAddress, tokenId, isLsp8, tokenAddress ?? zeroAddress, isTokenLsp7, priceUnits, BigInt(referralBps)],
      chainId,
    })
  }

  const needsApproval = hasToken && isOwner && !hasTransferRights

  // Re-attach an onchain listing that never made it into a post — the DB row carries every
  // field the content payload needs, no new transaction required
  const handleAttachExisting = (row) => {
    onAttached({
      listingId: String(row.listing_id),
      chainId,
      collection: row.collection,
      tokenId: row.token_id,
      isLsp8: Boolean(row.is_lsp8),
      token: row.payment_token,
      isTokenLsp7: Boolean(row.is_lsp7),
      price: String(row.price),
      referralBps: Number(row.referral_bps),
    })
    dialogRef.current?.close()
  }

  const handleCancelExisting = (row) => {
    lastActionRef.current = 'cancel'
    setCancellingId(String(row.listing_id))
    writeContract({
      abi: tradeAbi,
      address: tradeAddress,
      functionName: 'cancelListing',
      args: [BigInt(row.listing_id)],
      chainId,
    })
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.sellNftModal}
      aria-label="Sell an NFT"
      onClick={(e) => e.stopPropagation()}
      // Nested inside the composer's NativeDialog — React's synthetic close/cancel events
      // propagate up the component tree, and without these the composer closes too
      onCancel={(e) => e.stopPropagation()}
      onClose={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <header className={styles.sellNftModal__header}>
        <button type="button" className={styles.sellNftModal__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <h3>Sell an NFT</h3>
      </header>

      <main className={styles.sellNftModal__body}>
        {myListings.length > 0 && (
          <div className={styles.sellNftModal__existing}>
            <p className={styles.sellNftModal__existingTitle}>Your active listings</p>
            <p className={styles.sellNftModal__hint}>
              Already listed onchain — attach one to this post, or cancel it to release the NFT.
            </p>
            {myListings.map((row) => (
              <div key={row.listing_id} className={styles.sellNftModal__existingRow}>
                <div className={styles.sellNftModal__existingInfo}>
                  <strong>
                    {shortAddress(row.collection)} {shortTokenId(row.token_id)}
                  </strong>
                  <span>
                    {new Intl.NumberFormat('en', { maximumFractionDigits: 6 }).format(
                      Number(formatUnits(BigInt(row.price), row.decimals ?? 18)),
                    )}{' '}
                    {row.symbol || (row.payment_token === zeroAddress ? nativeCurrency?.symbol : 'tokens')}
                  </span>
                </div>
                <div className={styles.sellNftModal__existingActions}>
                  <button type="button" onClick={() => handleAttachExisting(row)} disabled={isBusy}>
                    Attach
                  </button>
                  <button type="button" onClick={() => handleCancelExisting(row)} disabled={isBusy}>
                    {cancellingId === String(row.listing_id) && isBusy ? 'Confirming...' : 'Cancel'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {isLukso && (
          <div className={styles.sellNftModal__field}>
            <label htmlFor="sellNftStandard">Standard</label>
            <select id="sellNftStandard" value={standard} onChange={(e) => setStandard(e.target.value)}>
              <option value="lsp8">LSP8 (LUKSO NFT)</option>
              <option value="erc721">ERC721</option>
            </select>
          </div>
        )}

        <div className={styles.sellNftModal__field}>
          <label htmlFor="sellNftCollection">Collection address</label>
          <input
            type="text"
            id="sellNftCollection"
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            placeholder="0x..."
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className={styles.sellNftModal__field}>
          <label htmlFor="sellNftTokenId">Token id</label>
          <input
            type="text"
            id="sellNftTokenId"
            value={tokenIdInput}
            onChange={(e) => setTokenIdInput(e.target.value)}
            placeholder={isLsp8 ? '0x... or number' : 'e.g. 42'}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {hasToken && (
          <div className={styles.sellNftModal__preview}>
            {metadata.image && <img src={metadata.image} alt={metadata.name || 'NFT'} />}
            <div className={styles.sellNftModal__previewText}>
              <strong>{metadata.name || (metadata.isLoading ? 'Loading…' : 'Unknown token')}</strong>
              {metadata.collectionName && <span>{metadata.collectionName}</span>}
              {owner && !isOwner && <span className={styles.sellNftModal__warning}>This token belongs to another wallet</span>}
            </div>
          </div>
        )}

        <div className={styles.sellNftModal__field}>
          <label htmlFor="sellNftToken">Sell for</label>
          <select id="sellNftToken" value={paymentChoice} onChange={(e) => setPaymentChoice(e.target.value)}>
            <option value="native">{`${nativeCurrency?.name || 'Native'} (${nativeCurrency?.symbol || ''})`}</option>
            {tipTokens.map((token) => (
              <option key={token.address} value={`token:${token.address}`}>
                {token.symbol}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.sellNftModal__field}>
          <label htmlFor="sellNftPrice">Price</label>
          <div className={styles.sellNftModal__amount}>
            <input
              type="number"
              id="sellNftPrice"
              value={price}
              min={0}
              step="any"
              inputMode="decimal"
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0"
            />
            <span className={styles.sellNftModal__amountSymbol}>{symbol}</span>
          </div>
        </div>

        <div className={styles.sellNftModal__field}>
          <label htmlFor="sellNftReferral">Referral reward %</label>
          <input
            type="number"
            id="sellNftReferral"
            value={referralPercent}
            min={0}
            max={MAX_REFERRAL_PERCENT}
            step="any"
            inputMode="decimal"
            onChange={(e) => setReferralPercent(e.target.value)}
          />
          <p className={styles.sellNftModal__hint}>
            Share of the price paid to whoever's repost leads to the sale (0–{MAX_REFERRAL_PERCENT}%)
          </p>
        </div>
      </main>

      <footer className={styles.sellNftModal__footer}>
        {!tradeAddress && <p className={styles.sellNftModal__hint}>NFT selling isn&apos;t available on this network yet</p>}
        {needsApproval ? (
          <button type="button" className={clsx(styles.sellNftModal__submit)} onClick={handleApprove} disabled={isBusy}>
            {isBusy ? 'Confirming...' : 'Approve transfer'}
          </button>
        ) : (
          <button
            type="button"
            className={clsx(styles.sellNftModal__submit)}
            onClick={handleList}
            disabled={isBusy || !hasToken || !isOwner || !hasTransferRights || priceUnits === null || referralBps === null}
          >
            {isBusy
              ? 'Confirming...'
              : isValidPrice
              ? `List for ${new Intl.NumberFormat('en', { maximumFractionDigits: 6 }).format(parsedPrice)} ${symbol}`
              : 'List for sale'}
          </button>
        )}
      </footer>
    </NativeDialog>
  )
}

export default SellNftModal
