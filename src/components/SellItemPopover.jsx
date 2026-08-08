'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { erc20Abi, formatEther, formatUnits, isAddress, parseEther, parseUnits, zeroAddress } from 'viem'
import { lukso, celo, sepolia, base, monad, bsc, monadTestnet, arbitrumSepolia, somniaTestnet, unichainSepolia, optimismSepolia, lineaSepolia } from 'wagmi/chains'
import { useConnection, usePublicClient, useReadContract, useSignMessage, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import { USDC } from '@/lib/tokens'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import storeAbi from '@/abis/HupBazaar.json'
import { toast } from '@/components/NextToast'
import { normalizeEnvelope } from '@/lib/gatedContent'
import { CaretLeftIcon, CaretRightIcon, LockIcon, PlusIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import RecipientField from './ui/RecipientField'
import { EMPTY_RECIPIENT } from '@/lib/recipientSearch'
import NetworkSelect from '@/components/ui/NetworkSelect'
import Profile from './Profile'
import styles from './SellItemPopover.module.scss'

const MAX_FILE_SIZE_MB = 10
const MAX_FILES = 5
const MAX_LINKS = 5
const BUYERS_PAGE_SIZE = 5
const FEE_DENOMINATOR = 10_000 // matches HupBazaar.sol's FEE_DENOMINATOR constant (buyFeeBps is in basis points)
const CHAINS = [lukso, celo, sepolia, base, monad, bsc, monadTestnet, arbitrumSepolia, somniaTestnet, unichainSepolia, optimismSepolia, lineaSepolia]
const LUKSO_CHAIN_IDS = [42, 4201]

// Reconstructs a File from the base64 payload decrypt returns, so previously uploaded content
// can be dropped straight back into the same file-picker state used for new uploads.
function base64ToFile(base64, filename, mimeType) {
  const byteChars = atob(base64)
  const byteNumbers = new Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i)
  return new File([new Uint8Array(byteNumbers)], filename, { type: mimeType })
}

const SellItemPopover = forwardRef(function SellItemPopover({ item }, ref) {
  const dialogRef = useRef(null)
  const fileInputRef = useRef(null)

  const { address, chain: walletChain } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const switchChain = useSwitchChain({ config })
  const chainId = Number(item.network_id)
  const publicClient = usePublicClient({ chainId })
  const targetChain = CONTRACTS[`chain${item.network_id}`]
  const storeAddress = targetChain?.store
  const chainInfo = CHAINS.find((c) => c.id === chainId)
  const currencySymbol = chainInfo?.nativeCurrency?.symbol || 'native token'
  const isLukso = LUKSO_CHAIN_IDS.includes(chainId)
  const isWrongChain = Boolean(walletChain && walletChain.id !== chainId)

  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [vaultAddress, setVaultAddress] = useState(EMPTY_RECIPIENT)
  const [paymentChoice, setPaymentChoice] = useState('native')
  const [customToken, setCustomToken] = useState('')
  const [contentName, setContentName] = useState('')
  const [contentDescription, setContentDescription] = useState('')
  const [contentLinks, setContentLinks] = useState([])
  const [contentFiles, setContentFiles] = useState([])
  const [isUploadingContent, setIsUploadingContent] = useState(false)
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [buyersPage, setBuyersPage] = useState(0)
  const [isSubmittingBurner, setIsSubmittingBurner] = useState(false)

  const { data: listing, refetch: refetchListing } = useReadContract({
    abi: storeAbi,
    address: storeAddress,
    functionName: 'getListing',
    args: [BigInt(item.id)],
    chainId,
    query: { enabled: Boolean(storeAddress) },
  })

  const hasListing = Boolean(listing && listing.seller && listing.seller.toLowerCase() !== zeroAddress)

  const { data: listingFeeValue } = useReadContract({
    abi: storeAbi,
    address: storeAddress,
    functionName: 'listingFee',
    chainId,
    query: { enabled: Boolean(storeAddress) },
  })

  const { data: buyFeeBpsValue } = useReadContract({
    abi: storeAbi,
    address: storeAddress,
    functionName: 'buyFeeBps',
    chainId,
    query: { enabled: Boolean(storeAddress) },
  })

  // Paginated, on-chain buyer list — bounded per call by MAX_BUYERS_BATCH_READ_COUNT on the
  // contract, so this never risks the unbounded-gas full-history log scan the old version did.
  const {
    data: buyersPageData,
    isLoading: loadingPurchases,
    refetch: refetchBuyers,
  } = useReadContract({
    abi: storeAbi,
    address: storeAddress,
    functionName: 'getBuyers',
    args: [BigInt(item.id), BigInt(buyersPage * BUYERS_PAGE_SIZE), BigInt(BUYERS_PAGE_SIZE)],
    chainId,
    query: { enabled: Boolean(storeAddress && hasListing) },
  })

  // Memoized (not `?? []`) — an inline fallback array is a new reference every render, which
  // would make any effect depending on these fire on every render (and previously caused an
  // infinite update loop via the buyer-breakdown effect below).
  const pageBuyers = useMemo(() => buyersPageData?.[0] ?? [], [buyersPageData])
  const pageBuyerAmounts = useMemo(() => buyersPageData?.[1] ?? [], [buyersPageData])
  const totalBuyers = buyersPageData ? Number(buyersPageData[2]) : 0
  const totalBuyerPages = Math.max(1, Math.ceil(totalBuyers / BUYERS_PAGE_SIZE))

  // Every distinct payment token this listing has ever been bought under. If it's 1 (the common
  // case — a listing that's never changed currency), every buyer necessarily purchased in that
  // one token, so the per-token breakdown fetch below is skipped entirely as unnecessary.
  const { data: tokensUsedData, refetch: refetchTokensUsed } = useReadContract({
    abi: storeAbi,
    address: storeAddress,
    functionName: 'getTokensUsed',
    args: [BigInt(item.id)],
    chainId,
    query: { enabled: Boolean(storeAddress && hasListing) },
  })
  const tokensUsed = useMemo(() => tokensUsedData ?? [], [tokensUsedData])

  const [buyerBreakdowns, setBuyerBreakdowns] = useState({})
  const [tokenSymbols, setTokenSymbols] = useState({})

  // Only fetch a per-token breakdown when a listing has actually changed payment tokens at some
  // point — otherwise amountPurchased already fully describes each buyer (single known currency).
  useEffect(() => {
    setBuyerBreakdowns({})
    if (!storeAddress || !publicClient || tokensUsed.length < 2 || pageBuyers.length === 0) return
    let cancelled = false

    const loadBreakdowns = async () => {
      const symbolEntries = await Promise.all(
        tokensUsed.map(async (token) => {
          if (token.toLowerCase() === zeroAddress) return [token, currencySymbol]
          try {
            const symbol = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' })
            return [token, symbol]
          } catch {
            return [token, `${token.slice(0, 6)}…${token.slice(-4)}`]
          }
        }),
      )
      if (cancelled) return
      setTokenSymbols((prev) => ({ ...prev, ...Object.fromEntries(symbolEntries) }))

      const entries = await Promise.all(
        pageBuyers.map(async (buyer) => {
          const perToken = await Promise.all(
            tokensUsed.map(async (token) => {
              const amount = await publicClient.readContract({
                abi: storeAbi,
                address: storeAddress,
                functionName: 'buyerAmountByToken',
                args: [BigInt(item.id), buyer, token],
              })
              return { token, amount }
            }),
          )
          return [buyer, perToken.filter((entry) => entry.amount > 0n)]
        }),
      )
      if (!cancelled) setBuyerBreakdowns(Object.fromEntries(entries))
    }

    loadBreakdowns()
    return () => {
      cancelled = true
    }
  }, [storeAddress, publicClient, pageBuyers, tokensUsed, item.id, currencySymbol])

  // The dialog stays mounted while closed, so its reads go stale between opens (e.g. a
  // purchase made from the post's BuyButton elsewhere on the page). Refetch on every open
  // instead of relying on remount.
  useImperativeHandle(ref, () => ({
    open: () => {
      refetchListing()
      refetchBuyers()
      refetchTokensUsed()
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })

  const isBusy = isPending || isConfirming || isUploadingContent || isSubmittingBurner
  // Not-yet-listed posts go straight to the create form; existing listings show a summary
  // first and only reveal the (pre-filled) form once the seller explicitly chooses to edit.
  const showForm = !hasListing || isEditing

  // Prefill the form from the existing listing once it loads
  useEffect(() => {
    if (!hasListing) return

    const token = listing.paymentToken
    if (!token || token.toLowerCase() === zeroAddress) {
      setPaymentChoice('native')
      setPrice(formatEther(listing.price))
    } else {
      const usdcAddress = USDC[chainId]?.address
      if (usdcAddress && token.toLowerCase() === usdcAddress.toLowerCase()) {
        setPaymentChoice('usdc')
      } else {
        setPaymentChoice(listing.isLsp7 ? 'custom-lsp7' : 'custom-erc20')
        setCustomToken(token)
      }
      publicClient
        ?.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' })
        .then((decimals) => setPrice(formatUnits(listing.price, decimals)))
        .catch(() => setPrice(''))
    }

    setQuantity(listing.quantity.toString())
    setVaultAddress(listing.vault && listing.vault.toLowerCase() !== zeroAddress ? listing.vault : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasListing, listing])

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    toast('Listing updated', 'success')
    refetchListing()
    refetchBuyers()
    refetchTokensUsed()
    setIsEditing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  // Pulls the seller's own existing gated content into the form (decrypt allows the seller
  // through without a purchase) so editing continues from what's already there instead of
  // forcing a rewrite from scratch. New files/text can still be added on top before saving.
  const loadExistingContent = async () => {
    if (!listing?.metadata) return
    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }

    setIsLoadingContent(true)
    try {
      const timestamp = Date.now()
      const message = `Reveal gated content for post ${item.id}\nTimestamp: ${timestamp}`
      const signature = await signMessageAsync({ message })

      const res = await fetch('/api/store/decrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: item.id,
          chainId: item.network_id,
          cid: listing.metadata,
          message,
          signature,
          ...(isLukso && { up_address: address }),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load existing content')
      }

      const envelope = await res.json()
      const { name, description, links, files } = normalizeEnvelope(envelope)

      if (name) setContentName(name)
      if (description) setContentDescription(description)
      if (links.length > 0) setContentLinks((prev) => [...prev, ...links])
      if (files.length > 0) {
        setContentFiles((prev) => [...prev, ...files.map((f) => base64ToFile(f.dataBase64, f.filename, f.mimeType))])
      }
    } catch (err) {
      toast(err.message || 'Failed to load existing content', 'error')
    } finally {
      setIsLoadingContent(false)
    }
  }

  const handleEdit = () => {
    setIsEditing(true)
  }

  const hasContentToUpload = () =>
    Boolean(contentName.trim() || contentDescription.trim() || contentLinks.length > 0 || contentFiles.length > 0)

  const uploadGatedContent = async () => {
    if (!hasContentToUpload()) return null

    // Drop rows the seller added but never filled in; flag ones that are only half-filled
    const links = contentLinks.filter((l) => l.name.trim() || l.url.trim())
    const incomplete = links.find((l) => !l.name.trim() || !l.url.trim())
    if (incomplete) throw new Error('Every link needs both a name and a URL')

    const form = new FormData()
    form.append('postId', String(item.id))
    form.append('networkId', String(item.network_id))
    if (contentName.trim()) form.append('name', contentName.trim())
    if (contentDescription.trim()) form.append('description', contentDescription.trim())
    if (links.length > 0) form.append('links', JSON.stringify(links.map((l) => ({ name: l.name.trim(), url: l.url.trim() }))))
    for (const file of contentFiles) form.append('files', file)

    const res = await fetch('/api/store/encrypt', { method: 'POST', body: form })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to encrypt gated content')
    }
    const { cid } = await res.json()
    return cid
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (!storeAddress) {
      toast("The store contract isn't available on this network yet", 'error')
      return
    }

    // Resolve the payment token and its standard for this listing
    let paymentToken = zeroAddress
    let isLsp7 = false
    if (paymentChoice === 'usdc') {
      const usdcConfig = USDC[chainId]
      if (!usdcConfig?.address) {
        toast('USDC is not configured on this network', 'error')
        return
      }
      paymentToken = usdcConfig.address
      isLsp7 = Boolean(usdcConfig.lsp7)
    } else if (paymentChoice === 'custom-erc20' || paymentChoice === 'custom-lsp7') {
      if (!isAddress(customToken)) {
        toast('Enter a valid token address', 'error')
        return
      }
      paymentToken = customToken
      isLsp7 = paymentChoice === 'custom-lsp7'
    }

    // Parse the price in the payment token's own decimals
    let priceWei
    try {
      if (paymentToken === zeroAddress) {
        priceWei = parseEther(price || '0')
      } else {
        const decimals = await publicClient.readContract({ address: paymentToken, abi: erc20Abi, functionName: 'decimals' })
        priceWei = parseUnits(price || '0', decimals)
      }
    } catch {
      toast('Enter a valid price', 'error')
      return
    }
    const quantityInt = BigInt(quantity || '0')

    if (priceWei <= 0n) {
      toast('Enter a price greater than 0', 'error')
      return
    }
    if (quantityInt <= 0n) {
      toast('Enter a quantity greater than 0', 'error')
      return
    }

    // Optional payout vault — proceeds go to the seller's wallet when left empty
    if (vaultAddress.input.trim() && !vaultAddress.address) {
      toast('Enter a valid payout wallet address', 'error')
      return
    }
    const vault = vaultAddress.address || zeroAddress

    // Keep the existing gated content pointer unless the seller uploaded something new
    let metadata = listing?.metadata || ''
    setIsUploadingContent(true)
    try {
      const uploadedCid = await uploadGatedContent()
      if (uploadedCid) metadata = uploadedCid
    } catch (err) {
      toast(err.message || 'Failed to upload gated content', 'error')
      setIsUploadingContent(false)
      return
    }
    setIsUploadingContent(false)

    // Route through the burner session key if one's active, mirroring Like.jsx's pattern —
    // skips the wallet popup. writeWithBurnerSession awaits its own confirmation, so the
    // success side effects that the isConfirmed effect runs for the wagmi path are replayed
    // manually here before returning.
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsSubmittingBurner(true)
      try {
        if (hasListing) {
          await writeWithBurnerSession({
            chain: chainInfo,
            contractAddress: storeAddress,
            abi: storeAbi,
            functionName: 'updateListing',
            args: [address, BigInt(item.id), priceWei, quantityInt, true, paymentToken, isLsp7, vault, metadata],
          })
        } else {
          await writeWithBurnerSession({
            chain: chainInfo,
            contractAddress: storeAddress,
            abi: storeAbi,
            functionName: 'listItem',
            args: [address, BigInt(item.id), priceWei, quantityInt, paymentToken, isLsp7, vault, metadata, { value: listingFeeValue ?? 0n }],
          })
        }

        toast('Listing updated', 'success')
        refetchListing()
        refetchBuyers()
        refetchTokensUsed()
        setIsEditing(false)
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsSubmittingBurner(false)
      }
      return
    }

    if (hasListing) {
      writeContract({
        abi: storeAbi,
        address: storeAddress,
        functionName: 'updateListing',
        args: [address, BigInt(item.id), priceWei, quantityInt, true, paymentToken, isLsp7, vault, metadata],
        chainId,
      })
    } else {
      writeContract({
        abi: storeAbi,
        address: storeAddress,
        functionName: 'listItem',
        args: [address, BigInt(item.id), priceWei, quantityInt, paymentToken, isLsp7, vault, metadata],
        value: listingFeeValue ?? 0n,
        chainId,
      })
    }
  }

  const handleCancel = async (e) => {
    e.stopPropagation()
    if (!storeAddress || !address) return

    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsSubmittingBurner(true)
      try {
        await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: storeAddress,
          abi: storeAbi,
          functionName: 'cancelListing',
          args: [address, BigInt(item.id)],
        })

        toast('Listing updated', 'success')
        refetchListing()
        refetchBuyers()
        refetchTokensUsed()
        setIsEditing(false)
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsSubmittingBurner(false)
      }
      return
    }

    writeContract({
      abi: storeAbi,
      address: storeAddress,
      functionName: 'cancelListing',
      args: [address, BigInt(item.id)],
      chainId,
    })
  }

  const priceUnitLabel = paymentChoice === 'native' ? currencySymbol : paymentChoice === 'usdc' ? 'USDC' : 'token units'
  const typedPrice = Number(price) || 0
  const buyFeeBpsNum = buyFeeBpsValue ? Number(buyFeeBpsValue) : 0
  const buyFeeAmount = (typedPrice * buyFeeBpsNum) / FEE_DENOMINATOR
  const sellerReceives = typedPrice - buyFeeAmount
  const feeAmountFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 })

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.sellDialog}
      aria-label={hasListing ? 'Manage listing' : 'Sell this post'}
      onClick={(e) => e.stopPropagation()}
      onCancel={(e) => {
        // Esc must not discard the form while uploads or the transaction are in flight
        if (isBusy) e.preventDefault()
      }}
    >
        <div className={styles.sellPopover}>
          <header>
            <h3>{hasListing ? 'Manage listing' : 'Sell this post'}</h3>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.closeButton}>
              <XIcon size={18} />
            </button>
          </header>

          <div className={styles.connectedNetwork}>
            <NetworkSelect />
          </div>

          {isWrongChain && (
            <div className={styles.chainWarning}>
              <WarningIcon size={14} />
              <span>
                This post is on {chainInfo?.name || targetChain?.name || 'a different network'} — switch your wallet&apos;s network to{' '}
                {hasListing ? 'manage' : 'list'} this item.
              </span>
              <button
                type="button"
                onClick={() => switchChain.mutate({ chainId })}
                disabled={switchChain.isPending}
                className={styles.switchChainButton}
              >
                {switchChain.isPending ? 'Switching...' : 'Switch'}
              </button>
            </div>
          )}

          {!storeAddress && <p className={styles.notice}>The store contract isn&apos;t available on this network yet.</p>}

          {!showForm && (
            <div className={styles.summary}>
              <div className={styles.summaryRow}>
                <span>Network</span>
                <strong>{chainInfo?.name || targetChain?.name || 'Unknown'}</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>Price</span>
                <strong>
                  {price} {paymentChoice === 'native' ? currencySymbol : paymentChoice === 'usdc' ? 'USDC' : 'token units'}
                </strong>
              </div>
              <div className={styles.summaryRow}>
                <span>Quantity</span>
                <strong>{quantity}</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>Status</span>
                <strong>{listing.isActive ? 'Active' : 'Inactive'}</strong>
              </div>
              {vaultAddress.address && (
                <div className={styles.summaryRow}>
                  <span>Payout wallet</span>
                  <strong>
                    {vaultAddress.profile?.name ||
                      `${vaultAddress.address.slice(0, 6)}…${vaultAddress.address.slice(-4)}`}
                  </strong>
                </div>
              )}

              <div className={styles.actions}>
                <button type="button" onClick={handleEdit} disabled={isLoadingContent} className={styles.loadContentButton}>
                  {isLoadingContent ? 'Loading...' : 'Edit'}
                </button>
                {listing.isActive && (
                  <button type="button" onClick={handleCancel} disabled={isBusy || isWrongChain} className={styles.cancelButton}>
                    Cancel listing
                  </button>
                )}
              </div>
            </div>
          )}

          {showForm && (
            <form onSubmit={handleSubmit} className={styles.form}>
            <label>
              <span>Payment token</span>
              <select
                value={paymentChoice}
                onChange={(e) => setPaymentChoice(e.target.value)}
                disabled={isBusy || !storeAddress}
              >
                <option value="native">Native token ({currencySymbol})</option>
                {USDC[chainId]?.address && <option value="usdc">USDC</option>}
                <option value="custom-erc20">Custom ERC20</option>
                {isLukso && <option value="custom-lsp7">Custom LSP7</option>}
              </select>
            </label>

            {(paymentChoice === 'custom-erc20' || paymentChoice === 'custom-lsp7') && (
              <label>
                <span>Token address</span>
                <input
                  type="text"
                  placeholder="0x..."
                  value={customToken}
                  onChange={(e) => setCustomToken(e.target.value)}
                  disabled={isBusy || !storeAddress}
                  required
                />
              </label>
            )}

            <label>
              <span>
                Price ({paymentChoice === 'native' ? currencySymbol : paymentChoice === 'usdc' ? 'USDC' : 'token units'})
              </span>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={isBusy || !storeAddress}
                required
              />
            </label>

            <p className={styles.notice}>
              {typedPrice > 0
                ? buyFeeBpsNum > 0
                  ? `Buyer pays ${feeAmountFormat.format(typedPrice)} ${priceUnitLabel} — platform fee ${feeAmountFormat.format(buyFeeAmount)} ${priceUnitLabel} (${(buyFeeBpsNum / 100).toFixed(2)}%), you receive ${feeAmountFormat.format(sellerReceives)} ${priceUnitLabel}.`
                  : `No platform fee — you receive the full ${feeAmountFormat.format(typedPrice)} ${priceUnitLabel} per sale.`
                : buyFeeBpsNum > 0
                  ? `Platform fee: ${(buyFeeBpsNum / 100).toFixed(2)}% per sale.`
                  : 'No platform fee — you keep 100% of the price.'}
            </p>

            <label>
              <span>Quantity</span>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={isBusy || !storeAddress}
                required
              />
            </label>

            <RecipientField
              className={styles.payoutField}
              label="Payout wallet (optional) — sale proceeds go here instead of your wallet"
              value={vaultAddress}
              onChange={setVaultAddress}
              viewer={address ?? null}
              placeholder="Name, ENS, or 0x… (leave empty to receive funds yourself)"
              disabled={isBusy || !storeAddress}
            />

            <div className={styles.gatedContentBox}>
              <div className={styles.gatedContentHeader}>
                <LockIcon size={13} />
                <span>Encrypted — everything below is only revealed to buyers after purchase</span>
              </div>

              {hasListing && listing?.metadata && (
                <button
                  type="button"
                  onClick={loadExistingContent}
                  disabled={isLoadingContent || isBusy}
                  className={styles.loadContentButton}
                >
                  {isLoadingContent ? 'Loading...' : 'Load existing gated content'}
                </button>
              )}

              <label>
                <span>Gated content name (optional)</span>
                <input
                  type="text"
                  placeholder="e.g. Full tutorial pack"
                  value={contentName}
                  onChange={(e) => setContentName(e.target.value)}
                  disabled={isBusy || !storeAddress}
                />
              </label>

              <label>
                <span>Description (optional)</span>
                <textarea
                  placeholder="e.g. What's included, how to use it, anything buyers should know"
                  value={contentDescription}
                  onChange={(e) => setContentDescription(e.target.value)}
                  disabled={isBusy || !storeAddress}
                  rows={3}
                />
              </label>

              <div className={styles.linksEditor}>
                <span>Links (optional)</span>
                {contentLinks.map((link, i) => (
                  <div key={i} className={styles.linkRow}>
                    <input
                      type="text"
                      placeholder="Name"
                      value={link.name}
                      onChange={(e) =>
                        setContentLinks((prev) => prev.map((l, index) => (index === i ? { ...l, name: e.target.value } : l)))
                      }
                      disabled={isBusy || !storeAddress}
                    />
                    <input
                      type="text"
                      placeholder="https://..."
                      value={link.url}
                      onChange={(e) =>
                        setContentLinks((prev) => prev.map((l, index) => (index === i ? { ...l, url: e.target.value } : l)))
                      }
                      disabled={isBusy || !storeAddress}
                    />
                    <button
                      type="button"
                      onClick={() => setContentLinks((prev) => prev.filter((_, index) => index !== i))}
                      disabled={isBusy}
                      aria-label={`Remove link ${i + 1}`}
                    >
                      <XIcon size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={styles.addLinkButton}
                  onClick={() => setContentLinks((prev) => [...prev, { name: '', url: '' }])}
                  disabled={isBusy || !storeAddress || contentLinks.length >= MAX_LINKS}
                >
                  + Add link
                </button>
              </div>

              <div className={styles.filesEditor}>
                <span>
                  Files (optional) — up to {MAX_FILES}, max {MAX_FILE_SIZE_MB}MB each (for heavy videos, add a link instead)
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className={styles.hiddenFileInput}
                  onChange={(e) => {
                    const selected = Array.from(e.target.files || [])
                    e.target.value = ''
                    if (selected.length === 0) return

                    if (contentFiles.length + selected.length > MAX_FILES) {
                      toast(`You can attach at most ${MAX_FILES} files`, 'error')
                      return
                    }

                    const oversized = selected.find((f) => f.size > MAX_FILE_SIZE_MB * 1024 * 1024)
                    if (oversized) {
                      toast(`"${oversized.name}" is too large (max ${MAX_FILE_SIZE_MB}MB) — sell a link instead`, 'error')
                      return
                    }

                    const video = selected.find((f) => f.type.startsWith('video/'))
                    if (video) {
                      toast(`Video files aren't supported — paste a link to "${video.name}" instead of uploading it`, 'error')
                      return
                    }

                    setContentFiles((prev) => [...prev, ...selected])
                  }}
                  disabled={isBusy || !storeAddress || contentFiles.length >= MAX_FILES}
                />
                <button
                  type="button"
                  className={styles.addFileButton}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isBusy || !storeAddress || contentFiles.length >= MAX_FILES}
                >
                  <PlusIcon size={14} />
                  Add files
                </button>
              </div>

              {contentFiles.length > 0 && (
                <ul className={styles.fileList}>
                  {contentFiles.map((file, i) => (
                    <li key={`${file.name}-${i}`}>
                      <span>{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setContentFiles((prev) => prev.filter((_, index) => index !== i))}
                        disabled={isBusy}
                        aria-label={`Remove ${file.name}`}
                      >
                        <XIcon size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!hasListing && (
              <p className={styles.notice}>
                {listingFeeValue && listingFeeValue > 0n
                  ? `Listing fee: ${formatEther(listingFeeValue)} ${currencySymbol}`
                  : "No listing fee — it's free to list an item for sale."}
              </p>
            )}

            <div className={styles.actions}>
              <button type="submit" disabled={isBusy || !storeAddress || isWrongChain}>
                {isUploadingContent
                  ? 'Encrypting & uploading...'
                  : isBusy
                    ? 'Confirming...'
                    : hasListing
                      ? 'Update listing'
                      : 'List for sale'}
              </button>
              {hasListing && (
                <button type="button" onClick={() => setIsEditing(false)} disabled={isBusy} className={styles.cancelButton}>
                  Cancel edit
                </button>
              )}
            </div>
            </form>
          )}

          {hasListing && (
            <section className={styles.buyers}>
              <h4>Buyers</h4>
              {loadingPurchases && <p className={styles.muted}>Loading...</p>}
              {!loadingPurchases && totalBuyers === 0 && <p className={styles.muted}>No purchases yet.</p>}
              {!loadingPurchases && totalBuyers > 0 && (
                <>
                  <ul>
                    {pageBuyers.map((buyer, i) => {
                      const breakdown = buyerBreakdowns[buyer]
                      return (
                        <li key={`${buyer}-${i}`}>
                          <div className={styles.buyerProfile}>
                            <Profile creator={buyer} variant="fullWithoutTime" />
                          </div>
                          <span className={styles.buyerAmount}>
                            {pageBuyerAmounts[i]?.toString()} purchased
                            {breakdown && breakdown.length > 0
                              ? ` (${breakdown.map((entry) => `${entry.amount.toString()} ${tokenSymbols[entry.token] || 'tokens'}`).join(', ')})`
                              : ''}
                          </span>
                        </li>
                      )
                    })}
                  </ul>

                  {totalBuyerPages > 1 && (
                    <div className={styles.pagination}>
                      <button
                        type="button"
                        onClick={() => setBuyersPage((page) => Math.max(0, page - 1))}
                        disabled={buyersPage === 0}
                        aria-label="Previous page"
                      >
                        <CaretLeftIcon size={14} />
                      </button>
                      <span>
                        {buyersPage + 1} / {totalBuyerPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setBuyersPage((page) => Math.min(totalBuyerPages - 1, page + 1))}
                        disabled={buyersPage >= totalBuyerPages - 1}
                        aria-label="Next page"
                      >
                        <CaretRightIcon size={14} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </div>
    </NativeDialog>
  )
})

export default SellItemPopover
