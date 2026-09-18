'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { erc20Abi, formatEther, formatUnits, isAddress, parseEther, parseUnits, zeroAddress } from 'viem'
import { lukso, celo, sepolia, base, monad, bsc, monadTestnet, arbitrumSepolia, somniaTestnet, unichainSepolia, optimismSepolia /* , baseSepolia */ } from 'wagmi/chains'
import { useChainId, useConnection, usePublicClient, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import { USDC } from '@/lib/tokens'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import sellAbi from '@/abis/HupSell.json'
import { toast } from '@/components/NextToast'
import { normalizeEnvelope } from '@/lib/gatedContent'
import { fetchIPFS } from '@/lib/ipfsGateways'
import { uploadObjectToIPFS } from '@/lib/ipfs'
import { resolveIdentity, generateContentKey, wrapContentKey, unwrapContentKey, encryptContent, decryptContent } from '@/lib/sellVault'
import { requestVaultUnlock } from '@/lib/vaultUnlockBus'
import { CaretLeftIcon, CaretRightIcon, LockIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import RecipientField from './ui/RecipientField'
import { EMPTY_RECIPIENT } from '@/lib/recipientSearch'
import Profile from './Profile'
import styles from './SellItemPopover.module.scss'

const MAX_FILE_SIZE_MB = 10
const MAX_FILES = 5
const MAX_LINKS = 5
const BUYERS_PAGE_SIZE = 5
const FEE_DENOMINATOR = 10_000 // matches HupSell.sol's FEE_DENOMINATOR constant (buyFeeBps is in basis points)
const CHAINS = [lukso, celo, sepolia, base, monad, bsc, monadTestnet, arbitrumSepolia, somniaTestnet, unichainSepolia, optimismSepolia /* , baseSepolia */]
const LUKSO_CHAIN_IDS = [42]

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

  const { address } = useConnection()
  // Reactive, unlike a render-time chain snapshot: read again after switchChainAsync resolves
  const walletChainId = useChainId()
  const { switchChainAsync } = useSwitchChain({ config })
  const chainId = Number(item.network_id)
  const publicClient = usePublicClient({ chainId })
  const targetChain = CONTRACTS[`chain${item.network_id}`]
  const sellAddress = targetChain?.sell
  const chainInfo = CHAINS.find((c) => c.id === chainId)
  const currencySymbol = chainInfo?.nativeCurrency?.symbol || 'native token'
  const isLukso = LUKSO_CHAIN_IDS.includes(chainId)

  /**
   * Puts the wallet on the post's chain. A listing is not a thing the seller picks a network
   * for — the post already lives on one, and the listing has to be written there. So there is
   * no network chooser in this dialog and no "wrong network" wall: every write just switches
   * first. Mirrors Like.jsx and SendNftModal.jsx.
   */
  const ensureWalletChain = async () => {
    if (walletChainId === chainId) return
    toast(`Switching to ${chainInfo?.name || 'the post network'}...`, 'info')
    await switchChainAsync({ chainId })
  }

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
    abi: sellAbi,
    address: sellAddress,
    functionName: 'getListing',
    args: [BigInt(item.id)],
    chainId,
    query: { enabled: Boolean(sellAddress) },
  })

  const hasListing = Boolean(listing && listing.seller && listing.seller.toLowerCase() !== zeroAddress)

  const { data: listingFeeValue } = useReadContract({
    abi: sellAbi,
    address: sellAddress,
    functionName: 'listingFee',
    chainId,
    query: { enabled: Boolean(sellAddress) },
  })

  const { data: buyFeeBpsValue } = useReadContract({
    abi: sellAbi,
    address: sellAddress,
    functionName: 'buyFeeBps',
    chainId,
    query: { enabled: Boolean(sellAddress) },
  })

  // Paginated, on-chain buyer list — bounded per call by MAX_BUYERS_BATCH_READ_COUNT on the
  // contract, so this never risks the unbounded-gas full-history log scan the old version did.
  const {
    data: buyersPageData,
    isLoading: loadingPurchases,
    refetch: refetchBuyers,
  } = useReadContract({
    abi: sellAbi,
    address: sellAddress,
    functionName: 'getBuyers',
    args: [BigInt(item.id), BigInt(buyersPage * BUYERS_PAGE_SIZE), BigInt(BUYERS_PAGE_SIZE)],
    chainId,
    query: { enabled: Boolean(sellAddress && hasListing) },
  })

  // Memoized (not `?? []`) — an inline fallback array is a new reference every render, which
  // would make any effect depending on these fire on every render (and previously caused an
  // infinite update loop in the per-token breakdown this replaced).
  const pageBuyers = useMemo(() => buyersPageData?.[0] ?? [], [buyersPageData])
  const pageGranted = useMemo(() => buyersPageData?.[1] ?? [], [buyersPageData])
  const pageRefunded = useMemo(() => buyersPageData?.[2] ?? [], [buyersPageData])
  const totalBuyers = buyersPageData ? Number(buyersPageData[3]) : 0
  const totalBuyerPages = Math.max(1, Math.ceil(totalBuyers / BUYERS_PAGE_SIZE))

  // The seller's grant queue: buyers who have paid and are still waiting for a key. Read as
  // addresses AND public keys in one call, so a batch grant needs no extra round trip per buyer.
  const {
    data: pendingData,
    isLoading: loadingPending,
    refetch: refetchPending,
  } = useReadContract({
    abi: sellAbi,
    address: sellAddress,
    functionName: 'getPendingGrants',
    args: [BigInt(item.id), 0n, BigInt(BUYERS_PAGE_SIZE)],
    chainId,
    query: { enabled: Boolean(sellAddress && hasListing) },
  })

  const pendingBuyers = useMemo(() => pendingData?.[0] ?? [], [pendingData])
  const pendingPubKeys = useMemo(() => pendingData?.[1] ?? [], [pendingData])
  const [isGranting, setIsGranting] = useState(false)

  /**
   * Releases keys to everyone currently waiting. Deliberately one button rather than a per-buyer
   * chore, because this is also the only way the seller gets paid: each of these buyers' escrow
   * settles in the same transaction that hands them their key.
   */
  const handleGrantPending = async () => {
    if (pendingBuyers.length === 0) return

    setIsGranting(true)
    try {
      await ensureWalletChain()

      let identity = await resolveIdentity()
      if (!identity) {
        await requestVaultUnlock({ reason: 'Releasing keys to your buyers' })
        identity = await resolveIdentity()
      }
      if (!identity) throw new Error('Your Security Vault is locked')

      // The seller's own envelope, written at listItem — the only copy of this content key
      const ownWrapped = await publicClient.readContract({
        abi: sellAbi,
        address: sellAddress,
        functionName: 'wrappedKeys',
        args: [BigInt(item.id), address],
      })
      if (!ownWrapped || ownWrapped === '0x') throw new Error('No content key found for this listing')

      const contentKey = unwrapContentKey(ownWrapped, identity.privKeyHex)
      const wrapped = pendingPubKeys.map((pubKey) => wrapContentKey(contentKey, pubKey))

      const hash = await writeContractAsync({
        abi: sellAbi,
        address: sellAddress,
        functionName: 'grantAccessBatch',
        args: [address, BigInt(item.id), pendingBuyers, wrapped],
        chainId,
      })

      toast(`Releasing ${pendingBuyers.length} key${pendingBuyers.length === 1 ? '' : 's'}`, 'success')
      await publicClient.waitForTransactionReceipt({ hash })
      refetchPending()
      refetchBuyers()
    } catch (err) {
      toast(err.shortMessage || err.message || 'Failed to release keys', 'error')
    } finally {
      setIsGranting(false)
    }
  }

  // The dialog stays mounted while closed, so its reads go stale between opens (e.g. a
  // purchase made from the post's BuyButton elsewhere on the page). Refetch on every open
  // instead of relying on remount.
  useImperativeHandle(ref, () => ({
    open: () => {
      refetchListing()
      refetchBuyers()
      refetchPending()
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  const { data: hash, isPending, mutate: writeContract, writeContractAsync, error: submitError } = useWriteContract()
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
    refetchPending()
    setIsEditing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  /**
   * Recovers the listing's content key from the seller's own onchain envelope. This is the one
   * copy that exists — nothing server-side holds it any more — so both editing and granting go
   * through here.
   */
  const recoverContentKey = async () => {
    let identity = await resolveIdentity()
    if (!identity) {
      await requestVaultUnlock({ reason: 'Opening your gated content' })
      identity = await resolveIdentity()
    }
    if (!identity) throw new Error('Your Security Vault is locked')

    const ownWrapped = await publicClient.readContract({
      abi: sellAbi,
      address: sellAddress,
      functionName: 'wrappedKeys',
      args: [BigInt(item.id), address],
    })
    if (!ownWrapped || ownWrapped === '0x') throw new Error('No content key found for this listing')

    return { contentKey: unwrapContentKey(ownWrapped, identity.privKeyHex), identity }
  }

  // Pulls the seller's own existing gated content back into the form, decrypted in the browser
  // against their vault identity, so editing continues from what is already there instead of
  // forcing a rewrite. New files/text can still be added on top before saving.
  const loadExistingContent = async () => {
    if (!listing?.contentURI) return
    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }

    setIsLoadingContent(true)
    try {
      const { contentKey } = await recoverContentKey()

      const res = await fetchIPFS(String(listing.contentURI).replace('ipfs://', ''))
      const blob = await res.json()
      const envelope = normalizeEnvelope(await decryptContent(contentKey, blob.iv, blob.ciphertext))

      const { name, description, links, files } = envelope
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

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1])
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
      reader.readAsDataURL(file)
    })

  /**
   * Encrypts the gated payload in the browser and uploads only ciphertext.
   *
   * An existing listing re-encrypts under the SAME key it was created with, recovered from chain.
   * That is not an optimisation: every buyer already holds that one key wrapped to them, so
   * issuing a new one would silently break every past sale. A new listing mints a fresh key and
   * returns it so the caller can wrap it to the seller themselves.
   */
  const uploadGatedContent = async (existingKey = null) => {
    if (!hasContentToUpload()) return null

    // Drop rows the seller added but never filled in; flag ones that are only half-filled
    const links = contentLinks.filter((l) => l.name.trim() || l.url.trim())
    const incomplete = links.find((l) => !l.name.trim() || !l.url.trim())
    if (incomplete) throw new Error('Every link needs both a name and a URL')

    const payload = {
      ...(contentName.trim() && { name: contentName.trim() }),
      ...(contentDescription.trim() && { description: contentDescription.trim() }),
      ...(links.length > 0 && { links: links.map((l) => ({ name: l.name.trim(), url: l.url.trim() })) }),
      ...(contentFiles.length > 0 && {
        files: await Promise.all(
          contentFiles.map(async (file) => ({
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            dataBase64: await fileToBase64(file),
          })),
        ),
      }),
    }

    const contentKey = existingKey ?? generateContentKey()
    const envelope = await encryptContent(contentKey, payload)

    // The upload route only ever sees ciphertext, which is the point: it pins bytes it cannot read
    const cid = await uploadObjectToIPFS(envelope)

    return { cid, contentKey }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (!sellAddress) {
      toast("The store contract isn't available on this network yet", 'error')
      return
    }

    try {
      await ensureWalletChain()
    } catch (err) {
      toast(err.shortMessage || err.message || 'Could not switch network', 'error')
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
    let contentURI = listing?.contentURI || ''
    let sellerWrappedKey = '0x'
    setIsUploadingContent(true)
    try {
      if (hasListing) {
        // An edit re-encrypts under the key this listing was created with, so every buyer who
        // already holds it keeps working. Only fetched when there is actually new content.
        if (hasContentToUpload()) {
          const { contentKey } = await recoverContentKey()
          const uploaded = await uploadGatedContent(contentKey)
          if (uploaded) contentURI = uploaded.cid
        }
      } else {
        if (!hasContentToUpload()) throw new Error('Add some content to sell before listing')

        let identity = await resolveIdentity()
        if (!identity) {
          await requestVaultUnlock({ reason: 'Creating the key for your gated content' })
          identity = await resolveIdentity()
        }
        if (!identity) throw new Error('Your Security Vault is locked')

        const uploaded = await uploadGatedContent()
        contentURI = uploaded.cid
        // The seller's own copy, and the only one that will exist — see HupSell.listItem
        sellerWrappedKey = wrapContentKey(uploaded.contentKey, identity.pubKeyHex)
      }
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
            contractAddress: sellAddress,
            abi: sellAbi,
            functionName: 'updateListing',
            args: [address, BigInt(item.id), priceWei, quantityInt, true, paymentToken, isLsp7, vault, contentURI],
          })
        } else {
          await writeWithBurnerSession({
            chain: chainInfo,
            contractAddress: sellAddress,
            abi: sellAbi,
            functionName: 'listItem',
            args: [address, BigInt(item.id), priceWei, quantityInt, paymentToken, isLsp7, vault, contentURI, sellerWrappedKey, { value: listingFeeValue ?? 0n }],
          })
        }

        toast('Listing updated', 'success')
        refetchListing()
        refetchBuyers()
        refetchPending()
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
        abi: sellAbi,
        address: sellAddress,
        functionName: 'updateListing',
        args: [address, BigInt(item.id), priceWei, quantityInt, true, paymentToken, isLsp7, vault, contentURI],
        chainId,
      })
    } else {
      writeContract({
        abi: sellAbi,
        address: sellAddress,
        functionName: 'listItem',
        args: [address, BigInt(item.id), priceWei, quantityInt, paymentToken, isLsp7, vault, contentURI, sellerWrappedKey],
        value: listingFeeValue ?? 0n,
        chainId,
      })
    }
  }

  const handleCancel = async (e) => {
    e.stopPropagation()
    if (!sellAddress || !address) return

    try {
      await ensureWalletChain()
    } catch (err) {
      toast(err.shortMessage || err.message || 'Could not switch network', 'error')
      return
    }

    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsSubmittingBurner(true)
      try {
        await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: sellAddress,
          abi: sellAbi,
          functionName: 'cancelListing',
          args: [address, BigInt(item.id)],
        })

        toast('Listing updated', 'success')
        refetchListing()
        refetchBuyers()
        refetchPending()
        setIsEditing(false)
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsSubmittingBurner(false)
      }
      return
    }

    writeContract({
      abi: sellAbi,
      address: sellAddress,
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

          {!sellAddress && <p className={styles.notice}>The store contract isn&apos;t available on this network yet.</p>}

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
                  <button type="button" onClick={handleCancel} disabled={isBusy} className={styles.cancelButton}>
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
                disabled={isBusy || !sellAddress}
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
                  disabled={isBusy || !sellAddress}
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
                disabled={isBusy || !sellAddress}
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
                disabled={isBusy || !sellAddress}
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
              disabled={isBusy || !sellAddress}
            />

            <div className={styles.gatedContentBox}>
              <div className={styles.gatedContentHeader}>
                <LockIcon size={13} />
                <span>Encrypted — everything below is only revealed to buyers after purchase</span>
              </div>

              {hasListing && listing?.contentURI && (
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
                  disabled={isBusy || !sellAddress}
                />
              </label>

              <label>
                <span>Description (optional)</span>
                <textarea
                  placeholder="e.g. What's included, how to use it, anything buyers should know"
                  value={contentDescription}
                  onChange={(e) => setContentDescription(e.target.value)}
                  disabled={isBusy || !sellAddress}
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
                      disabled={isBusy || !sellAddress}
                    />
                    <input
                      type="text"
                      placeholder="https://..."
                      value={link.url}
                      onChange={(e) =>
                        setContentLinks((prev) => prev.map((l, index) => (index === i ? { ...l, url: e.target.value } : l)))
                      }
                      disabled={isBusy || !sellAddress}
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
                  disabled={isBusy || !sellAddress || contentLinks.length >= MAX_LINKS}
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
                  disabled={isBusy || !sellAddress || contentFiles.length >= MAX_FILES}
                />
                <button
                  type="button"
                  className={styles.addFileButton}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isBusy || !sellAddress || contentFiles.length >= MAX_FILES}
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
              <button type="submit" disabled={isBusy || !sellAddress}>
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

          {hasListing && pendingBuyers.length > 0 && (
            <section className={styles.pendingGrants}>
              <h4>
                {pendingBuyers.length} buyer{pendingBuyers.length === 1 ? '' : 's'} waiting for a key
              </h4>
              <p className={styles.muted}>
                Their payment is held by the contract until you release it. Releasing the keys pays you in the same transaction.
              </p>
              <button type="button" onClick={handleGrantPending} disabled={isGranting} className={styles.submitButton}>
                {isGranting ? 'Releasing...' : `Release ${pendingBuyers.length} key${pendingBuyers.length === 1 ? '' : 's'}`}
              </button>
            </section>
          )}

          {hasListing && (
            <section className={styles.buyers}>
              <h4>Buyers</h4>
              {loadingPending && <p className={styles.muted}>Checking for pending keys...</p>}
              {loadingPurchases && <p className={styles.muted}>Loading...</p>}
              {!loadingPurchases && totalBuyers === 0 && <p className={styles.muted}>No purchases yet.</p>}
              {!loadingPurchases && totalBuyers > 0 && (
                <>
                  <ul>
                    {pageBuyers.map((buyer, i) => {
                      // Grant state is the only thing worth showing here now: quantity used to
                      // vary per buyer, but a key is wrapped to a person, so every buyer holds
                      // exactly one. What differs between them is whether they have it yet.
                      const state = pageRefunded[i] ? 'Refunded' : pageGranted[i] ? 'Key released' : 'Awaiting key'
                      return (
                        <li key={`${buyer}-${i}`}>
                          <div className={styles.buyerProfile}>
                            <Profile creator={buyer} variant="fullWithoutTime" />
                          </div>
                          <span className={styles.buyerAmount}>{state}</span>
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
