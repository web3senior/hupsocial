'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import clsx from 'clsx'
import { formatEther, isAddress, parseEther, toHex, zeroAddress, zeroHash } from 'viem'
import { useConnection, usePublicClient, useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { hashIpfsContent, uploadFileToIPFS, uploadFolderToIPFS, uploadObjectToIPFS, withAuthor } from '@/lib/ipfs'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { describeWalletError } from '@/lib/walletErrors'
import {
  ALLOWLIST_BATCH_SIZE,
  DROP_GATES,
  DROP_SOCIALS,
  MAX_DROP_PHASES,
  LSP4_DATA_KEYS,
  MAX_DROP_CREATORS,
  INTERFACEID_LSP0,
  creatorsElementKeyAt,
  encodeCreatorsWrites,
  LSP8_DATA_KEYS,
  buildDropLinks,
  buildLsp4MetadataJson,
  decodeVerifiableURI,
  encodeVerifiableURI,
  encodeVerifiableURIFromDigest,
  formatPhaseTime,
  gateLabel,
  isLuksoStandard,
  isNumberedStandard,
  normalizeAllowlist,
  parseDropLinks,
  phaseStatus,
  PHASE_STATUS,
} from '@/lib/drops'
import dropsAbi from '@/abis/HupDrops.json'
import collectionAbi from '@/abis/HupDropCollection.json'
import DropArtworkUpload from '@/components/DropArtworkUpload'
import { toast } from '@/components/NextToast'
import NativeDialog from '@/components/ui/NativeDialog'
import { ImageIcon, PencilSimpleIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import styles from './DropManagePanel.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })
const countFormat = new Intl.NumberFormat('en')
const dateTimeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' })

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

const formatNative = (wei) => amountFormat.format(Number(formatEther(BigInt(wei ?? 0))))

const normalizeIpfsUri = (value) => (value?.startsWith('ipfs://') ? value : `ipfs://${value}`)

// Reading the clock must stay out of render — only ever called from an event handler
const nowSeconds = () => BigInt(Math.floor(Date.now() / 1000))

const MAX_DESCRIPTION_LENGTH = 1000

/**
 * Creator-only control surface on the drop detail page: indexed revenue and activity, the phase
 * schedule, the collection metadata editor, and the permanent close switch. Renders nothing
 * unless the connected wallet is the drop's creator; every action is also enforced onchain.
 *
 * @param {Object} props.drop The live drop struct from getDrop.
 * @param {string} props.collection The drop's collection contract.
 * @param {Object} props.collectionIdentity Resolved { name, symbol, description, image, links }.
 */
export default function DropManagePanel({ chainId, dropId, drop, collection, collectionIdentity, onMetadataUpdated, onClosed }) {
  const { address, chain: walletChain } = useConnection()
  const publicClient = usePublicClient({ chainId })
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'
  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops
  const standardId = drop ? Number(drop.standardId) : undefined
  const isLukso = isLuksoStandard(standardId)
  const isWrongChain = Boolean(walletChain && walletChain.id !== chainId)

  const isCreator = Boolean(address && drop?.creator && address.toLowerCase() === drop.creator.toLowerCase())

  const editDialogRef = useRef(null)
  const [description, setDescription] = useState('')
  const [image, setImage] = useState('')
  const [icon, setIcon] = useState('')
  const [banner, setBanner] = useState('')
  const [socials, setSocials] = useState({ website: '', x: '', discord: '', telegram: '', instagram: '' })
  const [linkRows, setLinkRows] = useState([])
  const [isSavingMetadata, setIsSavingMetadata] = useState(false)
  const [isImageUploading, setIsImageUploading] = useState(false)
  const [isBannerUploading, setIsBannerUploading] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [phaseBusy, setPhaseBusy] = useState(null)
  const [allowlistDraft, setAllowlistDraft] = useState('')
  const [isSavingAllowlist, setIsSavingAllowlist] = useState(false)
  const [payoutDraft, setPayoutDraft] = useState('')
  const [isSavingPayout, setIsSavingPayout] = useState(false)
  const [newPhase, setNewPhase] = useState(null)
  const [isAddingPhase, setIsAddingPhase] = useState(false)
  const [creatorDraft, setCreatorDraft] = useState('')
  const [isSavingCreators, setIsSavingCreators] = useState(false)
  const [baseUriDraft, setBaseUriDraft] = useState('')
  const [suffixDraft, setSuffixDraft] = useState('')
  const [isSavingTokenUri, setIsSavingTokenUri] = useState(false)
  const [isPinningFolder, setIsPinningFolder] = useState(false)
  const [royaltyReceiverDraft, setRoyaltyReceiverDraft] = useState('')
  const [royaltyBpsDraft, setRoyaltyBpsDraft] = useState('')
  const [confirmFreeze, setConfirmFreeze] = useState(false)

  const { data: indexed } = useSWR(isCreator ? `/api/v1/drops/${dropId}?networkId=${chainId}` : null, fetcher, {
    refreshInterval: 30_000,
  })
  const totals = indexed?.data?.totals
  const mints = indexed?.data?.mints ?? []

  const { data: phases = [], refetch: refetchPhases } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'phasesOf',
    args: [BigInt(dropId)],
    chainId,
    query: { enabled: Boolean(dropsAddress && isCreator) },
  })

  // allowlistCount/allowlistOf are creator-gated onchain, so the eth_call carries the creator as `account`
  const hasAllowlistPhase = phases.some((phase) => Number(phase.gate) === DROP_GATES.ALLOWLIST)
  const allowlistRead = {
    abi: dropsAbi,
    address: dropsAddress,
    chainId,
    account: address,
    query: { enabled: Boolean(dropsAddress && isCreator && hasAllowlistPhase) },
  }
  const { data: allowlistTotal = 0n, refetch: refetchAllowlistCount } = useReadContract({
    ...allowlistRead,
    functionName: 'allowlistCount',
    args: [BigInt(dropId)],
  })
  const { data: allowlistEntries = [], refetch: refetchAllowlistPage } = useReadContract({
    ...allowlistRead,
    functionName: 'allowlistOf',
    args: [BigInt(dropId), 0n, 100n],
  })

  const { data: payoutDestination, refetch: refetchPayout } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'payoutDestination',
    args: [BigInt(dropId)],
    chainId,
    query: { enabled: Boolean(dropsAddress && isCreator) },
  })
  const payoutOverride = payoutDestination && payoutDestination !== zeroAddress ? payoutDestination : null

  // What the platform actually takes, read live rather than assumed: an admin can change either
  // knob while this panel is open, and a creator deciding where to point their payout deserves
  // the number the next mint will really use.
  const { data: feeReads } = useReadContracts({
    contracts: [
      { address: dropsAddress ?? undefined, abi: dropsAbi, functionName: 'mintFeeBps', chainId },
      { address: dropsAddress ?? undefined, abi: dropsAbi, functionName: 'mintFee', chainId },
      { address: dropsAddress ?? undefined, abi: dropsAbi, functionName: 'mintFeeEnabled', chainId },
    ],
    query: { enabled: Boolean(dropsAddress) },
  })
  const platformBps = Number(feeReads?.[0]?.result ?? 0n)
  const flatFee = feeReads?.[2]?.result === true ? (feeReads[1]?.result ?? 0n) : 0n
  const dropReferralBps = Number(drop?.referralBps ?? 0)
  // The three shares of a paid mint always total 100 — the flat fee is not in here, because it
  // rides on top of the price rather than coming out of it.
  const creatorBps = 10000 - platformBps - dropReferralBps

  /*
   * `Minted.feeAmount` carries the percentage cut and the flat per-item fee added together, so it
   * cannot be subtracted from the creator's gross as one figure: the percentage comes OUT of the
   * price, while the flat fee is charged ON TOP and was never the creator's to lose. Split them
   * back apart here — the percentage is recoverable from the live rate, and whatever remains is
   * the flat portion the minters paid separately.
   */
  const grossWei = BigInt(totals?.gross ?? 0)
  const feesWei = BigInt(totals?.fees ?? 0)
  const referralsWei = BigInt(totals?.referrals ?? 0)
  const percentageFeeWei = platformBps > 0 ? (grossWei * BigInt(platformBps)) / 10000n : 0n
  // Clamped: a rate changed mid-drop makes this an estimate, and a negative one would be a lie
  const flatFeeWei = feesWei > percentageFeeWei ? feesWei - percentageFeeWei : 0n
  const creatorNetWei = grossWei - percentageFeeWei - referralsWei
  // The whole amount that left minters' wallets: the price plus the flat fee charged on top
  const minterPaidWei = grossWei + flatFeeWei

  const { data: communitySystem } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'communitySystem',
    chainId,
    query: { enabled: Boolean(dropsAddress && isCreator) },
  })
  const hasCommunityGate = Boolean(communitySystem && communitySystem !== zeroAddress)
  const { data: communityList } = useSWR(
    hasCommunityGate && isCreator ? `/api/v1/networks/communities?network_id=${chainId}&limit=50` : null,
    fetcher,
  )
  const communities = communityList?.data ?? []

  const creatorsRead = { abi: collectionAbi, address: collection ?? undefined, chainId, query: { enabled: Boolean(collection && isCreator && isLukso) } }
  const { data: creatorsCountRaw, refetch: refetchCreatorsCount } = useReadContract({
    ...creatorsRead,
    functionName: 'getData',
    args: [LSP4_DATA_KEYS.creators],
  })
  const creatorsCount = creatorsCountRaw && creatorsCountRaw !== '0x' ? Number(BigInt(creatorsCountRaw)) : 0
  const { data: creatorEntries, refetch: refetchCreatorEntries } = useReadContracts({
    contracts: Array.from({ length: Math.min(creatorsCount, MAX_DROP_CREATORS) }, (_, index) => ({
      ...creatorsRead,
      functionName: 'getData',
      args: [creatorsElementKeyAt(index)],
    })),
    query: { enabled: Boolean(collection && isCreator && isLukso && creatorsCount > 0) },
  })
  // getData returns raw bytes; a creator entry is a bare 20-byte address
  const creators = (creatorEntries ?? [])
    .map((entry) => entry?.result)
    .filter((value) => typeof value === 'string' && value.length === 42)

  const collectionRead = { abi: collectionAbi, address: collection ?? undefined, chainId, query: { enabled: Boolean(collection && isCreator) } }
  const { data: metadataFrozen = false, refetch: refetchFrozen } = useReadContract({ ...collectionRead, functionName: 'metadataFrozen' })

  const isNumbered = isNumberedStandard(standardId)

  const { data: tokenOneUri, refetch: refetchTokenUri } = useReadContract({
    ...collectionRead,
    functionName: 'tokenURI',
    args: [1n],
    query: { enabled: Boolean(collection && isCreator && isNumbered && !isLukso) },
  })
  const { data: lsp8BaseUriRaw, refetch: refetchLsp8BaseUri } = useReadContract({
    ...collectionRead,
    functionName: 'getData',
    args: [LSP8_DATA_KEYS.baseUri],
    query: { enabled: Boolean(collection && isCreator && isNumbered && isLukso) },
  })
  const currentTokenUri = isLukso ? decodeVerifiableURI(lsp8BaseUriRaw) : tokenOneUri || ''
  const { data: royaltyReceiver, refetch: refetchRoyaltyReceiver } = useReadContract({ ...collectionRead, functionName: 'royaltyReceiver' })
  const { data: royaltyBps = 0n, refetch: refetchRoyaltyBps } = useReadContract({ ...collectionRead, functionName: 'royaltyBps' })

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  // Own instances for the sequential awaits — sharing `hash` would re-fire the pendingActionRef effect
  const { writeContractAsync: writeAllowlistAsync } = useWriteContract()
  const { writeContractAsync: writeCollectionAsync } = useWriteContract()
  const pendingActionRef = useRef(null)
  const isBusy =
    isPending ||
    isConfirming ||
    isSavingMetadata ||
    isClosing ||
    isImageUploading ||
    isBannerUploading ||
    phaseBusy !== null ||
    isAddingPhase ||
    isSavingAllowlist ||
    isSavingCreators ||
    isSavingPayout ||
    isSavingTokenUri ||
    isPinningFolder

  useEffect(() => {
    if (!submitError) return
    toast(describeWalletError(submitError, { fallback: 'Transaction rejected' }), 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed || !pendingActionRef.current) return
    const action = pendingActionRef.current
    pendingActionRef.current = null

    if (action === 'metadata') {
      toast('Collection metadata updated', 'success')
      editDialogRef.current?.close()
      setTimeout(() => onMetadataUpdated?.(), 1500)
    }
    if (action === 'close') {
      toast('Drop closed — minting has ended for good', 'success')
      setConfirmClose(false)
      onClosed?.()
    }
    if (action === 'phase') {
      toast('Stage updated', 'success')
      setPhaseBusy(null)
      refetchPhases()
    }
    if (action === 'royalty') {
      toast('Royalty updated', 'success')
      refetchRoyaltyReceiver()
      refetchRoyaltyBps()
    }
    if (action === 'freeze') {
      toast('Metadata frozen forever', 'success')
      setConfirmFreeze(false)
      refetchFrozen()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  useEffect(() => {
    if (royaltyReceiver === undefined) return
    setRoyaltyReceiverDraft((prev) => prev || (royaltyReceiver !== zeroAddress ? royaltyReceiver : ''))
    setRoyaltyBpsDraft((prev) => (prev === '' ? String(Number(royaltyBps) / 100) : prev))
  }, [royaltyReceiver, royaltyBps])

  if (!isCreator) return null

  const openEditor = () => {
    setDescription(collectionIdentity?.description ?? '')
    setImage(collectionIdentity?.image ?? '')
    setIcon(collectionIdentity?.icon ?? '')
    setBanner(collectionIdentity?.banner ?? '')
    const { socials: storedSocials, extra } = parseDropLinks(collectionIdentity?.links ?? [])
    setSocials(storedSocials)
    setLinkRows(extra)
    editDialogRef.current?.open()
  }

  /** Uploads a collection image (artwork, icon, or banner) to IPFS and stores its CID. */
  const handleImageUpload = (setter, label, setBusy) => async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file', 'error')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast(`${label} must be under 10 MB`, 'error')
      return
    }

    setBusy(true)
    try {
      const cid = await uploadFileToIPFS(file)
      if (!cid) throw new Error('Upload failed')
      setter(cid)
    } catch (err) {
      toast(err.message || `${label} upload failed. Please try again.`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleImageSelect = handleImageUpload(setImage, 'Image', setIsImageUploading)
  const handleIconSelect = handleImageUpload(setIcon, 'Icon', setIsImageUploading)
  const handleBannerSelect = handleImageUpload(setBanner, 'Banner', setIsBannerUploading)

  const handleSaveMetadata = async () => {
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    const links = buildDropLinks(socials, linkRows)

    setIsSavingMetadata(true)
    let uri
    let metadataHash = null
    try {
      const imageUri = image ? normalizeIpfsUri(image) : ''
      const iconUri = icon ? normalizeIpfsUri(icon) : ''
      const bannerUri = banner ? normalizeIpfsUri(banner) : ''

      const [imageHash, iconHash, backgroundImageHash] = isLukso
        ? await Promise.all([
            imageUri ? hashIpfsContent(imageUri) : null,
            iconUri ? hashIpfsContent(iconUri) : null,
            bannerUri ? hashIpfsContent(bannerUri) : null,
          ])
        : [null, null, null]

      const metadata = withAuthor(
        isLukso
          ? buildLsp4MetadataJson({
              name: collectionIdentity?.name ?? '',
              description: description.trim(),
              imageUrl: imageUri,
              imageHash,
              iconUrl: iconUri,
              iconHash,
              backgroundImageUrl: bannerUri,
              backgroundImageHash,
              links,
            })
          : {
              name: collectionIdentity?.name ?? '',
              symbol: collectionIdentity?.symbol ?? '',
              description: description.trim(),
              image: imageUri,
              ...(iconUri ? { icon: iconUri } : {}),
              ...(bannerUri ? { banner_image: bannerUri } : {}),
              ...(socials.website.trim() ? { external_link: socials.website.trim() } : {}),
              links,
            },
        address
      )
      uri = normalizeIpfsUri(await uploadObjectToIPFS(metadata))
      // The LSP4Metadata key holds a VerifiableURI over the JSON as the gateway serves it, not as posted
      if (isLukso) metadataHash = await hashIpfsContent(uri)
    } catch (err) {
      toast(err.message || 'Failed to upload metadata', 'error')
      setIsSavingMetadata(false)
      return
    }
    setIsSavingMetadata(false)

    pendingActionRef.current = 'metadata'
    // The collection is creator-owned (onlyOwner) — the wallet signs directly, no burner path
    if (isLukso) {
      writeContract({
        abi: collectionAbi,
        address: collection,
        functionName: 'setData',
        args: [LSP4_DATA_KEYS.metadata, encodeVerifiableURIFromDigest(uri, metadataHash)],
        chainId,
      })
    } else {
      writeContract({
        abi: collectionAbi,
        address: collection,
        functionName: 'setContractURI',
        args: [uri],
        chainId,
      })
    }
  }

  /** Sets the collection's ERC2981 royalty; 0% clears it. */
  const handleSetRoyalty = () => {
    const percent = Number(royaltyBpsDraft)
    if (!Number.isFinite(percent) || percent < 0 || percent > 10) {
      toast('Royalty must be between 0% and 10%', 'error')
      return
    }

    const bps = Math.round(percent * 100)
    const receiver = royaltyReceiverDraft.trim() || address
    if (bps > 0 && !isAddress(receiver)) {
      toast('Enter a valid receiver address', 'error')
      return
    }
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    pendingActionRef.current = 'royalty'
    writeContract({
      abi: collectionAbi,
      address: collection,
      functionName: 'setRoyalty',
      // Zero receiver is only legal with zero bps
      args: [bps === 0 ? zeroAddress : receiver, BigInt(bps)],
      chainId,
    })
  }

  /** Freezes the collection metadata forever after a second press. */
  const handleFreeze = () => {
    if (!confirmFreeze) {
      setConfirmFreeze(true)
      return
    }
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    pendingActionRef.current = 'freeze'
    writeContract({ abi: collectionAbi, address: collection, functionName: 'freezeMetadata', args: [], chainId })
  }

  /** Starts or pauses one phase. */
  const handleTogglePhase = async (phaseIndex, paused) => {
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    const args = [BigInt(dropId), BigInt(phaseIndex), paused]
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    setPhaseBusy(phaseIndex)

    if (session.active) {
      try {
        const tx = await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: dropsAddress,
          abi: dropsAbi,
          functionName: 'setPhasePaused',
          args,
        })
        await tx.wait().catch(() => null)
        toast(paused ? 'Stage paused' : 'Stage started', 'success')
        refetchPhases()
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setPhaseBusy(null)
      }
      return
    }

    pendingActionRef.current = 'phase'
    writeContract({ abi: dropsAbi, address: dropsAddress, functionName: 'setPhasePaused', args, chainId })
  }

  /** Adds or removes allowlist addresses onchain, in ALLOWLIST_BATCH_SIZE chunks. */
  const handleAllowlist = async (addresses, allowed) => {
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }
    if (addresses.length === 0) return

    setIsSavingAllowlist(true)
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    try {
      const chunks = []
      for (let i = 0; i < addresses.length; i += ALLOWLIST_BATCH_SIZE) chunks.push(addresses.slice(i, i + ALLOWLIST_BATCH_SIZE))

      for (const chunk of chunks) {
        const single = chunk.length === 1
        const functionName = single ? 'setAllowlisted' : 'setAllowlistedBatch'
        const args = single ? [BigInt(dropId), chunk[0], allowed] : [BigInt(dropId), chunk, allowed]

        if (session.active) {
          const tx = await writeWithBurnerSession({
            chain: chainInfo,
            contractAddress: dropsAddress,
            abi: dropsAbi,
            functionName,
            args,
          })
          await tx.wait().catch(() => null)
        } else {
          await writeAllowlistAsync({ abi: dropsAbi, address: dropsAddress, functionName, args, chainId })
        }
      }

      toast(allowed ? `${addresses.length} address${addresses.length === 1 ? '' : 'es'} allowlisted` : 'Address removed', 'success')
      setAllowlistDraft('')
      refetchAllowlistCount()
      refetchAllowlistPage()
    } catch (err) {
      toast(describeWalletError(err, { fallback: 'Transaction rejected or encountered an error.' }), 'error')
    } finally {
      setIsSavingAllowlist(false)
    }
  }

  /** Re-points the drop's share of mint proceeds; the zero address restores the creator. */
  const handleSetPayout = async (destination) => {
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }
    if (destination !== zeroAddress && !isAddress(destination)) {
      toast('Enter a valid address', 'error')
      return
    }

    setIsSavingPayout(true)
    const args = [BigInt(dropId), destination]

    try {
      // setPayoutDestination must come from the creator's own address — no burner session, no forwarder
      await writeAllowlistAsync({ abi: dropsAbi, address: dropsAddress, functionName: 'setPayoutDestination', args, chainId })
      toast(destination === zeroAddress ? 'Proceeds go to you again' : 'Payout destination updated', 'success')
      setPayoutDraft('')
      refetchPayout()
    } catch (err) {
      toast(describeWalletError(err, { fallback: 'Transaction rejected or encountered an error.' }), 'error')
    } finally {
      setIsSavingPayout(false)
    }
  }

  /** Pins a picked folder to IPFS and fills the base URI and suffix from it. */
  const handleFolderPick = async (event) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return

    setIsPinningFolder(true)
    try {
      const cid = await uploadFolderToIPFS(files)
      setBaseUriDraft(`ipfs://${cid}/`)

      const sample = String(files[0].webkitRelativePath || files[0].name).split('/').pop()
      const dot = sample.lastIndexOf('.')
      setSuffixDraft(dot > 0 ? sample.slice(dot) : '')

      toast(`Pinned ${files.length} files — check the preview, then save`, 'success')
    } catch (err) {
      toast(err.message || 'Folder upload failed', 'error')
    } finally {
      setIsPinningFolder(false)
    }
  }

  /** Points the collection's per-token metadata at a new base URI (the reveal). */
  const handleSaveTokenUri = async () => {
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }
    const base = baseUriDraft.trim()
    if (!base) {
      toast('Enter a base URI, or pick a folder to pin one', 'error')
      return
    }

    setIsSavingTokenUri(true)
    try {
      if (isLukso) {
        await writeCollectionAsync({
          abi: collectionAbi,
          address: collection,
          functionName: 'setData',
          args: [LSP8_DATA_KEYS.baseUri, encodeVerifiableURI(base)],
          chainId,
        })
      } else {
        await writeCollectionAsync({
          abi: collectionAbi,
          address: collection,
          functionName: 'setBaseURI',
          args: [base, suffixDraft.trim()],
          chainId,
        })
      }
      toast('Token metadata updated — each token now resolves to its own asset', 'success')
      setBaseUriDraft('')
      setSuffixDraft('')
      refetchTokenUri()
      refetchLsp8BaseUri()
    } catch (err) {
      toast(describeWalletError(err, { fallback: 'Transaction rejected or encountered an error.' }), 'error')
    } finally {
      setIsSavingTokenUri(false)
    }
  }

  /** Appends a phase to a live drop. */
  const handleAddPhase = async () => {
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    const now = nowSeconds()
    const start = newPhase.startAt ? BigInt(Math.floor(new Date(newPhase.startAt).getTime() / 1000)) : now - 60n
    const end = newPhase.endAt ? BigInt(Math.floor(new Date(newPhase.endAt).getTime() / 1000)) : 0n

    if (end !== 0n && end <= start) {
      toast('The phase has to end after it starts', 'error')
      return
    }
    if (newPhase.gate === DROP_GATES.COMMUNITY && !newPhase.communityId) {
      toast('Pick which community can mint', 'error')
      return
    }

    const phaseInput = {
      startTime: start,
      endTime: end,
      paused: newPhase.manualStart,
      token: newPhase.price && newPhase.token ? newPhase.token : zeroAddress,
      isLsp7: Boolean(newPhase.price && newPhase.token && newPhase.isLsp7),
      price: parseEther(newPhase.price || '0'),
      perWallet: BigInt(newPhase.perWallet.trim() === '' ? 0 : newPhase.perWallet),
      allocation: BigInt(newPhase.allocation.trim() === '' ? 0 : newPhase.allocation),
      gate: newPhase.gate,
      gateAsset: zeroAddress,
      gateData: newPhase.gate === DROP_GATES.COMMUNITY ? toHex(BigInt(newPhase.communityId), { size: 32 }) : zeroHash,
      gateMin: 0n,
    }

    setIsAddingPhase(true)
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    try {
      const args = [BigInt(dropId), phaseInput]
      if (session.active) {
        const tx = await writeWithBurnerSession({ chain: chainInfo, contractAddress: dropsAddress, abi: dropsAbi, functionName: 'addPhase', args })
        await tx.wait().catch(() => null)
      } else {
        await writeAllowlistAsync({ abi: dropsAbi, address: dropsAddress, functionName: 'addPhase', args, chainId })
      }
      toast('Stage added — it joins the schedule at the end', 'success')
      setNewPhase(null)
      refetchPhases()
    } catch (err) {
      toast(describeWalletError(err, { fallback: 'Adding the phase failed' }), 'error')
    } finally {
      setIsAddingPhase(false)
    }
  }

  /** Publishes a new LSP4Creators[] list on the collection. */
  const saveCreators = async (nextAddresses) => {
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    setIsSavingCreators(true)
    try {
      // A Universal Profile and an EOA get different map entries, so each address is probed for LSP0
      const withInterfaces = await Promise.all(
        nextAddresses.map(async (entry) => {
          let interfaceId = '0x00000000'
          try {
            const supported = await publicClient.readContract({
              address: entry,
              abi: [{ name: 'supportsInterface', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes4' }], outputs: [{ type: 'bool' }] }],
              functionName: 'supportsInterface',
              args: [INTERFACEID_LSP0],
            })
            if (supported) interfaceId = INTERFACEID_LSP0
          } catch {
            // Not ERC165 (or no code) — an EOA, the zero id
          }
          return { address: entry, interfaceId }
        }),
      )

      const { keys, values } = encodeCreatorsWrites(withInterfaces, creators)

      // LSP4Creators[] is a whole-array rewrite in one setDataBatch; the collection is onlyOwner,
      // so the wallet signs directly — no burner path
      await writeAllowlistAsync({
        abi: collectionAbi,
        address: collection,
        functionName: 'setDataBatch',
        args: [keys, values],
        chainId,
      })

      toast('Creators updated', 'success')
      setCreatorDraft('')
      refetchCreatorsCount()
      refetchCreatorEntries()
    } catch (err) {
      toast(describeWalletError(err, { fallback: 'Updating the creators failed' }), 'error')
    } finally {
      setIsSavingCreators(false)
    }
  }

  const handleClose = async () => {
    if (!confirmClose) {
      setConfirmClose(true)
      return
    }
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsClosing(true)
      try {
        const tx = await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: dropsAddress,
          abi: dropsAbi,
          functionName: 'closeDrop',
          args: [BigInt(dropId)],
        })
        await tx.wait().catch(() => null)
        toast('Drop closed — minting has ended for good', 'success')
        setConfirmClose(false)
        onClosed?.()
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsClosing(false)
      }
      return
    }

    pendingActionRef.current = 'close'
    writeContract({
      abi: dropsAbi,
      address: dropsAddress,
      functionName: 'closeDrop',
      args: [BigInt(dropId)],
      chainId,
    })
  }

  const isClosed = Boolean(drop?.closed)
  const imageUrl = image ? resolveStorageImageUrl(image) : null
  const iconUrl = icon ? resolveStorageImageUrl(icon) : null

  return (
    <section className={styles.manage}>
      <header className={styles.manage__header}>
        <div>
          <h2>Manage drop</h2>
          <small>Only you see this — you created this drop.</small>
        </div>
        <button type="button" className={styles.manage__edit} onClick={openEditor} disabled={isBusy || metadataFrozen}>
          <PencilSimpleIcon size={14} />
          {metadataFrozen ? 'Metadata frozen' : 'Edit metadata'}
        </button>
      </header>

      {/* Earnings lead, at a size that reads across a room. There is no withdraw button and
          there never will be: proceeds push to the payout destination inside the mint itself, so
          this is money already in the creator's wallet, not a balance held here waiting to be
          claimed. Saying so is the point — a creator arriving from a launchpad that escrows will
          look for the button. */}
      <div className={styles.manage__earnings}>
        <span className={styles.manage__earningsLabel}>Earned from mints</span>
        <strong className={styles.manage__earningsValue}>
          {totals ? formatNative(creatorNetWei) : '—'} <em>{nativeSymbol}</em>
        </strong>
<small className={styles.manage__earningsNote}>
          {minterPaidWei > 0n ? (
            <>
              Minters paid {formatNative(minterPaidWei)} {nativeSymbol} in total:{' '}
              <strong>
                {formatNative(creatorNetWei)} {nativeSymbol} to you
              </strong>
              {percentageFeeWei > 0n && `, ${formatNative(percentageFeeWei)} ${nativeSymbol} platform cut`}
              {flatFeeWei > 0n && `, ${formatNative(flatFeeWei)} ${nativeSymbol} in platform fees on top`}
              {referralsWei > 0n && `, ${formatNative(referralsWei)} ${nativeSymbol} to referrers`}.{' '}
            </>
          ) : null}
          Paid out on every mint — nothing to withdraw.
        </small>
      </div>

      <div className={styles.manage__stats}>
        <div className={styles.manage__stat}>
          <span>Items minted</span>
          <strong>{totals ? countFormat.format(totals.items_minted) : countFormat.format(Number(drop?.minted ?? 0))}</strong>
        </div>
        <div className={styles.manage__stat}>
          <span>Mint transactions</span>
          <strong>{totals ? countFormat.format(totals.mint_count) : '—'}</strong>
        </div>
      </div>

      {indexed && indexed.indexed === false && (
        <p className={styles.manage__hint}>Revenue and activity appear once the indexer has scanned this drop.</p>
      )}

      {phases.length > 0 && (
        <div className={styles.manage__phases}>
          <h3>Mint stages</h3>
          <ul>
            {phases.map((phase, index) => {
              const status = phaseStatus(phase)
              const isEnded = status === PHASE_STATUS.ENDED
              return (
                <li key={index}>
                  <span className={clsx(styles.manage__phaseStatus, styles[`manage__phaseStatus--${status}`])}>
                    {status === PHASE_STATUS.LIVE
                      ? 'Live'
                      : status === PHASE_STATUS.PAUSED
                        ? 'Paused'
                        : status === PHASE_STATUS.UPCOMING
                          ? 'Upcoming'
                          : 'Ended'}
                  </span>
                  <span className={styles.manage__phaseName}>Stage {index + 1}</span>
                  <span className={styles.manage__phaseMeta}>
                    {phase.price === 0n ? 'Free' : `${formatNative(phase.price)} ${nativeSymbol}`} · {gateLabel(Number(phase.gate))}
                    {formatPhaseTime(phase.startTime) ? ` · ${formatPhaseTime(phase.startTime)}` : ''}
                    {Number(phase.endTime) > 0 ? ` → ${formatPhaseTime(phase.endTime)}` : ' → open-ended'}
                  </span>
                  <span className={styles.manage__phaseMinted}>{countFormat.format(Number(phase.minted))} minted</span>

                  {!isClosed && !isEnded && (
                    <button
                      type="button"
                      className={clsx(styles.manage__phaseToggle, phase.paused && styles['manage__phaseToggle--start'])}
                      onClick={() => handleTogglePhase(index, !phase.paused)}
                      disabled={isBusy}
                    >
                      {phaseBusy === index ? '…' : phase.paused ? 'Start' : 'Pause'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <p className={styles.manage__hint}>
            Start and pause as often as you like. An existing phase&rsquo;s window, price, limits and gate are fixed
            forever — but you can append a new phase below, and closing the drop is the only other override.
          </p>

          {!isClosed && phases.length < MAX_DROP_PHASES && (
            newPhase ? (
              <div className={styles.manage__newPhase}>
                <div className={styles.manage__phaseHead}>
                  <strong>New stage {phases.length + 1}</strong>
                  <button type="button" onClick={() => setNewPhase(null)} disabled={isBusy}>
                    <XIcon size={12} />
                    Cancel
                  </button>
                </div>

                <div className={styles.manage__newPhaseGrid}>
                  <label className={styles.manage__field}>
                    <span>Price ({nativeSymbol})</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={newPhase.price}
                      placeholder="Free"
                      onChange={(e) => setNewPhase({ ...newPhase, price: e.target.value })}
                      disabled={isBusy}
                    />
                  </label>
                  <label className={styles.manage__field}>
                    <span>Per wallet</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={newPhase.perWallet}
                      placeholder="Unlimited"
                      onChange={(e) => setNewPhase({ ...newPhase, perWallet: e.target.value })}
                      disabled={isBusy}
                    />
                  </label>
                  <label className={styles.manage__field}>
                    <span>Starts</span>
                    <input
                      type="datetime-local"
                      value={newPhase.startAt}
                      onChange={(e) => setNewPhase({ ...newPhase, startAt: e.target.value })}
                      disabled={isBusy || newPhase.manualStart}
                    />
                  </label>
                  <label className={styles.manage__field}>
                    <span>Ends</span>
                    <input
                      type="datetime-local"
                      value={newPhase.endAt}
                      onChange={(e) => setNewPhase({ ...newPhase, endAt: e.target.value })}
                      disabled={isBusy}
                    />
                  </label>
                  {Number(drop?.maxSupply ?? 0) > 0 && (
                    <label className={styles.manage__field}>
                      <span>Allocation</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={newPhase.allocation}
                        placeholder="No cap"
                        onChange={(e) => setNewPhase({ ...newPhase, allocation: e.target.value })}
                        disabled={isBusy}
                      />
                    </label>
                  )}
                  <label className={styles.manage__field}>
                    <span>Who can mint</span>
                    <select
                      value={newPhase.gate}
                      onChange={(e) => setNewPhase({ ...newPhase, gate: Number(e.target.value) })}
                      disabled={isBusy}
                    >
                      <option value={DROP_GATES.OPEN}>Open to everyone</option>
                      <option value={DROP_GATES.ALLOWLIST}>Allowlist</option>
                      {hasCommunityGate && <option value={DROP_GATES.COMMUNITY}>Community members</option>}
                    </select>
                  </label>
                  {newPhase.gate === DROP_GATES.COMMUNITY && (
                    <label className={styles.manage__field}>
                      <span>Which community</span>
                      <select
                        value={newPhase.communityId}
                        onChange={(e) => setNewPhase({ ...newPhase, communityId: e.target.value })}
                        disabled={isBusy}
                      >
                        <option value="">Choose…</option>
                        {communities.map((community) => (
                          <option key={community.id} value={community.id}>
                            {community.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                <label className={styles.manage__newPhaseToggle}>
                  <input
                    type="checkbox"
                    checked={newPhase.manualStart}
                    onChange={(e) => setNewPhase({ ...newPhase, manualStart: e.target.checked })}
                    disabled={isBusy}
                  />
                  Create it paused, and start it myself
                </label>

                <button type="button" className={styles.manage__phaseToggle} onClick={handleAddPhase} disabled={isBusy}>
                  {isAddingPhase ? 'Adding…' : 'Add a stage'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.manage__addPhase}
                onClick={() => setNewPhase({ startAt: '', endAt: '', price: '', perWallet: '', allocation: '', gate: DROP_GATES.OPEN, communityId: '', manualStart: true })}
                disabled={isBusy}
              >
                <PlusIcon size={13} />
                Add a phase
                <em>{phases.length} of {MAX_DROP_PHASES}</em>
              </button>
            )
          )}
        </div>
      )}

      {hasAllowlistPhase && (
        <div className={styles.manage__allowlistBlock}>
          <h3>
            Allowlist
            <small>{countFormat.format(Number(allowlistTotal))} addresses</small>
          </h3>

          {allowlistEntries.length > 0 && (
            <ul className={styles.manage__allowlistList}>
              {allowlistEntries.map((entry) => (
                <li key={entry}>
                  <code title={entry}>{shortAddress(entry)}</code>
                  {!isClosed && (
                    <button
                      type="button"
                      onClick={() => handleAllowlist([entry], false)}
                      disabled={isBusy}
                      aria-label={`Remove ${entry} from the allowlist`}
                    >
                      <XIcon size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {Number(allowlistTotal) > allowlistEntries.length && (
            <p className={styles.manage__hint}>Showing the first {allowlistEntries.length} of {countFormat.format(Number(allowlistTotal))}.</p>
          )}

          {!isClosed && (
            <div className={styles.manage__allowlistAdd}>
              <textarea
                rows={2}
                value={allowlistDraft}
                placeholder={'0xabc…\n0xdef…'}
                onChange={(e) => setAllowlistDraft(e.target.value)}
                disabled={isBusy}
              />
              <button
                type="button"
                onClick={() => handleAllowlist(normalizeAllowlist(allowlistDraft.split(/[\s,;]+/)), true)}
                disabled={isBusy || normalizeAllowlist(allowlistDraft.split(/[\s,;]+/)).length === 0}
              >
                <PlusIcon size={13} />
                {isSavingAllowlist ? 'Saving…' : 'Add'}
              </button>
            </div>
          )}
        </div>
      )}

      {isNumbered && !metadataFrozen && !isClosed && (
        <div className={styles.manage__tokenUri}>
          <h3>Token metadata</h3>
          <p className={styles.manage__hint}>
            {currentTokenUri ? (
              <>
                Token #1 currently resolves to <code title={currentTokenUri}>{currentTokenUri}</code>.{' '}
                {currentTokenUri.includes('#')
                  ? 'That’s the single-artwork placeholder — every token shares it.'
                  : 'Each token resolves to its own file.'}
              </>
            ) : (
              'Point each token at its own artwork.'
            )}
          </p>

          <p className={styles.manage__hint}>
            <a href={`/api/v1/drops/sample?standard=${standardId}`} download>
              Download a sample metadata folder
            </a>{' '}
            — three example files named the way {isLukso ? 'LSP8' : 'this standard'} expects, plus a README with the
            steps.
          </p>

          {isNumbered && !metadataFrozen && (
            <DropArtworkUpload
              standardId={standardId}
              maxSupply={Number(drop?.maxSupply ?? 0)}
              collectionName={drop?.name ?? ''}
              disabled={isBusy}
              onPinned={({ cid, suffix }) => {
                setBaseUriDraft(`ipfs://${cid}/`)
                setSuffixDraft(suffix)
              }}
            />
          )}

          <div className={styles.manage__tokenUriRow}>
            <label className={styles.manage__field}>
              <span>Base URI</span>
              <input
                type="text"
                value={baseUriDraft}
                placeholder="ipfs://<folder cid>/"
                onChange={(e) => setBaseUriDraft(e.target.value.trim())}
                disabled={isBusy}
                spellCheck={false}
              />
            </label>
            {/* LSP8 derives per-token URIs from the base key alone — no suffix to give it */}
            {!isLukso && (
              <label className={clsx(styles.manage__field, styles['manage__field--narrow'])}>
                <span>Suffix</span>
                <input
                  type="text"
                  value={suffixDraft}
                  placeholder=".json"
                  onChange={(e) => setSuffixDraft(e.target.value.trim())}
                  disabled={isBusy}
                  spellCheck={false}
                />
              </label>
            )}
          </div>

          {baseUriDraft && (
            <p className={styles.manage__hint}>
              Token #1 will resolve to <code>{`${baseUriDraft}1${isLukso ? '' : suffixDraft}`}</code>
            </p>
          )}

          <div className={styles.manage__tokenUriActions}>
            <label className={styles.manage__folderPick}>
              <input type="file" webkitdirectory="" directory="" multiple onChange={handleFolderPick} disabled={isBusy} hidden />
              {isPinningFolder ? 'Pinning…' : 'Upload folder'}
            </label>
            <button type="button" onClick={handleSaveTokenUri} disabled={isBusy || !baseUriDraft.trim()}>
              {isSavingTokenUri ? 'Saving…' : 'Save'}
            </button>
          </div>

          <p className={styles.manage__hint}>
            Upload a folder named by token id (<code>1.json</code>, <code>2.json</code>, …), or paste a CID you pinned
            elsewhere — large collections are better pinned with your own tool. Hup pins whatever you upload here.
          </p>
        </div>
      )}

      {isLukso && (
        <div className={styles.manage__creators}>
          <h3>
            Creators
            <small>credited on the collection itself</small>
          </h3>

          {creators.length > 0 && (
            <ul className={styles.manage__allowlistList}>
              {creators.map((entry) => {
                const isDropCreator = entry.toLowerCase() === drop?.creator?.toLowerCase()
                return (
                  <li key={entry}>
                    <code title={entry}>{shortAddress(entry)}</code>
                    {!isDropCreator && (
                      <button
                        type="button"
                        onClick={() => saveCreators(creators.filter((value) => value !== entry))}
                        disabled={isBusy}
                        aria-label={`Remove ${entry} from the creators`}
                      >
                        <XIcon size={12} />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {creators.length < MAX_DROP_CREATORS && (
            <div className={styles.manage__payoutRow}>
              <input
                type="text"
                value={creatorDraft}
                placeholder="0x… collaborator"
                onChange={(e) => setCreatorDraft(e.target.value.trim())}
                disabled={isBusy}
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => saveCreators([...creators, creatorDraft])}
                disabled={
                  isBusy ||
                  !isAddress(creatorDraft) ||
                  creators.some((entry) => entry.toLowerCase() === creatorDraft.toLowerCase())
                }
              >
                {isSavingCreators ? 'Saving…' : 'Add'}
              </button>
            </div>
          )}

          <p className={styles.manage__hint}>
            Written straight to the collection you own, so it keeps working even after you freeze the metadata.
          </p>
        </div>
      )}

      {!isClosed && (
        <div className={styles.manage__payout}>
          <h3>Where the money goes</h3>
          {/* A creator should not have to read a contract to learn what cut they keep. Every row
              is a live read, so it is what the next mint will do, not what it did at launch. */}
          <div className={styles.manage__tableScroll}>
            <table className={styles.manage__splitTable}>
              <thead>
                <tr>
                  <th>Goes to</th>
                  <th>Share</th>
                  <th>How</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>You</td>
                  <td>{(creatorBps / 100).toFixed(creatorBps % 100 ? 2 : 0)}%</td>
                  <td>
                    {payoutOverride ? <code title={payoutOverride}>{shortAddress(payoutOverride)}</code> : 'straight to your wallet'}
                  </td>
                </tr>
                {dropReferralBps > 0 && (
                  <tr>
                    <td>Referrer</td>
                    <td>{(dropReferralBps / 100).toFixed(dropReferralBps % 100 ? 2 : 0)}%</td>
                    <td>fixed at launch</td>
                  </tr>
                )}
                <tr>
                  <td>Hup</td>
                  <td>{(platformBps / 100).toFixed(platformBps % 100 ? 2 : 0)}%</td>
                  <td>{platformBps === 0 ? 'no cut of your price' : 'of each paid mint'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {flatFee > 0n && (
            <p className={styles.manage__hint}>
              Minters also pay <strong>{formatNative(flatFee)} {nativeSymbol}</strong> per item on top of your price — a
              platform fee that never comes out of your share.
            </p>
          )}

          <h3>Payout destination</h3>
          <p className={styles.manage__hint}>
            {payoutOverride ? (
              <>
                Your share of each mint goes to <code title={payoutOverride}>{shortAddress(payoutOverride)}</code>.
              </>
            ) : (
              'Your share of each mint comes straight to your wallet.'
            )}{' '}
            Point it at another wallet, a treasury, or a contract that splits proceeds by its own rules.
          </p>
          <div className={styles.manage__payoutRow}>
            <input
              type="text"
              value={payoutDraft}
              placeholder={payoutOverride || '0x…'}
              onChange={(e) => setPayoutDraft(e.target.value.trim())}
              disabled={isBusy}
              spellCheck={false}
            />
            <button type="button" onClick={() => handleSetPayout(payoutDraft)} disabled={isBusy || !isAddress(payoutDraft)}>
              {isSavingPayout ? 'Saving…' : 'Save'}
            </button>
            {payoutOverride && (
              <button type="button" onClick={() => handleSetPayout(zeroAddress)} disabled={isBusy}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <div className={styles.manage__royalty}>
        <h3>Royalty</h3>
        <div className={styles.manage__royaltyRow}>
          <label className={styles.manage__field}>
            <span>Percentage (max 10%)</span>
            <input
              type="number"
              min="0"
              max="10"
              step="0.01"
              value={royaltyBpsDraft}
              placeholder="0"
              onChange={(e) => setRoyaltyBpsDraft(e.target.value)}
              disabled={isBusy}
            />
          </label>
          <label className={styles.manage__field}>
            <span>Receiver</span>
            <input
              type="text"
              value={royaltyReceiverDraft}
              placeholder={address ?? '0x…'}
              onChange={(e) => setRoyaltyReceiverDraft(e.target.value)}
              disabled={isBusy}
            />
          </label>
          <button type="button" className={styles.manage__phaseToggle} onClick={handleSetRoyalty} disabled={isBusy}>
            Save
          </button>
        </div>
        <p className={styles.manage__hint}>
          Currently {Number(royaltyBps) / 100}% {Number(royaltyBps) > 0 && royaltyReceiver ? `to ${shortAddress(royaltyReceiver)}` : ''} — ERC2981,
          honoured by marketplaces that support it. 0% clears it.
        </p>
      </div>

      {mints.length > 0 && (
        <div className={styles.manage__activity}>
          <h3>Activity</h3>
          {/* The table scrolls inside this rather than being clipped: three nowrap columns plus
              a display name outgrow a narrow panel, and the rounded corners need an overflow
              owner either way. */}
          <div className={styles.manage__tableScroll}>
            <table>
            <thead>
              <tr>
                <th>Minter</th>
                <th>Items</th>
                <th>Paid</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {mints.map((mint) => (
                <tr key={mint.tx_hash + mint.first_token_id}>
                  <td>{mint.display_name || shortAddress(mint.minter)}</td>
                  <td>{countFormat.format(mint.quantity)}</td>
                  <td>
                    {Number(mint.total_paid) === 0 ? 'Free' : `${formatNative(mint.total_paid)} ${nativeSymbol}`}
                  </td>
                  <td>{mint.minted_at ? dateTimeFormat.format(new Date(mint.minted_at)) : '—'}</td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!metadataFrozen && (
        <div className={styles.manage__danger}>
          <div>
            <strong>Freeze metadata</strong>
            <small>
              Locks the collection&rsquo;s metadata pointer forever — no more edits to the artwork, description, or links.
              {isNumbered && ' It locks token metadata too, so reveal before you freeze: the base URI can never be changed after this.'}{' '}
              Collectors read a frozen collection as one that can&rsquo;t be rug-edited after they mint.
            </small>
          </div>
          <button
            type="button"
            className={clsx(styles.manage__close, confirmFreeze && styles['manage__close--armed'])}
            onClick={handleFreeze}
            disabled={isBusy}
          >
            {confirmFreeze ? 'Yes, freeze forever' : 'Freeze metadata'}
          </button>
          {confirmFreeze && !isBusy && (
            <button type="button" className={styles.manage__disarm} onClick={() => setConfirmFreeze(false)}>
              Cancel
            </button>
          )}
        </div>
      )}

      {!isClosed && (
        <div className={styles.manage__danger}>
          <div>
            <strong>Close drop</strong>
            <small>
              Ends minting permanently — remaining supply is forfeited. Your collection and everything already minted are
              untouched.
            </small>
          </div>
          <button
            type="button"
            className={clsx(styles.manage__close, confirmClose && styles['manage__close--armed'])}
            onClick={handleClose}
            disabled={isBusy}
          >
            {isClosing || (isBusy && pendingActionRef.current === 'close')
              ? 'Closing…'
              : confirmClose
                ? 'Yes, close forever'
                : 'Close drop'}
          </button>
          {confirmClose && !isBusy && (
            <button type="button" className={styles.manage__disarm} onClick={() => setConfirmClose(false)}>
              Cancel
            </button>
          )}
        </div>
      )}

      <NativeDialog
        ref={editDialogRef}
        className={styles.manage__dialog}
        aria-label="Edit collection metadata"
        onClick={(e) => e.stopPropagation()}
        onClose={(e) => e.stopPropagation()}
        onCancel={(e) => e.stopPropagation()}
      >
        <header className={styles.manage__dialogHeader}>
          <button type="button" className={styles.manage__dialogCancel} onClick={() => editDialogRef.current?.close()}>
            Cancel
          </button>
          <h3>Collection metadata</h3>
        </header>

        <div className={styles.manage__dialogBody}>
          <p className={styles.manage__hint}>
            Uploaded to IPFS and referenced onchain — updating costs one transaction. Shown on the drop page and anywhere the
            collection appears.
          </p>

          <div className={styles.manage__identity}>
            <label className={clsx(styles.manage__image, imageUrl && styles['manage__image--filled'])}>
              {imageUrl ? <img src={imageUrl} alt="" /> : <ImageIcon size={22} weight="light" />}
              <input type="file" accept="image/*" onChange={handleImageSelect} disabled={isBusy} hidden />
            </label>
            <div className={styles.manage__imageHint}>
              <strong>Artwork {isImageUploading && <em>uploading…</em>}</strong>
              <small>Tap to replace the collection image.</small>
            </div>
          </div>

          <div className={styles.manage__identity}>
            <label className={clsx(styles.manage__image, styles['manage__image--icon'], iconUrl && styles['manage__image--filled'])}>
              {iconUrl ? <img src={iconUrl} alt="" /> : <ImageIcon size={18} weight="light" />}
              <input type="file" accept="image/*" onChange={handleIconSelect} disabled={isBusy} hidden />
            </label>
            <div className={styles.manage__imageHint}>
              <strong>Icon</strong>
              <small>Square logo wallets and explorers show. Falls back to the artwork.</small>
            </div>
          </div>

          <label className={styles.manage__field}>
            <span>
              Description
              <em>
                {description.length}/{MAX_DESCRIPTION_LENGTH}
              </em>
            </span>
            <textarea
              rows={4}
              value={description}
              maxLength={MAX_DESCRIPTION_LENGTH}
              placeholder="What is the story behind this collection?"
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBusy}
            />
          </label>

          <div className={styles.manage__field}>
            <span>Banner {isBannerUploading && <em>uploading…</em>}</span>
            <label className={clsx(styles.manage__banner, banner && styles['manage__banner--filled'])}>
              {banner ? (
                <img src={resolveStorageImageUrl(banner)} alt="" />
              ) : (
                <span>
                  <ImageIcon size={18} weight="light" />
                  Upload banner
                </span>
              )}
              <input type="file" accept="image/*" onChange={handleBannerSelect} disabled={isBusy} hidden />
            </label>
            <small>Shown atop the drop page. Recommended 1600 × 640.</small>
          </div>

          {DROP_SOCIALS.map(({ key, title, placeholder }) => (
            <label key={key} className={styles.manage__field}>
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

          <div className={styles.manage__linksEditor}>
            <span>More links</span>
            {linkRows.map((row, index) => (
              <div key={index} className={styles.manage__linkRow}>
                <input
                  type="text"
                  value={row.title}
                  placeholder="Title"
                  onChange={(e) =>
                    setLinkRows((rows) => rows.map((r, i) => (i === index ? { ...r, title: e.target.value } : r)))
                  }
                  disabled={isBusy}
                />
                <input
                  type="url"
                  value={row.url}
                  placeholder="https://…"
                  onChange={(e) => setLinkRows((rows) => rows.map((r, i) => (i === index ? { ...r, url: e.target.value } : r)))}
                  disabled={isBusy}
                />
                <button
                  type="button"
                  onClick={() => setLinkRows((rows) => rows.filter((_, i) => i !== index))}
                  aria-label="Remove link"
                  disabled={isBusy}
                >
                  <XIcon size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.manage__addLink}
              onClick={() => setLinkRows((rows) => [...rows, { title: '', url: '' }])}
              disabled={isBusy}
            >
              <PlusIcon size={14} />
              Add link
            </button>
          </div>

          <button type="button" className={styles.manage__save} onClick={handleSaveMetadata} disabled={isBusy}>
            {isBusy ? 'Updating…' : 'Update metadata'}
          </button>
        </div>
      </NativeDialog>
    </section>
  )
}
