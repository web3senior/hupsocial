'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { formatEther, parseEther, parseEventLogs, zeroAddress, zeroHash } from 'viem'
import { useConnection, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { hashIpfsContent, uploadFileToIPFS, uploadObjectToIPFS } from '@/lib/ipfs'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import {
import { networkColorStyle } from '@/lib/networkColors'
  DROP_GATES,
  DROP_SOCIALS,
  allowlistRoot,
  buildDropLinks,
  buildLsp4MetadataJson,
  dropStandardLabel,
  dropStandardsFor,
  encodeCollectionParams,
  encodeVerifiableURI,
  encodeVerifiableURIFromDigest,
  isLuksoChain,
  normalizeAllowlist,
} from '@/lib/drops'
import dropsAbi from '@/abis/HupDrops.json'
import { toast } from '@/components/NextToast'
import { CaretDownIcon, CheckCircleIcon, ImageIcon, LockSimpleIcon, LockSimpleOpenIcon, UsersIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import Tooltip from './ui/Tooltip'
import styles from './CreateDropDialog.module.scss'

const MAX_NAME_LENGTH = 48
const MAX_SYMBOL_LENGTH = 10
const MAX_DESCRIPTION_LENGTH = 280

// Bps presets, bounded by the collections' MAX_ROYALTY_BPS (1000) and well under the
// engine's MAX_REFERRAL_BPS (5000)
const ROYALTY_PRESETS = [0, 250, 500, 1000]
const REFERRAL_PRESETS = [0, 100, 500, 1000]

const percentFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const formatBps = (bps) => `${percentFormat.format(bps / 100)}%`

const dropRefFromLogs = (logs) => {
  try {
    const [created] = parseEventLogs({ abi: dropsAbi, logs: logs ?? [], eventName: 'DropCreated' })
    if (created?.args?.dropId === undefined) return null
    return {
      dropId: created.args.dropId.toString(),
      collection: created.args.collection,
      standardId: Number(created.args.standardId),
    }
  } catch {
    return null
  }
}

// A ticker is uppercase alphanumerics — strip as the user types rather than rejecting on submit
const normalizeSymbol = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_SYMBOL_LENGTH)

const normalizeIpfsUri = (value) => (value?.startsWith('ipfs://') ? value : `ipfs://${value}`)

// datetime-local values are wall-clock local time — exactly what a creator scheduling
// "Friday 6pm" means, so a plain Date parse is correct here
const toUnixSeconds = (value) => BigInt(Math.floor(new Date(value).getTime() / 1000))

/**
 * Create Drop Dialog
 * Launches an NFT drop through the HupDrops engine: deploys a creator-owned collection
 * (ERC721/ERC1155, or LSP7/LSP8 on LUKSO) and fixes its mint phase at creation. One phase in
 * this dialog — the engine supports up to eight, but one window with one gate covers the
 * composer's "drop an artwork to my followers" use, and phases are immutable so fewer knobs
 * means fewer irreversible mistakes.
 *
 * @param {Object} props
 * @param {number} props.fixedChainId The chain the drop lands on — pinned to the post's chain.
 * @param {string} [props.prefillImage] IPFS CID of the post's first image, offered as the artwork.
 * @param {string} [props.prefillDescription] Post text, seeding the collection description.
 * @param {boolean} [props.showSuccessStep] Show the "it's live" step with a link to the drop page.
 *        The composer skips it — there the drop is one part of publishing a post.
 * @param {Function} props.onCreated Receives the nftDrop content reference once the tx confirms:
 *        { dropId, chainId, collection, standardId, name, symbol, image, allowlistCid }.
 */
const CreateDropDialog = forwardRef(function CreateDropDialog(
  { fixedChainId, prefillImage = '', prefillDescription = '', showSuccessStep = false, onCreated },
  ref,
) {
  const dialogRef = useRef(null)
  const { address, chain: walletChain } = useConnection()

  const chainId = fixedChainId
  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === chainId), [chainId])
  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops
  const followerSystem = CONTRACTS[`chain${chainId}`]?.followerSystem
  const publicClient = usePublicClient({ chainId })
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'
  const standards = useMemo(() => dropStandardsFor(chainId ?? 0), [chainId])

  const [step, setStep] = useState('form')
  const [image, setImage] = useState(prefillImage)
  const [imageName, setImageName] = useState('')
  const [showBranding, setShowBranding] = useState(false)
  const [banner, setBanner] = useState('')
  const [isBannerUploading, setIsBannerUploading] = useState(false)
  const [socials, setSocials] = useState({ website: '', x: '', discord: '', telegram: '', instagram: '' })
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState(prefillDescription.slice(0, MAX_DESCRIPTION_LENGTH))
  const [shape, setShape] = useState('numbered')
  const [supply, setSupply] = useState('')
  const [price, setPrice] = useState('')
  const [perWallet, setPerWallet] = useState('')
  const [endAt, setEndAt] = useState('')
  // A phase created paused waits for the creator's Start rather than for its clock
  const [manualStart, setManualStart] = useState(false)
  const [gate, setGate] = useState(DROP_GATES.OPEN)
  const [allowlistText, setAllowlistText] = useState('')
  const [royaltyBps, setRoyaltyBps] = useState(0)
  const [referralBps, setReferralBps] = useState(0)
  const [created, setCreated] = useState(null)
  const [isImageUploading, setIsImageUploading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmittingBurner, setIsSubmittingBurner] = useState(false)

  // The composer may finish uploading the post's image after this dialog mounts
  useEffect(() => {
    if (prefillImage) setImage(prefillImage)
  }, [prefillImage])

  const { data: creationFee = 0n } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'creationFee',
    chainId,
    query: { enabled: Boolean(dropsAddress) },
  })
  const { data: mintFeeBps = 0n } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'mintFeeBps',
    chainId,
    query: { enabled: Boolean(dropsAddress) },
  })

  const standardId = shape === 'numbered' ? standards.numbered : standards.editions

  // Pre-flight: a standard with no registered deployer satellite reverts createDrop with
  // InvalidStandard — surface that before the wallet prompt, not as an opaque failed tx
  const { data: registeredDeployer } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'deployers',
    args: [BigInt(standardId)],
    chainId,
    query: { enabled: Boolean(dropsAddress) },
  })
  // null while unread — only a definite zero blocks, so a slow RPC never disables the button
  const standardReady = registeredDeployer ? registeredDeployer !== zeroAddress : null

  useImperativeHandle(ref, () => ({
    open: () => {
      setStep('form')
      setCreated(null)
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } = useWaitForTransactionReceipt({ hash })

  const isBusy = isPending || isConfirming || isUploading || isSubmittingBurner || isImageUploading || isBannerUploading

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  // The allowlist file CID rides along from submit time to the settle callback — the receipt
  // path can't re-derive it, so it lives in a ref rather than the tx result
  const allowlistCidRef = useRef('')

  const settle = (dropRef) => {
    toast(`${name.trim() || 'Your drop'} is live`, 'success')
    const payload = dropRef
      ? {
          ...dropRef,
          chainId,
          name: name.trim(),
          symbol,
          image,
          allowlistCid: allowlistCidRef.current || undefined,
        }
      : undefined

    if (showSuccessStep && payload) {
      setCreated(payload)
      setStep('live')
    } else {
      dialogRef.current?.close()
    }
    onCreated?.(payload)
  }

  useEffect(() => {
    if (!isConfirmed) return
    settle(dropRefFromLogs(receipt?.logs))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const handleImageSelect = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file', 'error')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('Image must be under 10 MB', 'error')
      return
    }

    setIsImageUploading(true)
    try {
      const cid = await uploadFileToIPFS(file)
      if (!cid) throw new Error('Upload failed')
      setImage(cid)
      setImageName(file.name)
    } catch (err) {
      toast(err.message || 'Image upload failed. Please try again.', 'error')
    } finally {
      setIsImageUploading(false)
    }
  }

  const handleBannerSelect = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file', 'error')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('Banner must be under 10 MB', 'error')
      return
    }

    setIsBannerUploading(true)
    try {
      const cid = await uploadFileToIPFS(file)
      if (!cid) throw new Error('Upload failed')
      setBanner(cid)
    } catch (err) {
      toast(err.message || 'Banner upload failed. Please try again.', 'error')
    } finally {
      setIsBannerUploading(false)
    }
  }

  const allowlist = useMemo(
    () => (gate === DROP_GATES.ALLOWLIST ? normalizeAllowlist(allowlistText.split(/[\s,;]+/)) : []),
    [gate, allowlistText],
  )

  const supplyCount = supply.trim() === '' ? 0 : Number(supply)
  const isOpenEdition = supplyCount === 0

  const canReview = Boolean(image && name.trim() && symbol && !isBusy && (gate !== DROP_GATES.ALLOWLIST || allowlist.length > 0))

  const handleReview = (event) => {
    event.preventDefault()
    if (!image || !name.trim() || !symbol) {
      toast('Artwork, name, and symbol are all required', 'error')
      return
    }
    if (gate === DROP_GATES.ALLOWLIST && allowlist.length === 0) {
      toast('Paste at least one valid address for the allowlist', 'error')
      return
    }
    if (endAt && toUnixSeconds(endAt) <= BigInt(Math.floor(Date.now() / 1000))) {
      toast('The end time must be in the future', 'error')
      return
    }
    setStep('review')
  }

  const handleCreate = async () => {
    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (!dropsAddress) {
      toast("NFT drops aren't available on this network yet", 'error')
      return
    }
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }
    if (standardReady === false) {
      toast(`${dropStandardLabel(standardId)} drops aren't enabled on this network yet`, 'error')
      return
    }

    setIsUploading(true)
    let metadataUri
    let metadataHash = null
    let gateData = zeroHash
    allowlistCidRef.current = ''
    try {
      // LUKSO collections speak LSP4; everything else gets standard ERC721/1155 JSON with
      // OpenSea's contract-level banner/external_link fields
      const links = buildDropLinks(socials)
      const isLukso = isLuksoChain(chainId)
      const imageUri = normalizeIpfsUri(image)
      const bannerUri = banner ? normalizeIpfsUri(banner) : ''

      // LSP4 media entries are verifiable: each carries the keccak256 of the bytes its CID
      // serves. Only LUKSO metadata has a slot for them, so EVM chains skip the round trip.
      const [imageHash, backgroundImageHash] = isLukso
        ? await Promise.all([hashIpfsContent(imageUri), bannerUri ? hashIpfsContent(bannerUri) : null])
        : [null, null]

      const metadata = isLukso
        ? buildLsp4MetadataJson({
            name: name.trim(),
            description: description.trim(),
            imageUrl: imageUri,
            imageHash,
            backgroundImageUrl: bannerUri,
            backgroundImageHash,
            links,
          })
        : {
            name: name.trim(),
            symbol,
            description: description.trim(),
            image: imageUri,
            ...(bannerUri ? { banner_image: bannerUri } : {}),
            ...(socials.website.trim() ? { external_link: socials.website.trim() } : {}),
            links,
          }
      metadataUri = normalizeIpfsUri(await uploadObjectToIPFS(metadata))
      // The LSP4Metadata data key is itself a VerifiableURI — hashed over the JSON as the
      // gateway serves it, since the pinning service re-serializes what we posted
      if (isLukso) metadataHash = await hashIpfsContent(metadataUri)

      if (gate === DROP_GATES.ALLOWLIST) {
        gateData = allowlistRoot(allowlist)
        if (!gateData) throw new Error('Building the allowlist failed')
        // Published so DropCard can rebuild proofs client-side at mint time
        allowlistCidRef.current = await uploadObjectToIPFS({ addresses: allowlist })
      }
    } catch (err) {
      toast(err.message || 'Failed to upload drop details', 'error')
      setIsUploading(false)
      return
    }
    setIsUploading(false)

    // The numbered collections resolve tokenURI as baseURI + id + suffix; a '#' terminator
    // makes every id resolve to the single artwork's metadata (gateways ignore fragments).
    // Creators can setBaseURI later for a per-token reveal.
    const collectionParams = encodeCollectionParams(standardId, {
      name: name.trim(),
      symbol,
      baseURI: `${metadataUri}#`,
      uriSuffix: '',
      tokenURI: metadataUri,
      contractURI: metadataUri,
      lsp4MetadataValue: encodeVerifiableURIFromDigest(metadataUri, metadataHash),
      // The base URI stays unverified by design — one digest can't stand for every token's
      // metadata once a creator reveals per-token content
      baseURIValue: encodeVerifiableURI(`${metadataUri}#`),
      royaltyReceiver: address,
      royaltyBps,
    })

    const phase = {
      // A minute of slack so a lagging block timestamp can't briefly gate the drop "upcoming"
      startTime: BigInt(Math.floor(Date.now() / 1000) - 60),
      endTime: endAt ? toUnixSeconds(endAt) : 0n,
      paused: manualStart,
      price: parseEther(price || '0'),
      perWallet: BigInt(perWallet.trim() === '' ? 0 : perWallet),
      allocation: 0n,
      gate,
      gateAsset: zeroAddress,
      gateData,
      gateMin: 0n,
    }

    const args = [address, BigInt(standardId), collectionParams, BigInt(supplyCount), BigInt(referralBps), [phase]]
    // createDrop demands msg.value equal the creation fee exactly
    const value = creationFee

    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsSubmittingBurner(true)
      try {
        const tx = await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: dropsAddress,
          abi: dropsAbi,
          functionName: 'createDrop',
          args: [...args, { value }],
        })

        const burnerReceipt = await tx.wait().catch(() => null)
        settle(dropRefFromLogs(burnerReceipt?.logs))
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsSubmittingBurner(false)
      }
      return
    }

    writeContract({
      abi: dropsAbi,
      address: dropsAddress,
      functionName: 'createDrop',
      args,
      value,
      chainId,
    })
  }

  const imageUrl = image ? resolveStorageImageUrl(image) : null
  const priceNumber = price.trim() === '' ? 0 : Number(price)

  const gateOptions = [
    { id: DROP_GATES.OPEN, label: 'Open', icon: <LockSimpleOpenIcon size={13} /> },
    { id: DROP_GATES.ALLOWLIST, label: 'Allowlist', icon: <LockSimpleIcon size={13} /> },
    // The Followers gate asks the chain's LSP26 registry — only offered where one exists
    ...(followerSystem ? [{ id: DROP_GATES.FOLLOWERS, label: 'Followers', icon: <UsersIcon size={13} /> }] : []),
  ]

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.dropDialog}
      aria-label="Create an NFT drop"
      onClick={(e) => e.stopPropagation()}
      // Rendered inside the composer — React's synthetic close/cancel events propagate up the
      // tree, so both must stop here or closing this dialog closes its host too
      onClose={(e) => e.stopPropagation()}
      onCancel={(e) => e.stopPropagation()}
    >
      <header className={styles.dropDialog__header}>
        {step !== 'live' && (
          <button
            type="button"
            className={styles.dropDialog__cancel}
            onClick={() => (step === 'review' ? setStep('form') : dialogRef.current?.close())}
          >
            {step === 'review' ? 'Back' : 'Cancel'}
          </button>
        )}
        <h3>{step === 'review' ? 'Review' : step === 'live' ? 'Live' : 'NFT drop'}</h3>
      </header>

      {step === 'form' && (
        <form className={styles.dropDialog__body} onSubmit={handleReview}>
          <div className={styles.dropDialog__identity}>
            <label className={clsx(styles.dropDialog__image, imageUrl && styles['dropDialog__image--filled'])}>
              {imageUrl ? <img src={imageUrl} alt="" /> : <ImageIcon size={22} weight="light" />}
              <input type="file" accept="image/*" onChange={handleImageSelect} disabled={isBusy} hidden />
            </label>
            <div className={styles.dropDialog__imageHint}>
              {imageUrl ? (
                <>
                  <strong>{imageName || 'Drop artwork'}</strong>
                  <span className={styles.dropDialog__imageActions}>
                    <label>
                      Edit
                      <input type="file" accept="image/*" onChange={handleImageSelect} disabled={isBusy} hidden />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setImage('')
                        setImageName('')
                      }}
                      disabled={isBusy}
                    >
                      Delete
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <strong>Artwork {isImageUploading && <em>uploading…</em>}</strong>
                  <small>Every minted item carries this image. Pulled from your post if it has one.</small>
                </>
              )}
            </div>
          </div>

          <div className={styles.dropDialog__row}>
            <label className={styles.dropDialog__field}>
              <span>Collection name</span>
              <input
                type="text"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                placeholder="Untitled Drop"
                onChange={(e) => setName(e.target.value)}
                disabled={isBusy}
              />
            </label>
            <label className={styles.dropDialog__field}>
              <span>Symbol</span>
              <input
                type="text"
                value={symbol}
                placeholder="DROP"
                onChange={(e) => setSymbol(normalizeSymbol(e.target.value))}
                disabled={isBusy}
              />
            </label>
          </div>

          <label className={styles.dropDialog__field}>
            <span>
              Description
              <em className={styles.dropDialog__counter}>
                {description.length}/{MAX_DESCRIPTION_LENGTH}
              </em>
            </span>
            <textarea
              rows={2}
              value={description}
              maxLength={MAX_DESCRIPTION_LENGTH}
              placeholder="What is this drop?"
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBusy}
            />
          </label>

          <button
            type="button"
            className={styles.dropDialog__brandingToggle}
            onClick={() => setShowBranding((on) => !on)}
            aria-expanded={showBranding}
          >
            <CaretDownIcon size={13} className={clsx(showBranding && styles['dropDialog__caret--open'])} />
            Branding &amp; links <em>optional — banner, website, socials</em>
          </button>

          {showBranding && (
            <div className={styles.dropDialog__branding}>
              <label className={clsx(styles.dropDialog__banner, banner && styles['dropDialog__banner--filled'])}>
                {banner ? (
                  <img src={resolveStorageImageUrl(banner)} alt="" />
                ) : (
                  <span>
                    <ImageIcon size={18} weight="light" />
                    Upload banner {isBannerUploading && <em>uploading…</em>}
                  </span>
                )}
                <input type="file" accept="image/*" onChange={handleBannerSelect} disabled={isBusy} hidden />
              </label>
              <small className={styles.dropDialog__bannerHint}>Shown atop the drop page. Recommended 1600 × 640.</small>

              {DROP_SOCIALS.map(({ key, title, placeholder }) => (
                <label key={key} className={styles.dropDialog__field}>
                  <span>{title}</span>
                  <input
                    type="url"
                    value={socials[key]}
                    placeholder={placeholder}
                    onChange={(e) => setSocials((prev) => ({ ...prev, [key]: e.target.value }))}
                    disabled={isBusy}
                  />
                </label>
              ))}
            </div>
          )}

          <div className={styles.dropDialog__presets}>
            <span>Collection type</span>
            <div>
              <Tooltip
                content={`Every mint is its own numbered token — #1, #2, … #N of the artwork, each individually ownable and tradable. Deploys a ${dropStandardLabel(standards.numbered)} collection.`}
              >
                <button
                  type="button"
                  className={clsx(shape === 'numbered' && styles['dropDialog__preset--active'])}
                  onClick={() => setShape('numbered')}
                  disabled={isBusy}
                >
                  Unique numbered
                </button>
              </Tooltip>
              <Tooltip
                content={`Every mint is an identical copy of the artwork, like a print run — collectors hold a balance, not a serial number. Deploys a ${dropStandardLabel(standards.editions)} collection.`}
              >
                <button
                  type="button"
                  className={clsx(shape === 'editions' && styles['dropDialog__preset--active'])}
                  onClick={() => setShape('editions')}
                  disabled={isBusy}
                >
                  Identical editions
                </button>
              </Tooltip>
            </div>
          </div>

          <div className={styles.dropDialog__row}>
            <label className={styles.dropDialog__field}>
              <span>Supply</span>
              <input
                type="number"
                min="0"
                step="1"
                value={supply}
                placeholder="Open edition"
                onChange={(e) => setSupply(e.target.value)}
                disabled={isBusy}
              />
              <small>Empty or 0 = unlimited</small>
            </label>
            <label className={styles.dropDialog__field}>
              <span>Price ({nativeSymbol})</span>
              <input
                type="number"
                min="0"
                step="any"
                value={price}
                placeholder="Free"
                onChange={(e) => setPrice(e.target.value)}
                disabled={isBusy}
              />
              <small>Empty or 0 = free mint</small>
            </label>
          </div>

          <div className={styles.dropDialog__row}>
            <label className={styles.dropDialog__field}>
              <span>Per-wallet limit</span>
              <input
                type="number"
                min="0"
                step="1"
                value={perWallet}
                placeholder="Unlimited"
                onChange={(e) => setPerWallet(e.target.value)}
                disabled={isBusy}
              />
            </label>
            <label className={styles.dropDialog__field}>
              <span>Ends</span>
              <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} disabled={isBusy} />
              <small>Empty = open-ended</small>
            </label>
          </div>

          <div className={styles.dropDialog__presets}>
            <span>Minting opens</span>
            <div>
              <button
                type="button"
                className={clsx(!manualStart && styles['dropDialog__preset--active'])}
                onClick={() => setManualStart(false)}
                disabled={isBusy}
              >
                Immediately
              </button>
              <button
                type="button"
                className={clsx(manualStart && styles['dropDialog__preset--active'])}
                onClick={() => setManualStart(true)}
                disabled={isBusy}
              >
                When I start it
              </button>
            </div>
          </div>

          <div className={styles.dropDialog__presets}>
            <span>Who can mint</span>
            <div>
              {gateOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={clsx(gate === option.id && styles['dropDialog__preset--active'])}
                  onClick={() => setGate(option.id)}
                  disabled={isBusy}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {gate === DROP_GATES.ALLOWLIST && (
            <label className={styles.dropDialog__field}>
              <span>
                Allowlist
                <em className={styles.dropDialog__counter}>{allowlist.length} addresses</em>
              </span>
              <textarea
                rows={3}
                value={allowlistText}
                placeholder={'0xabc…\n0xdef…'}
                onChange={(e) => setAllowlistText(e.target.value)}
                disabled={isBusy}
              />
              <small>One address per line. The list is published so minters can prove membership.</small>
            </label>
          )}

          <div className={styles.dropDialog__presets}>
            <span>Royalty</span>
            <div>
              {ROYALTY_PRESETS.map((bps) => (
                <button
                  key={bps}
                  type="button"
                  className={clsx(royaltyBps === bps && styles['dropDialog__preset--active'])}
                  onClick={() => setRoyaltyBps(bps)}
                  disabled={isBusy}
                >
                  {formatBps(bps)}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.dropDialog__presets}>
            <span>Referral share</span>
            <div>
              {REFERRAL_PRESETS.map((bps) => (
                <button
                  key={bps}
                  type="button"
                  className={clsx(referralBps === bps && styles['dropDialog__preset--active'])}
                  onClick={() => setReferralBps(bps)}
                  disabled={isBusy}
                >
                  {formatBps(bps)}
                </button>
              ))}
            </div>
          </div>

          <button type="submit" className={styles.dropDialog__submit} disabled={!canReview}>
            Review
          </button>
        </form>
      )}

      {step === 'review' && (
        <div className={styles.dropDialog__body}>
          <div className={styles.dropDialog__preview}>
            {imageUrl && <img src={imageUrl} alt="" />}
            <div>
              <strong>{name.trim()}</strong>
              <span>{symbol}</span>
              {description.trim() && <p>{description.trim()}</p>}
            </div>
          </div>

          <dl className={styles.dropDialog__facts}>
            <div>
              <dt>Standard</dt>
              <dd>
                {dropStandardLabel(standardId)}
                <small>{shape === 'numbered' ? 'Unique numbered ids' : 'Editions of one artwork'}</small>
              </dd>
            </div>
            <div>
              <dt>Supply</dt>
              <dd>{isOpenEdition ? 'Open edition' : new Intl.NumberFormat('en').format(supplyCount)}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{priceNumber === 0 ? 'Free' : `${price} ${nativeSymbol}`}</dd>
            </div>
            <div>
              <dt>Who can mint</dt>
              <dd>{gateOptions.find((option) => option.id === gate)?.label ?? 'Open'}</dd>
            </div>
            {gate === DROP_GATES.ALLOWLIST && (
              <div>
                <dt>Allowlisted</dt>
                <dd>{allowlist.length} addresses</dd>
              </div>
            )}
            <div>
              <dt>Per wallet</dt>
              <dd>{perWallet.trim() === '' || Number(perWallet) === 0 ? 'Unlimited' : perWallet}</dd>
            </div>
            <div>
              <dt>Window</dt>
              <dd>
                {manualStart ? 'Opens when you press start' : 'Opens immediately'}
                <small>{endAt ? `until ${new Date(endAt).toLocaleString()}` : 'open-ended'}</small>
              </dd>
            </div>
            <div>
              <dt>Royalty</dt>
              <dd>{royaltyBps === 0 ? 'None' : `${formatBps(royaltyBps)} to you`}</dd>
            </div>
            <div>
              <dt>Referral share</dt>
              <dd>{referralBps === 0 ? 'None' : `${formatBps(referralBps)} of each paid mint`}</dd>
            </div>
            {Number(mintFeeBps) > 0 && (
              <div>
                <dt>Platform fee</dt>
                <dd>{formatBps(Number(mintFeeBps))} of each paid mint</dd>
              </div>
            )}
            {creationFee > 0n && (
              <div>
                <dt>Creation fee</dt>
                <dd>
                  {formatEther(creationFee)} {nativeSymbol}
                </dd>
              </div>
      style={networkColorStyle(chainInfo)}
            )}
          </dl>

          <p className={styles.dropDialog__note}>
            You own the collection contract from its first block. The mint phase is fixed forever once created — check the
            numbers above.
          </p>

          {standardReady === false && (
            <p className={styles.dropDialog__note}>
              {dropStandardLabel(standardId)} drops aren&rsquo;t enabled on this network yet — no deployer is registered for
              this standard.
            </p>
          )}

          <button
            type="button"
            className={styles.dropDialog__submit}
            onClick={handleCreate}
            disabled={isBusy || !address || standardReady === false}
          >
            <ImageIcon size={16} weight="fill" />
            {isBusy ? 'Creating…' : 'Create drop'}
          </button>
        </div>
      )}

      {step === 'live' && created && (
        <div className={clsx(styles.dropDialog__body, styles.dropDialog__done)}>
          <span className={styles.dropDialog__doneMark}>
            {imageUrl && <img src={imageUrl} alt="" />}
            <CheckCircleIcon size={26} weight="fill" />
          </span>
          <h4>{name.trim()} is live</h4>
          <p>Your collection is deployed and minting is open on your terms.</p>

          <Link
            href={`/drops/${chainId}/${created.dropId}`}
            className={styles.dropDialog__submit}
            onClick={() => dialogRef.current?.close()}
          >
            View drop
          </Link>
        </div>
      )}
    </NativeDialog>
  )
})

export default CreateDropDialog
