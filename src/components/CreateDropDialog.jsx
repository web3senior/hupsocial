'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { formatEther, isAddress, parseEther, parseEventLogs, parseUnits, toHex, zeroAddress, zeroHash } from 'viem'
import { useConnection, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { hashIpfsContent, uploadFileToIPFS, uploadObjectToIPFS, withAuthor } from '@/lib/ipfs'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { networkColorStyle } from '@/lib/networkColors'
import { describeWalletError } from '@/lib/walletErrors'
import {
  DROP_GATES,
  DROP_SOCIALS,
  DROP_STANDARDS,
  ALLOWLIST_BATCH_SIZE,
  buildDropLinks,
  buildLsp4MetadataJson,
  dropFamilyLabel,
  dropStandardFamilies,
  dropStandardLabel,
  dropStandardsFor,
  encodeCollectionParams,
  encodeVerifiableURI,
  encodeVerifiableURIFromDigest,
  isLuksoChain,
  isLuksoStandard,
  LSP4_TOKEN_TYPE_COLLECTION,
  MAX_PHASE_NAME_BYTES,
  normalizeAllowlist,
  phaseNameByteLength,
} from '@/lib/drops'
import dropsAbi from '@/abis/HupDrops.json'
import { toast } from '@/components/NextToast'
import {
  CaretDownIcon,
  CheckCircleIcon,
  ImageIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  PlusIcon,
  UsersIcon,
  UsersThreeIcon,
  XIcon,
} from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import Tooltip from './ui/Tooltip'
import styles from './CreateDropDialog.module.scss'

const MAX_NAME_LENGTH = 48
const MAX_SYMBOL_LENGTH = 10
const MAX_DESCRIPTION_LENGTH = 280

// Must stay within the collections' MAX_ROYALTY_BPS (1000) and the engine's MAX_REFERRAL_BPS (5000)
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

const normalizeSymbol = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_SYMBOL_LENGTH)

const normalizeIpfsUri = (value) => (value?.startsWith('ipfs://') ? value : `ipfs://${value}`)

const toUnixSeconds = (value) => BigInt(Math.floor(new Date(value).getTime() / 1000))

/** Mirrors the engine's MAX_PHASES */
const MAX_PHASES = 8

const emptyPhase = (startAt = '') => ({
  name: '',
  startAt,
  endAt: '',
  price: '',
  perWallet: '',
  allocation: '',
  gate: DROP_GATES.OPEN,
  communityId: '',
  token: '',
  isLsp7: false,
  manualStart: false,
})

const getDropDraftKey = () => `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}drop-draft`

/** Restores a saved draft. Never restores the chain or token family — those follow the composer. */
const loadDropDraft = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(getDropDraftKey())
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')
    const bps = (value, presets) => (presets.includes(value) ? value : 0)

    return {
      image: str(parsed.image, 200),
      imageName: str(parsed.imageName, 200),
      banner: str(parsed.banner, 200),
      icon: str(parsed.icon, 200),
      name: str(parsed.name, MAX_NAME_LENGTH),
      symbol: normalizeSymbol(str(parsed.symbol, MAX_SYMBOL_LENGTH)),
      description: str(parsed.description, MAX_DESCRIPTION_LENGTH),
      shape: parsed.shape === 'editions' ? 'editions' : 'numbered',
      supply: str(parsed.supply, 20),
      phases: Array.isArray(parsed.phases)
        ? parsed.phases.slice(0, MAX_PHASES).map((phase) => ({
            startAt: str(phase?.startAt, 40),
            endAt: str(phase?.endAt, 40),
            price: str(phase?.price, 40),
            perWallet: str(phase?.perWallet, 20),
            allocation: str(phase?.allocation, 20),
            gate: Object.values(DROP_GATES).includes(phase?.gate) ? phase.gate : DROP_GATES.OPEN,
            communityId: str(phase?.communityId, 20),
            token: str(phase?.token, 42),
            name: str(phase?.name, MAX_PHASE_NAME_BYTES),
            isLsp7: Boolean(phase?.isLsp7),
            manualStart: Boolean(phase?.manualStart),
          }))
        : null,
      allowlistText: str(parsed.allowlistText, 100_000),
      royaltyBps: bps(parsed.royaltyBps, ROYALTY_PRESETS),
      burnable: Boolean(parsed.burnable),
      referralBps: bps(parsed.referralBps, REFERRAL_PRESETS),
      socials: parsed.socials && typeof parsed.socials === 'object' ? parsed.socials : null,
    }
  } catch {
    return null
  }
}

const clearDropDraft = () => {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(getDropDraftKey())
  } catch (error) {
    console.error('Failed to clear drop draft:', error)
  }
}

/**
 * Create Drop Dialog
 * Launches an NFT drop through the HupDrops engine: deploys a creator-owned collection
 * (ERC721/ERC1155, or LSP7/LSP8 on LUKSO) and fixes its immutable mint schedule at creation.
 *
 * @param {string} [props.prefillImage] IPFS CID of the post's first image, offered as the artwork.
 * @param {boolean} [props.showSuccessStep] Show the "it's live" step; the composer skips it.
 * @param {Function} props.onCreated Receives { dropId, chainId, collection, standardId, name, symbol, image } once the tx confirms.
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
  const families = useMemo(() => dropStandardFamilies(chainId ?? 0), [chainId])
  const [family, setFamily] = useState(families[0])
  const activeFamily = families.includes(family) ? family : families[0]
  const standards = useMemo(() => dropStandardsFor(chainId ?? 0, activeFamily), [chainId, activeFamily])

  const [draft] = useState(loadDropDraft)

  const [step, setStep] = useState('form')
  const [image, setImage] = useState(prefillImage || draft?.image || '')
  const [imageName, setImageName] = useState(draft?.imageName ?? '')
  const [showBranding, setShowBranding] = useState(Boolean(draft?.banner || draft?.icon || draft?.socials))
  const [banner, setBanner] = useState(draft?.banner ?? '')
  const [icon, setIcon] = useState(draft?.icon ?? '')
  const [isIconUploading, setIsIconUploading] = useState(false)
  const [isBannerUploading, setIsBannerUploading] = useState(false)
  const [socials, setSocials] = useState(
    draft?.socials ?? { website: '', x: '', discord: '', telegram: '', instagram: '' },
  )
  const [name, setName] = useState(draft?.name ?? '')
  const [symbol, setSymbol] = useState(draft?.symbol ?? '')
  const [description, setDescription] = useState(draft?.description || prefillDescription.slice(0, MAX_DESCRIPTION_LENGTH))
  const [shape, setShape] = useState(draft?.shape ?? 'numbered')
  const [supply, setSupply] = useState(draft?.supply ?? '')
  const [phases, setPhases] = useState(draft?.phases?.length ? draft.phases : [emptyPhase()])
  const [allowlistText, setAllowlistText] = useState(draft?.allowlistText ?? '')
  const [royaltyBps, setRoyaltyBps] = useState(draft?.royaltyBps ?? 0)
  const [burnable, setBurnable] = useState(draft?.burnable ?? false)
  const [referralBps, setReferralBps] = useState(draft?.referralBps ?? 0)
  const [created, setCreated] = useState(null)
  const [isImageUploading, setIsImageUploading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmittingBurner, setIsSubmittingBurner] = useState(false)
  const [resetArmed, setResetArmed] = useState(false)
  const [draftSaved, setDraftSaved] = useState(false)

  // The composer may finish uploading the post's image after this dialog mounts
  useEffect(() => {
    if (prefillImage) setImage(prefillImage)
  }, [prefillImage])

  useEffect(() => {
    const hasPhaseContent = phases.some(
    (phase) => phase.name.trim() || phase.price.trim() || phase.startAt || phase.endAt || phase.perWallet.trim(),
  )
    const hasContent = Boolean(image || name.trim() || symbol.trim() || description.trim() || supply.trim() || hasPhaseContent)

    if (!hasContent) {
      clearDropDraft()
      setDraftSaved(false)
      return
    }

    try {
      localStorage.setItem(
        getDropDraftKey(),
        JSON.stringify({
          image,
          imageName,
          banner,
          icon,
          name,
          symbol,
          description,
          shape,
          supply,
          phases,
          allowlistText,
          royaltyBps,
          burnable,
          referralBps,
          socials,
        }),
      )
      setDraftSaved(true)
    } catch (error) {
      setDraftSaved(false)
      console.error('Failed to save drop draft:', error)
    }
  }, [
    image,
    imageName,
    banner,
    icon,
    name,
    symbol,
    description,
    shape,
    supply,
    phases,
    allowlistText,
    royaltyBps,
    burnable,
    referralBps,
    socials,
  ])

  // No 0n default: createDrop requires msg.value == creationFee exactly, so an unread fee must block submit
  const { data: creationFee } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'creationFee',
    chainId,
    query: { enabled: Boolean(dropsAddress) },
  })
  const { data: communitySystem } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'communitySystem',
    chainId,
    query: { enabled: Boolean(dropsAddress) },
  })
  const hasCommunityGate = Boolean(communitySystem && communitySystem !== zeroAddress)

  const { data: communityList } = useSWR(
    hasCommunityGate ? `/api/v1/networks/communities?network_id=${chainId}&limit=50` : null,
    (url) => fetch(url).then((res) => res.json()),
  )
  const communities = communityList?.data ?? []

  const { data: mintFeeBps = 0n } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'mintFeeBps',
    chainId,
    query: { enabled: Boolean(dropsAddress) },
  })

  const { data: flatMintFee = 0n } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'mintFee',
    chainId,
    query: { enabled: Boolean(dropsAddress) },
  })

  const { data: mintFeeEnabled = false } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'mintFeeEnabled',
    chainId,
    query: { enabled: Boolean(dropsAddress) },
  })

  const activeFlatMintFee = mintFeeEnabled ? flatMintFee : 0n

  const standardId = shape === 'numbered' ? standards.numbered : standards.editions

  // A standard with no registered deployer reverts createDrop with InvalidStandard
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
  // Own hook instance: sharing `hash` would re-fire the isConfirmed effect once per allowlist batch
  const { writeContractAsync: writeBatchAsync } = useWriteContract()
  const [isPublishingAllowlist, setIsPublishingAllowlist] = useState(false)

  const isBusy = isPending || isConfirming || isUploading || isSubmittingBurner || isImageUploading || isBannerUploading || isIconUploading || isPublishingAllowlist

  useEffect(() => {
    if (!submitError) return
    toast(describeWalletError(submitError, { fallback: 'Transaction rejected' }), 'error')
  }, [submitError])

  const pendingAllowlistRef = useRef([])

  /** A failed chunk leaves the drop live with a partial allowlist; the Manage panel finishes it. */
  const publishAllowlist = async (dropId, addresses) => {
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))
    const chunks = []
    for (let i = 0; i < addresses.length; i += ALLOWLIST_BATCH_SIZE) chunks.push(addresses.slice(i, i + ALLOWLIST_BATCH_SIZE))

    for (let i = 0; i < chunks.length; i++) {
      const args = [dropId, chunks[i], true]
      if (session.active) {
        const tx = await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: dropsAddress,
          abi: dropsAbi,
          functionName: 'setAllowlistedBatch',
          args,
        })
        await tx.wait().catch(() => null)
      } else {
        await writeBatchAsync({ abi: dropsAbi, address: dropsAddress, functionName: 'setAllowlistedBatch', args, chainId })
      }
      if (chunks.length > 1) toast(`Allowlist batch ${i + 1}/${chunks.length} sent`, 'success')
    }
  }

  const settle = async (dropRef) => {
    if (dropRef && pendingAllowlistRef.current.length > 0) {
      setIsPublishingAllowlist(true)
      try {
        await publishAllowlist(BigInt(dropRef.dropId), pendingAllowlistRef.current)
      } catch (err) {
        toast(describeWalletError(err, { fallback: 'Publishing the allowlist failed — finish it from Manage on the drop page' }), 'error')
      } finally {
        pendingAllowlistRef.current = []
        setIsPublishingAllowlist(false)
      }
    }

    toast(`${name.trim() || 'Your drop'} is live`, 'success')
    // Cleared before the fields reset, or the save effect writes an empty draft back
    clearDropDraft()
    const payload = dropRef
      ? {
          ...dropRef,
          chainId,
          name: name.trim(),
          symbol,
          image,
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

  const handleReset = () => {
    setImage(prefillImage || '')
    setImageName('')
    setBanner('')
    setIcon('')
    setShowBranding(false)
    setSocials({ website: '', x: '', discord: '', telegram: '', instagram: '' })
    setName('')
    setSymbol('')
    setDescription(prefillDescription.slice(0, MAX_DESCRIPTION_LENGTH))
    setShape('numbered')
    setSupply('')
    setPhases([emptyPhase()])
    setAllowlistText('')
    setRoyaltyBps(0)
    setBurnable(false)
    setReferralBps(0)
    setResetArmed(false)
    clearDropDraft()
    setDraftSaved(false)
    toast('Form cleared', 'success')
  }

  useEffect(() => {
    if (!resetArmed) return
    const timer = setTimeout(() => setResetArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [resetArmed])

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

  const handleIconSelect = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file', 'error')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('Icon must be under 10 MB', 'error')
      return
    }

    setIsIconUploading(true)
    try {
      const cid = await uploadFileToIPFS(file)
      if (!cid) throw new Error('Upload failed')
      setIcon(cid)
    } catch (err) {
      toast(err.message || 'Icon upload failed. Please try again.', 'error')
    } finally {
      setIsIconUploading(false)
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

  const updatePhase = (index, patch) => setPhases((prev) => prev.map((phase, i) => (i === index ? { ...phase, ...patch } : phase)))

  const addPhase = () =>
    setPhases((prev) => (prev.length >= MAX_PHASES ? prev : [...prev, emptyPhase(prev[prev.length - 1]?.endAt ?? '')]))

  const removePhase = (index) => setPhases((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))

  // The allowlist is drop-scoped onchain (`allowlist[dropId][wallet]`), so one list serves every allowlist phase
  const needsAllowlist = phases.some((phase) => phase.gate === DROP_GATES.ALLOWLIST)
  const allowlist = useMemo(
    () => (needsAllowlist ? normalizeAllowlist(allowlistText.split(/[\s,;]+/)) : []),
    [needsAllowlist, allowlistText],
  )

  const supplyCount = supply.trim() === '' ? 0 : Number(supply)
  const isOpenEdition = supplyCount === 0

  const canReview = Boolean(
    image && name.trim() && symbol && !isBusy && creationFee !== undefined && (!needsAllowlist || allowlist.length > 0),
  )

  const handleReview = (event) => {
    event.preventDefault()
    if (!image || !name.trim() || !symbol) {
      toast('Artwork, name, and symbol are all required', 'error')
      return
    }
    if (needsAllowlist && allowlist.length === 0) {
      toast('Paste at least one valid address for the allowlist', 'error')
      return
    }

    const now = BigInt(Math.floor(Date.now() / 1000))
    for (const [index, phase] of phases.entries()) {
      const label = phases.length > 1 ? `Stage ${index + 1}: ` : ''
      const start = phase.startAt ? toUnixSeconds(phase.startAt) : now
      const end = phase.endAt ? toUnixSeconds(phase.endAt) : 0n

      if (end !== 0n && end <= now) {
        toast(`${label}the end time must be in the future`, 'error')
        return
      }
      if (end !== 0n && end <= start) {
        toast(`${label}it has to end after it starts`, 'error')
        return
      }
      if (!isOpenEdition && Number(phase.allocation || 0) > supplyCount) {
        toast(`${label}the allocation can't exceed the drop's supply`, 'error')
        return
      }
      if (phase.gate === DROP_GATES.COMMUNITY && !phase.communityId) {
        toast(`${label}pick which community can mint`, 'error')
        return
      }
      // A half-typed token address would silently fall back to native pricing on submit
      if (Number(phase.price) > 0 && phase.token && !isAddress(phase.token)) {
        toast(`${label}enter a valid payment token address, or price it in ${nativeSymbol}`, 'error')
        return
      }
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
    pendingAllowlistRef.current = needsAllowlist ? allowlist : []
    try {
      const links = buildDropLinks(socials)
      const isLukso = isLuksoStandard(standardId)
      const imageUri = normalizeIpfsUri(image)
      const bannerUri = banner ? normalizeIpfsUri(banner) : ''
      const iconUri = icon ? normalizeIpfsUri(icon) : ''

      // LSP4 media entries carry a keccak256 of the served bytes; ERC metadata has no slot for them
      const [imageHash, backgroundImageHash, iconHash] = isLukso
        ? await Promise.all([
            hashIpfsContent(imageUri),
            bannerUri ? hashIpfsContent(bannerUri) : null,
            iconUri ? hashIpfsContent(iconUri) : null,
          ])
        : [null, null, null]

      const metadata = withAuthor(
        isLukso
          ? buildLsp4MetadataJson({
              name: name.trim(),
              description: description.trim(),
              imageUrl: imageUri,
              imageHash,
              backgroundImageUrl: bannerUri,
              backgroundImageHash,
              iconUrl: iconUri,
              iconHash,
              links,
            })
          : {
              name: name.trim(),
              symbol,
              description: description.trim(),
              image: imageUri,
              ...(bannerUri ? { banner_image: bannerUri } : {}),
              ...(iconUri ? { icon: iconUri } : {}),
              ...(socials.website.trim() ? { external_link: socials.website.trim() } : {}),
              links,
            },
        address
      )
      metadataUri = normalizeIpfsUri(await uploadObjectToIPFS(metadata))
      // Hashed over the JSON as the gateway serves it — the pinning service re-serializes what we post
      if (isLukso) metadataHash = await hashIpfsContent(metadataUri)
    } catch (err) {
      toast(err.message || 'Failed to upload drop details', 'error')
      setIsUploading(false)
      return
    }
    setIsUploading(false)

    // The '#' terminator makes baseURI + id resolve to the one metadata file (gateways ignore fragments)
    const collectionParams = encodeCollectionParams(standardId, {
      name: name.trim(),
      symbol,
      baseURI: `${metadataUri}#`,
      uriSuffix: '',
      tokenURI: metadataUri,
      contractURI: metadataUri,
      lsp4MetadataValue: encodeVerifiableURIFromDigest(metadataUri, metadataHash),
      // Unverified on purpose: one digest cannot cover per-token metadata after a reveal
      baseURIValue: encodeVerifiableURI(`${metadataUri}#`),
      // LSP4TokenType must be COLLECTION (a drop mints many ids); immutable after deploy
      tokenType: LSP4_TOKEN_TYPE_COLLECTION,
      royaltyReceiver: address,
      royaltyBps,
      burnable,
    })

    // Token prices are parsed in the token's own decimals; native is 18 on every supported chain
    let decimalsByToken
    try {
      const tokens = [...new Set(phases.filter((phase) => Number(phase.price) > 0 && isAddress(phase.token)).map((phase) => phase.token))]
      const decimalsList = await Promise.all(
        tokens.map((token) =>
          publicClient.readContract({
            address: token,
            abi: [{ name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }],
            functionName: 'decimals',
          }),
        ),
      )
      decimalsByToken = Object.fromEntries(tokens.map((token, index) => [token.toLowerCase(), Number(decimalsList[index])]))
    } catch {
      toast('Could not read that token — check the address is right for this network', 'error')
      return
    }

    const phaseInputs = phases.map((phase) => ({
      name: (phase.name ?? '').trim(),
      // Unset start = now, minus a minute of slack for lagging block timestamps
      startTime: phase.startAt ? toUnixSeconds(phase.startAt) : BigInt(Math.floor(Date.now() / 1000) - 60),
      endTime: phase.endAt ? toUnixSeconds(phase.endAt) : 0n,
      paused: phase.manualStart,
      // A free phase must name no token
      token: Number(phase.price) > 0 && isAddress(phase.token) ? phase.token : zeroAddress,
      isLsp7: Boolean(Number(phase.price) > 0 && isAddress(phase.token) && phase.isLsp7),
      price:
        Number(phase.price) > 0 && isAddress(phase.token)
          ? parseUnits(phase.price, decimalsByToken[phase.token.toLowerCase()] ?? 18)
          : parseEther(phase.price || '0'),
      perWallet: BigInt(phase.perWallet.trim() === '' ? 0 : phase.perWallet),
      allocation: BigInt(phase.allocation.trim() === '' ? 0 : phase.allocation),
      gate: phase.gate,
      gateAsset: zeroAddress,
      gateData: phase.gate === DROP_GATES.COMMUNITY ? toHex(BigInt(phase.communityId), { size: 32 }) : zeroHash,
      gateMin: 0n,
    }))

    const args = [address, BigInt(standardId), collectionParams, BigInt(supplyCount), BigInt(referralBps), phaseInputs]

    // Read fresh: createDrop requires msg.value == creationFee exactly, and an admin can change it mid-session
    let value
    try {
      value = await publicClient.readContract({ abi: dropsAbi, address: dropsAddress, functionName: 'creationFee' })
    } catch {
      toast('Could not read the creation fee — check your connection and try again', 'error')
      return
    }

    // Burner sessions send msg.value 0, so paid creation goes through the connected wallet
    const session =
      value === 0n
        ? await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))
        : { active: false }

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
        await settle(dropRefFromLogs(burnerReceipt?.logs))
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

  const isAwaitingWallet = isPending || isSubmittingBurner
  const createSteps = [
    {
      key: 'upload',
      label: 'Prepare the drop',
      hint: 'Pinning the artwork and details to IPFS.',
      active: isUploading,
      done: !isUploading && (isAwaitingWallet || isConfirming || isPublishingAllowlist || Boolean(created)),
    },
    {
      key: 'sign',
      label: 'Confirm in your wallet',
      hint: 'Deploys your collection and writes the mint schedule.',
      active: isAwaitingWallet,
      done: isConfirming || isPublishingAllowlist || Boolean(created),
    },
    {
      key: 'confirm',
      label: 'Wait for the network',
      hint: 'The transaction is in a block soon.',
      active: isConfirming,
      done: isPublishingAllowlist || Boolean(created),
    },
    ...(needsAllowlist
      ? [
          {
            key: 'allowlist',
            label: 'Publish the allowlist',
            hint: `Written onchain in batches of ${ALLOWLIST_BATCH_SIZE} — one signature each.`,
            active: isPublishingAllowlist,
            done: Boolean(created),
          },
        ]
      : []),
  ]
  const currentStep = createSteps.findIndex((step) => step.active)
  const stepsStarted = isBusy || Boolean(created)

  const gateOptions = [
    { id: DROP_GATES.OPEN, label: 'Open', icon: <LockSimpleOpenIcon size={13} /> },
    { id: DROP_GATES.ALLOWLIST, label: 'Allowlist', icon: <LockSimpleIcon size={13} /> },
    ...(followerSystem ? [{ id: DROP_GATES.FOLLOWERS, label: 'Followers', icon: <UsersIcon size={13} /> }] : []),
    ...(hasCommunityGate ? [{ id: DROP_GATES.COMMUNITY, label: 'Community', icon: <UsersThreeIcon size={13} /> }] : []),
  ]

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.dropDialog}
      aria-label="Create an NFT drop"
      style={networkColorStyle(chainInfo)}
      onClick={(e) => e.stopPropagation()}
      // Nested NativeDialog: stop close/cancel here or the composer closes too
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

        {step === 'form' && (
          <button
            type="button"
            className={clsx(styles.dropDialog__reset, resetArmed && styles['dropDialog__reset--armed'])}
            onClick={() => (resetArmed ? handleReset() : setResetArmed(true))}
            disabled={isBusy}
            title="Clear every field and the saved draft"
          >
            {resetArmed ? 'Tap again to clear' : 'Reset'}
          </button>
        )}
        <h3>{step === 'review' ? 'Review' : step === 'live' ? 'Live' : 'NFT drop'}</h3>
      </header>

      {step === 'form' && (
        <form className={styles.dropDialog__body} onSubmit={handleReview}>
          {draftSaved && (
            <p className={styles.dropDialog__draft}>
              <span className={styles.dropDialog__draftDot} aria-hidden="true" />
              Saved as a draft — you can close this and pick it up later.
            </p>
          )}
          <div className={styles.dropDialog__identity}>
            <label className={clsx(styles.dropDialog__image, imageUrl && styles['dropDialog__image--filled'])}>
              {imageUrl ? <img src={imageUrl} alt="" /> : <ImageIcon size={22} weight="light" />}
              <input type="file" accept="image/*" onChange={handleImageSelect} disabled={isBusy} hidden />
            </label>
            <div className={styles.dropDialog__imageHint}>
              {imageUrl ? (
                <>
                  <strong title={imageName || undefined}>{imageName || 'Drop artwork'}</strong>
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

              <label className={clsx(styles.dropDialog__banner, icon && styles['dropDialog__banner--filled'])}>
                {icon ? (
                  <img src={resolveStorageImageUrl(icon)} alt="" />
                ) : (
                  <span>
                    <ImageIcon size={18} weight="light" />
                    Upload icon {isIconUploading && <em>uploading…</em>}
                  </span>
                )}
                <input type="file" accept="image/*" onChange={handleIconSelect} disabled={isBusy} hidden />
              </label>
              <small className={styles.dropDialog__bannerHint}>
                The square logo wallets and explorers show beside the asset. Square, 256 × 256 or larger.
              </small>

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

          {families.length > 1 && (
            <div className={styles.dropDialog__presets}>
              <span>Token family</span>
              <div>
                {families.map((option) => (
                  <Tooltip key={option} content={`Deploys ${dropFamilyLabel(option)} collections.`}>
                    <button
                      type="button"
                      className={clsx(activeFamily === option && styles['dropDialog__preset--active'])}
                      onClick={() => setFamily(option)}
                      disabled={isBusy}
                    >
                      {option === 'lsp' ? 'LSP' : 'ERC'}
                    </button>
                  </Tooltip>
                ))}
              </div>
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

          {phases.map((phase, index) => (
            <div key={index} className={styles.dropDialog__phase}>
              {phases.length > 1 && (
                <div className={styles.dropDialog__phaseHead}>
                  <strong>Stage {index + 1}</strong>
                  <button type="button" onClick={() => removePhase(index)} disabled={isBusy} aria-label={`Remove phase ${index + 1}`}>
                    <XIcon size={12} />
                    Remove
                  </button>
                </div>
              )}

              <label className={styles.dropDialog__field}>
                <span>
                  Stage name <em>optional</em>
                </span>
                <input
                  type="text"
                  value={phase.name}
                  placeholder={`e.g. ${index === 0 ? 'Presale' : 'Public'}`}
                  // Phase names are capped in bytes, not characters
                  onChange={(e) => {
                    let next = e.target.value
                    while (phaseNameByteLength(next) > MAX_PHASE_NAME_BYTES) next = next.slice(0, -1)
                    updatePhase(index, { name: next })
                  }}
                  disabled={isBusy}
                />
                <small>Your own label for this stage — stored onchain, shown to minters.</small>
              </label>

              <div className={styles.dropDialog__row}>
                <label className={styles.dropDialog__field}>
                  <span>Price ({phase.token ? 'token' : nativeSymbol})</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={phase.price}
                    placeholder="Free"
                    onChange={(e) => updatePhase(index, { price: e.target.value })}
                    disabled={isBusy}
                  />
                  <small>Empty or 0 = free mint</small>
                </label>
                <label className={styles.dropDialog__field}>
                  <span>Per-wallet limit</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={phase.perWallet}
                    placeholder="Unlimited"
                    onChange={(e) => updatePhase(index, { perWallet: e.target.value })}
                    disabled={isBusy}
                  />
                </label>
              </div>

              <div className={styles.dropDialog__row}>
                <label className={styles.dropDialog__field}>
                  <span>Starts</span>
                  <input
                    type="datetime-local"
                    value={phase.startAt}
                    onChange={(e) => updatePhase(index, { startAt: e.target.value })}
                    disabled={isBusy || phase.manualStart}
                  />
                  <small>{phase.manualStart ? 'Waits for your Start' : 'Empty = right away'}</small>
                </label>
                <label className={styles.dropDialog__field}>
                  <span>Ends</span>
                  <input
                    type="datetime-local"
                    value={phase.endAt}
                    onChange={(e) => updatePhase(index, { endAt: e.target.value })}
                    disabled={isBusy}
                  />
                  <small>Empty = open-ended</small>
                </label>
              </div>

              {phases.length > 1 && !isOpenEdition && (
                <label className={styles.dropDialog__field}>
                  <span>
                    <Tooltip
                      content={`The most this phase may sell, out of the drop's ${supplyCount}. Leave it empty and this phase can sell the whole drop. It caps this lane rather than reserving supply for it — what guarantees a presale its turn is running before the public phase, not this number.`}
                    >
                      <span className={styles.dropDialog__labelHint}>Allocation</span>
                    </Tooltip>
                    <em className={styles.dropDialog__counter}>of {supplyCount}</em>
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={phase.allocation}
                    placeholder="No cap — draws from the drop's supply"
                    onChange={(e) => updatePhase(index, { allocation: e.target.value })}
                    disabled={isBusy}
                  />
                  <small>Caps what this phase can sell — e.g. 3 of {supplyCount} held back for a presale.</small>
                </label>
              )}

              <div className={styles.dropDialog__presets}>
                <span>Minting opens</span>
                <div>
                  <button
                    type="button"
                    className={clsx(!phase.manualStart && styles['dropDialog__preset--active'])}
                    onClick={() => updatePhase(index, { manualStart: false })}
                    disabled={isBusy}
                  >
                    On the clock
                  </button>
                  <button
                    type="button"
                    className={clsx(phase.manualStart && styles['dropDialog__preset--active'])}
                    onClick={() => updatePhase(index, { manualStart: true })}
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
                      className={clsx(phase.gate === option.id && styles['dropDialog__preset--active'])}
                      onClick={() => updatePhase(index, { gate: option.id })}
                      disabled={isBusy}
                    >
                      {option.icon}
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {Number(phase.price) > 0 && (
                <div className={styles.dropDialog__presets}>
                  <span>Paid in</span>
                  <div>
                    <button
                      type="button"
                      className={clsx(!phase.token && styles['dropDialog__preset--active'])}
                      onClick={() => updatePhase(index, { token: '', isLsp7: false })}
                      disabled={isBusy}
                    >
                      {nativeSymbol}
                    </button>
                    <Tooltip content="Price this phase in an ERC20 or LSP7 instead. Minters approve the token first, so it costs them one extra transaction.">
                      <button
                        type="button"
                        className={clsx(phase.token && styles['dropDialog__preset--active'])}
                        onClick={() => updatePhase(index, { token: phase.token || '0x', isLsp7: isLuksoChain(chainId) })}
                        disabled={isBusy}
                      >
                        A token
                      </button>
                    </Tooltip>
                  </div>
                </div>
              )}

              {Number(phase.price) > 0 && phase.token && (
                <label className={styles.dropDialog__field}>
                  <span>Token address</span>
                  <input
                    type="text"
                    value={phase.token}
                    placeholder="0x…"
                    onChange={(e) => updatePhase(index, { token: e.target.value.trim() })}
                    disabled={isBusy}
                    spellCheck={false}
                  />
                  {/* LUKSO carries both LSP7 and ERC20 tokens, so the kind cannot be inferred from the chain */}
                  {isLuksoChain(chainId) && (
                    <span className={styles.dropDialog__tokenKind}>
                      <button
                        type="button"
                        className={clsx(phase.isLsp7 && styles['dropDialog__preset--active'])}
                        onClick={() => updatePhase(index, { isLsp7: true })}
                        disabled={isBusy}
                      >
                        LSP7
                      </button>
                      <button
                        type="button"
                        className={clsx(!phase.isLsp7 && styles['dropDialog__preset--active'])}
                        onClick={() => updatePhase(index, { isLsp7: false })}
                        disabled={isBusy}
                      >
                        ERC20
                      </button>
                    </span>
                  )}
                  <small>Priced in the token&rsquo;s own units, to its own decimals.</small>
                </label>
              )}

              {phase.gate === DROP_GATES.COMMUNITY && (
                <label className={styles.dropDialog__field}>
                  <span>Which community</span>
                  <select
                    value={phase.communityId}
                    onChange={(e) => updatePhase(index, { communityId: e.target.value })}
                    disabled={isBusy}
                  >
                    <option value="">Choose a community…</option>
                    {communities.map((community) => (
                      <option key={community.id} value={community.id}>
                        {community.name}
                        {community.tag ? ` · ${community.tag}` : ''}
                      </option>
                    ))}
                  </select>
                  <small>Members can mint; anyone banned from it can&rsquo;t, whatever their membership says.</small>
                </label>
              )}
            </div>
          ))}

          {phases.length < MAX_PHASES && (
            <button type="button" className={styles.dropDialog__addPhase} onClick={addPhase} disabled={isBusy}>
              <PlusIcon size={13} />
              Add a phase
              <em>{phases.length} of {MAX_PHASES}</em>
            </button>
          )}

          {needsAllowlist && (
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
              <small>
                One address per line, shared by every allowlist phase — the engine keeps one list per drop. Written
                onchain right after the drop is created, in batches of {ALLOWLIST_BATCH_SIZE} with one signature each.
              </small>
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
            <span>Burning</span>
            <div>
              <button type="button" className={clsx(!burnable && styles['dropDialog__preset--active'])} onClick={() => setBurnable(false)} disabled={isBusy}>
                Off
              </button>
              <button type="button" className={clsx(burnable && styles['dropDialog__preset--active'])} onClick={() => setBurnable(true)} disabled={isBusy}>
                On
              </button>
            </div>
            <small>
              {burnable
                ? 'Holders can permanently destroy their own tokens — needed for burn-to-claim and redeemables. An address they approve (a marketplace, a redemption contract) can burn on their behalf.'
                : 'Nobody can destroy a token once minted.'}{' '}
              Fixed forever at launch, because collectors decide whether to mint on this.
            </small>
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
              <dt>Network</dt>
              <dd>
                {chainInfo?.name ?? `Chain ${chainId}`}
                {isWrongChain && <small>Your wallet is on a different network — you&rsquo;ll be asked to switch</small>}
              </dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>
                {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'}
                <small>owns the contract, and receives royalties and mint proceeds</small>
              </dd>
            </div>
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
            {phases.map((phase, index) => {
              const phasePrice = phase.price.trim() === '' ? 0 : Number(phase.price)
              const cap = phase.perWallet.trim() === '' || Number(phase.perWallet) === 0 ? 'unlimited per wallet' : `${phase.perWallet} per wallet`
              const allocation = phase.allocation.trim() === '' || Number(phase.allocation) === 0 ? null : `${phase.allocation} reserved`
              const opens = phase.manualStart
                ? 'opens when you press start'
                : phase.startAt
                  ? `opens ${new Date(phase.startAt).toLocaleString()}`
                  : 'opens immediately'

              return (
                <div key={index}>
                  <dt>{phase.name?.trim() || (phases.length > 1 ? `Stage ${index + 1}` : 'Mint stage')}</dt>
                  <dd>
                    {phasePrice === 0 ? 'Free' : `${phase.price} ${nativeSymbol}`}
                    <small>{gateOptions.find((option) => option.id === phase.gate)?.label ?? 'Open'} · {cap}</small>
                    <small>
                      {opens} · {phase.endAt ? `until ${new Date(phase.endAt).toLocaleString()}` : 'open-ended'}
                    </small>
                    {allocation && <small>{allocation}</small>}
                  </dd>
                </div>
              )
            })}
            {needsAllowlist && (
              <div>
                <dt>Allowlisted</dt>
                <dd>
                  {allowlist.length} addresses
                  <small>shared by every allowlist phase</small>
                </dd>
              </div>
            )}
            <div>
              <dt>Royalty</dt>
              <dd>{royaltyBps === 0 ? 'None' : `${formatBps(royaltyBps)} to you`}</dd>
            </div>
            <div>
              <dt>Burning</dt>
              <dd>
                {burnable ? 'Holders can burn their tokens' : 'Disabled'}
                <small>permanent — this cannot be changed after launch</small>
              </dd>
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
            {activeFlatMintFee > 0n && (
              <div>
                <dt>Minter pays</dt>
                <dd>
                  {formatEther(activeFlatMintFee)} {nativeSymbol} per item, on top of your price
                  <small>a platform fee — it does not come out of your earnings</small>
                </dd>
              </div>
            )}
            <div>
              <dt>Creation fee</dt>
              <dd>
                {creationFee === undefined
                  ? 'Reading…'
                  : creationFee === 0n
                    ? 'Free'
                    : `${formatEther(creationFee)} ${nativeSymbol}`}
              </dd>
            </div>
          </dl>

          <p className={styles.dropDialog__note}>
            You own the collection contract from its first block. A mint stage is fixed forever once created — check the
            numbers above.
          </p>

          {standardReady === false && (
            <p className={styles.dropDialog__note}>
              {dropStandardLabel(standardId)} drops aren&rsquo;t enabled on this network yet — no deployer is registered for
              this standard.
            </p>
          )}

          {stepsStarted && (
            <div className={styles.dropDialog__steps}>
              <div className={styles.dropDialog__stepsHead}>
                <strong>Creating your drop</strong>
                <span>
                  {Math.min(currentStep === -1 ? createSteps.length : currentStep + 1, createSteps.length)} / {createSteps.length}
                </span>
              </div>

              <ol>
                {createSteps.map((step, index) => (
                  <li
                    key={step.key}
                    className={clsx(step.done && styles['dropDialog__step--done'], step.active && styles['dropDialog__step--active'])}
                  >
                    <span className={styles.dropDialog__stepMark}>
                      {step.done ? <CheckCircleIcon size={16} weight="fill" /> : index + 1}
                    </span>
                    <span className={styles.dropDialog__stepText}>
                      <strong>{step.label}</strong>
                      <small>{step.hint}</small>
                    </span>
                  </li>
                ))}
              </ol>

              <small className={styles.dropDialog__stepsFoot}>
                Keep this open until it finishes. Nothing is lost if a step fails — you can try again from here.
              </small>
            </div>
          )}

          <button
            type="button"
            className={styles.dropDialog__submit}
            onClick={handleCreate}
            disabled={isBusy || !address || standardReady === false}
          >
            <ImageIcon size={16} weight="fill" />
            {isBusy ? (createSteps[currentStep]?.label ?? 'Working…') : 'Create drop'}
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
