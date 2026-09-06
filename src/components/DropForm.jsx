'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { formatEther, isAddress, parseEther, parseEventLogs, parseUnits, toHex, zeroAddress, zeroHash } from 'viem'
import { useConnection, usePublicClient, useReadContract, useTransactionReceipt, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { useClientMounted } from '@/hooks/useClientMount'
import { usePaymentToken } from '@/hooks/usePaymentToken'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { hashIpfsContent, uploadFileToIPFS, uploadFolderToIPFS, uploadObjectToIPFS, withAuthor } from '@/lib/ipfs'
import { normalizeIpfsUri, resolveStorageImageUrl } from '@/lib/storageHelper'
import { networkColorStyle } from '@/lib/networkColors'
import { describeWalletError } from '@/lib/walletErrors'
import { isUniversalProfile } from '@/lib/lsp3'
import { ERC725Y_SET_DATA_BATCH_ABI, encodeIssuedAssetAppend, issuedAssetInterfaceId, readIssuedAssetListing } from '@/lib/lsp12'
import { metadataSuffix } from '@/lib/dropUpload'
import { MAX_TEMPLATE_TOKENS, buildTemplateMetadataFiles } from '@/lib/dropUploadPlan'
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
  describeSchedule,
  emptySchedule,
  encodeCollectionParams,
  encodeVerifiableURI,
  encodeVerifiableURIFromDigest,
  isAssetGate,
  isLuksoChain,
  isLuksoStandard,
  LSP4_TOKEN_TYPE_COLLECTION,
  MAX_PHASE_NAME_BYTES,
  isValidSplit,
  MAX_SPLIT_PAYEES,
  normalizeAllowlist,
  predictSplitAddress,
  toSplitPayees,
  phaseNameByteLength,
  resolveSchedule,
  sanitizeSchedule,
  scheduleErrorMessage,
  scheduleFollowing,
  scheduleIsSet,
} from '@/lib/drops'
import dropsAbi from '@/abis/HupDrops.json'
import { toast } from '@/components/NextToast'
import {
  BroomIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ImageIcon,
  InfoIcon,
  PercentIcon,
  PlusIcon,
  ShareNetworkIcon,
  XIcon,
} from '@phosphor-icons/react'
import DropArtworkUpload from './DropArtworkUpload'
import DropChainPicker from './DropChainPicker'
import Profile from './Profile'
import DropGateAsset from './DropGateAsset'
import DropGatePicker, { dropGateOptions } from './DropGatePicker'
import DropPayeeTable, { emptyPayee } from './DropPayeeTable'
import DropPreviewCard from './DropPreviewCard'
import DropTokenIdentity from './DropTokenIdentity'
import DropWhenPicker from './DropWhenPicker'
import InfoHint from './ui/InfoHint'
import ToggleSwitch from './ui/ToggleSwitch'
import Tooltip from './ui/Tooltip'
import styles from './DropForm.module.scss'

const MAX_NAME_LENGTH = 48
const MAX_SYMBOL_LENGTH = 10
const MAX_DESCRIPTION_LENGTH = 280
const MAX_TOKEN_NAME_LENGTH = 32
const MAX_TOKEN_DESCRIPTION_LENGTH = 280

// Must stay within the collections' MAX_ROYALTY_BPS (1000) and the engine's MAX_REFERRAL_BPS (5000)
const MAX_ROYALTY_BPS = 1000
const MAX_REFERRAL_BPS = 5000
const DEFAULT_ROYALTY_BPS = 100
const ROYALTY_PRESETS = [0, 100, 500, 1000]
const REFERRAL_PRESETS = [0, 100, 500, 1000]

const percentFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const cutFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 4 })
const countFormat = new Intl.NumberFormat('en')

const bpsFromPercent = (value, maxBps) => {
  const percent = Number(value)
  if (!Number.isFinite(percent) || percent <= 0) return 0
  return Math.min(Math.round(percent * 100), maxBps)
}

/** Snaps a typed percent into range, so a rate field never shows one the contract would reject. */
const percentHandler = (setPercent, maxBps) => (value) => {
  if (value === '') {
    setPercent('')
    return
  }
  const percent = Number(value)
  if (!Number.isFinite(percent)) return
  const clamped = Math.min(Math.max(percent, 0), maxBps / 100)
  setPercent(clamped === percent ? value : String(clamped))
}

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

/** Initials for a multi-word name, the word itself for a one-word one — a symbol nobody has to invent. */
const deriveSymbol = (value) => {
  const words = String(value ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  return words.length > 1 ? normalizeSymbol(words.map((word) => word[0]).join('')) : normalizeSymbol(words[0]).slice(0, 6)
}

/** The token name a template starts from, once the collection has a name to derive it from. */
const deriveTokenBaseName = (value) => (value.trim() ? `${value.trim()} #` : '')

/* A <option> cannot be ellipsised in CSS — text-overflow does not apply to it — and a long one
   sizes the whole <select>, which then drags the field's column wider than the form. So the label
   is cut in the string, where it actually works. */
const MAX_COMMUNITY_LABEL = 34

const truncateLabel = (value, max) => {
  const text = String(value ?? '').trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** Mirrors the engine's MAX_PHASES */
const MAX_PHASES = 8

const emptyPhase = (schedule) => ({
  name: '',
  schedule: schedule ?? emptySchedule(),
  price: '',
  perWallet: '',
  allocation: '',
  gate: DROP_GATES.OPEN,
  communityId: '',
  gateAsset: '',
  gateMin: '',
  gateTokenId: '',
  token: '',
  isLsp7: false,
})

/**
 * The form's one upload outline, shared by the collection image, the banner and the icon.
 *
 * Drawn rather than bordered: `border-style: dashed` leaves the dash length to the browser, and
 * what it picks is far finer than an empty target needs to read as an invitation. `round` turns
 * the same rect into the circle the collection image wants.
 */
const DashedFrame = ({ round = false }) => (
  <svg className={styles.dropForm__frame} aria-hidden="true">
    <rect width="100%" height="100%" rx={round ? '50%' : 16} />
  </svg>
)

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
    const royalty = (value) => (Number.isInteger(value) && value >= 0 && value <= MAX_ROYALTY_BPS ? value : DEFAULT_ROYALTY_BPS)
    const referral = (value) => (Number.isInteger(value) && value >= 0 && value <= MAX_REFERRAL_BPS ? value : 0)
    const payees = (value) =>
      Array.isArray(value) ? value.slice(0, MAX_SPLIT_PAYEES).map((row) => ({ address: str(row?.address, 42), percent: str(row?.percent, 10) })) : null

    /* 'live' is deliberately not restorable: the drop it referred to is already created, and
       nothing about that creation is kept here. A restored draft always has a step to go back to. */
    const RESUMABLE = ['chain', 'form', 'artwork', 'payout', 'review']

    return {
      step: RESUMABLE.includes(parsed.step) ? parsed.step : 'chain',
      image: str(parsed.image, 200),
      imageName: str(parsed.imageName, 200),
      banner: str(parsed.banner, 200),
      icon: str(parsed.icon, 200),
      name: str(parsed.name, MAX_NAME_LENGTH),
      symbol: normalizeSymbol(str(parsed.symbol, MAX_SYMBOL_LENGTH)),
      description: str(parsed.description, MAX_DESCRIPTION_LENGTH),
      shape: parsed.shape === 'editions' ? 'editions' : 'numbered',
      supply: str(parsed.supply, 20),
      tokenBaseName: str(parsed.tokenBaseName, MAX_TOKEN_NAME_LENGTH),
      tokenDescription: str(parsed.tokenDescription, MAX_TOKEN_DESCRIPTION_LENGTH),
      phases: Array.isArray(parsed.phases)
        ? parsed.phases.slice(0, MAX_PHASES).map((phase) => ({
            schedule: sanitizeSchedule(phase?.schedule),
            price: str(phase?.price, 40),
            perWallet: str(phase?.perWallet, 20),
            allocation: str(phase?.allocation, 20),
            gate: Object.values(DROP_GATES).includes(phase?.gate) ? phase.gate : DROP_GATES.OPEN,
            communityId: str(phase?.communityId, 20),
            gateAsset: str(phase?.gateAsset, 42),
            gateMin: str(phase?.gateMin, 40),
            gateTokenId: str(phase?.gateTokenId, 40),
            token: str(phase?.token, 42),
            name: str(phase?.name, MAX_PHASE_NAME_BYTES),
            isLsp7: Boolean(phase?.isLsp7),
          }))
        : null,
      allowlistText: str(parsed.allowlistText, 100_000),
      royaltyBps: royalty(parsed.royaltyBps),
      burnable: Boolean(parsed.burnable),
      featured: Boolean(parsed.featured),
      payoutMode: ['me', 'address', 'split'].includes(parsed.payoutMode) ? parsed.payoutMode : 'me',
      payoutAddress: str(parsed.payoutAddress, 42),
      payoutRows: payees(parsed.payoutRows),
      royaltyMode: parsed.royaltyMode === 'split' ? 'split' : 'me',
      royaltyRows: payees(parsed.royaltyRows),
      pendingHash: /^0x[0-9a-fA-F]{64}$/.test(parsed.pendingHash ?? '') ? parsed.pendingHash : '',
      referralBps: referral(parsed.referralBps),
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
 * Drop Form
 * Launches an NFT drop through the HupDrops engine: deploys a creator-owned collection
 * (ERC721/ERC1155, or LSP7/LSP8 on LUKSO) and fixes its immutable mint schedule at creation.
 *
 * This is the only way a drop gets made. It is a page rather than a modal because the flow it
 * runs is not modal-shaped: an artwork upload that takes minutes, a preview worth keeping beside
 * the fields, and a draft the creator should be able to walk away from. The composer links here
 * and pins the finished drop afterwards, rather than carrying a second copy of this form.
 *
 * @param {number} props.chainId The chain to deploy on — chosen in the first step, owned by the caller.
 * @param {Function} [props.onCreated] Receives { dropId, chainId, collection, standardId, name, symbol, image } once the tx confirms.
 */
export default function DropForm({ chainId, onCreated }) {
  /* The draft lives in localStorage, which the server cannot see — so the server renders step one
     with empty fields while the client renders wherever the creator left off. Waiting for the mount
     is what NetworkSelect does with the same problem, and it costs one frame. */
  const mounted = useClientMounted()
  const { address, chain: walletChain } = useConnection()

  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === chainId), [chainId])
  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops
  // HupNativeBalance: lets an asset gate read the wallet's own coin balance; '' where not deployed
  const nativeGate = CONTRACTS[`chain${chainId}`]?.nativeGate || ''
  const publicClient = usePublicClient({ chainId })
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'
  const families = useMemo(() => dropStandardFamilies(chainId ?? 0), [chainId])
  const [family, setFamily] = useState(families[0])
  const activeFamily = families.includes(family) ? family : families[0]
  const standards = useMemo(() => dropStandardsFor(chainId ?? 0, activeFamily), [chainId, activeFamily])

  const [draft] = useState(loadDropDraft)

  const [chosenStep, setStep] = useState(draft?.step ?? 'chain')
  const [image, setImage] = useState(draft?.image ?? '')
  const [imageName, setImageName] = useState(draft?.imageName ?? '')
  const [showBranding, setShowBranding] = useState(false)
  const [banner, setBanner] = useState(draft?.banner ?? '')
  const [icon, setIcon] = useState(draft?.icon ?? '')
  const [isIconUploading, setIsIconUploading] = useState(false)
  const [isBannerUploading, setIsBannerUploading] = useState(false)
  const [socials, setSocials] = useState(
    draft?.socials ?? { website: '', x: '', discord: '', telegram: '', instagram: '' },
  )
  const [name, setName] = useState(draft?.name ?? '')
  const [symbol, setSymbol] = useState(draft?.symbol ?? '')
  // The symbol follows the name until someone types their own; clearing it hands the field back
  const [symbolTouched, setSymbolTouched] = useState(Boolean(draft?.symbol))
  const [description, setDescription] = useState(draft?.description ?? '')
  const [shape, setShape] = useState(draft?.shape ?? 'numbered')
  const [supply, setSupply] = useState(draft?.supply ?? '')
  const [phases, setPhases] = useState(draft?.phases?.length ? draft.phases : [emptyPhase()])
  const [allowlistText, setAllowlistText] = useState(draft?.allowlistText ?? '')
  const [royaltyPercent, setRoyaltyPercent] = useState(String((draft?.royaltyBps ?? DEFAULT_ROYALTY_BPS) / 100))
  const royaltyBps = useMemo(() => bpsFromPercent(royaltyPercent, MAX_ROYALTY_BPS), [royaltyPercent])
  const [burnable, setBurnable] = useState(draft?.burnable ?? false)
  const [featured, setFeatured] = useState(draft?.featured ?? false)
  // Where the money goes: mint proceeds and resale royalties, each to the creator or to a split
  const [payoutMode, setPayoutMode] = useState(draft?.payoutMode ?? 'me')
  const [payoutAddress, setPayoutAddress] = useState(draft?.payoutAddress ?? '')
  const [payoutRows, setPayoutRows] = useState(draft?.payoutRows?.length ? draft.payoutRows : [emptyPayee()])
  const [royaltyMode, setRoyaltyMode] = useState(draft?.royaltyMode ?? 'me')
  const [royaltyRows, setRoyaltyRows] = useState(draft?.royaltyRows?.length ? draft.royaltyRows : [emptyPayee()])
  const [referralPercent, setReferralPercent] = useState(String((draft?.referralBps ?? 0) / 100))
  const referralBps = useMemo(() => bpsFromPercent(referralPercent, MAX_REFERRAL_BPS), [referralPercent])
  const [created, setCreated] = useState(null)
  const [isImageUploading, setIsImageUploading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmittingBurner, setIsSubmittingBurner] = useState(false)
  const [resetArmed, setResetArmed] = useState(false)
  const [showPhaseHelp, setShowPhaseHelp] = useState(false)
  const [draftSaved, setDraftSaved] = useState(false)

  // --- Per-token metadata: a pinned zip, or the template that stands in for one ---
  const [artworkPin, setArtworkPin] = useState(null)
  const [tokenBaseName, setTokenBaseName] = useState(draft?.tokenBaseName ?? '')
  const [tokenBaseTouched, setTokenBaseTouched] = useState(Boolean(draft?.tokenBaseName))
  const [tokenDescription, setTokenDescription] = useState(draft?.tokenDescription ?? '')

  const { data: hash, isPending, mutate: writeContract, error: submitError, reset: resetWrite } = useWriteContract()
  /* Polls until the receipt exists, however long the chain takes. A receipt query that gave up
     on an RPC hiccup once unlocked the Create button mid-flight, and a creator deployed twice. */
  const {
    isSuccess: isConfirmed,
    isError: isReceiptStalled,
    data: receipt,
    refetch: refetchReceipt,
  } = useWaitForTransactionReceipt({ hash, chainId, query: { enabled: Boolean(hash), retry: true, retryDelay: 5_000 } })
  // Locked from the hash until a receipt, whatever the query's own state says in between
  const awaitingReceipt = Boolean(hash) && !receipt
  const explorerUrl = chainInfo?.blockExplorers?.default?.url?.replace(/\/$/, '')
  const shortHash = (value) => (value ? `${value.slice(0, 10)}…${value.slice(-6)}` : '')
  // A hash from an earlier visit that never confirmed while the page was open — see the review note
  const restoredPendingHash = draft?.pendingHash ?? ''
  const [pendingDismissed, setPendingDismissed] = useState(false)
  // Ask the chain what became of it, so the warning can answer itself instead of sending the creator to an explorer
  const { data: restoredReceipt } = useTransactionReceipt({
    hash: restoredPendingHash || undefined,
    chainId,
    query: { enabled: Boolean(restoredPendingHash) && !hash && !pendingDismissed },
  })
  const restoredDrop = restoredReceipt?.status === 'success' ? dropRefFromLogs(restoredReceipt.logs) : null
  const restoredReverted = restoredReceipt?.status === 'reverted'
  // A remembered hash blocks a second Create until it is known to have failed, or the creator says so
  const pendingBlocks = Boolean(restoredPendingHash) && !hash && !pendingDismissed && !restoredReverted

  useEffect(() => {
    const hasPhaseContent = phases.some(
      (phase) => phase.name.trim() || phase.price.trim() || phase.perWallet.trim() || scheduleIsSet(phase.schedule),
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
          step: chosenStep,
          image,
          imageName,
          banner,
          icon,
          name,
          symbol,
          description,
          shape,
          supply,
          tokenBaseName,
          tokenDescription,
          phases,
          allowlistText,
          royaltyBps,
          burnable,
          featured,
          payoutMode,
          payoutAddress,
          payoutRows,
          royaltyMode,
          royaltyRows,
          // Survives a reload mid-wait, so the review step can warn before a second Create
          pendingHash: hash ?? (pendingDismissed ? '' : restoredPendingHash),
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
    chosenStep,
    image,
    imageName,
    banner,
    icon,
    name,
    symbol,
    description,
    shape,
    supply,
    tokenBaseName,
    tokenDescription,
    phases,
    allowlistText,
    royaltyBps,
    burnable,
    featured,
    payoutMode,
    payoutAddress,
    payoutRows,
    royaltyMode,
    royaltyRows,
    hash,
    pendingDismissed,
    restoredPendingHash,
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
  const { data: featuredFee = 0n, error: featuredFeeError } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'featuredFee',
    chainId,
    query: { enabled: Boolean(dropsAddress) },
  })

  /* An engine older than this ABI has no featuredFee() and a six-argument createDrop, so the
     create call would revert at estimate time with nothing useful to show. A revert on this read
     is the tell; a network error is not, and must not lock the form. */
  const engineOutdated = Boolean(featuredFeeError && /returned no data|reverted/i.test(featuredFeeError.shortMessage || featuredFeeError.message || ''))

  // The chain's HupSplits factory as the engine knows it: zero until the admin registers one, and
  // the split tables stay hidden until then rather than promising a revert
  const { data: splitsFactory } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'splits',
    chainId,
    query: { enabled: Boolean(dropsAddress) && !engineOutdated },
  })
  const splitsAvailable = Boolean(splitsFactory && splitsFactory !== zeroAddress)
  const payoutPayees = useMemo(() => toSplitPayees(payoutRows), [payoutRows])
  const royaltyPayees = useMemo(() => toSplitPayees(royaltyRows), [royaltyRows])
  const payoutSplitValid = isValidSplit(payoutPayees)
  const royaltySplitValid = isValidSplit(royaltyPayees)
  const [predicted, setPredicted] = useState({ payout: '', royalty: '' })
  const payoutKey = JSON.stringify(payoutPayees)
  const royaltyKey = JSON.stringify(royaltyPayees)

  // The split address is the commitment, so it is worth showing before anything is signed
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      // Yields before touching state, so the effect body itself writes nothing
      await Promise.resolve()
      if (cancelled) return
      if (!splitsAvailable || !publicClient) {
        setPredicted({ payout: '', royalty: '' })
        return
      }
      const wantPayout = payoutMode === 'split' && payoutSplitValid
      const wantRoyalty = royaltyMode === 'split' && royaltySplitValid
      const [payout, royalty] = await Promise.all([
        wantPayout ? predictSplitAddress({ publicClient, factory: splitsFactory, payees: payoutPayees }).catch(() => '') : '',
        wantRoyalty ? predictSplitAddress({ publicClient, factory: splitsFactory, payees: royaltyPayees }).catch(() => '') : '',
      ])
      if (!cancelled) setPredicted({ payout, royalty })
    }
    run()
    return () => {
      cancelled = true
    }
    // Keyed on the tables' content rather than their array identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitsAvailable, splitsFactory, publicClient, payoutMode, royaltyMode, payoutSplitValid, royaltySplitValid, payoutKey, royaltyKey])

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

  // Own hook instance: sharing `hash` would re-fire the isConfirmed effect once per allowlist batch
  const { writeContractAsync: writeBatchAsync } = useWriteContract()
  const [isPublishingAllowlist, setIsPublishingAllowlist] = useState(false)

  const isBusy = isPending || awaitingReceipt || isUploading || isSubmittingBurner || isImageUploading || isBannerUploading || isIconUploading || isPublishingAllowlist

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

  /* LSP4Creators[] on the new collection names this wallet; explorers only show that as verified
     once the profile lists the collection back in LSP12IssuedAssets[]. The engine cannot write a
     profile's keys, so this is one more signature from the creator — silently skipped for an EOA,
     and always available later from Manage on the drop page. */
  const listOnProfile = async ({ collection, standardId }) => {
    if (!address || !collection || !(await isUniversalProfile(publicClient, address))) return
    try {
      const { count, listed } = await readIssuedAssetListing(publicClient, address, collection)
      if (listed) return
      const { keys, values } = encodeIssuedAssetAppend({
        asset: collection,
        interfaceId: issuedAssetInterfaceId(Number(standardId) === DROP_STANDARDS.LSP8),
        count,
      })
      await writeBatchAsync({ address, abi: ERC725Y_SET_DATA_BATCH_ABI, functionName: 'setDataBatch', args: [keys, values], chainId })
      toast('Listed on your profile — explorers now show you as its verified creator', 'success')
    } catch (err) {
      toast(describeWalletError(err, { fallback: 'Listing on your profile was skipped — you can do it from Manage on the drop page' }), 'error')
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

    if (payload) {
      setCreated(payload)
      setStep('live')
    }
    onCreated?.(payload)

    // After the live step is on screen, so the wallet prompt reads as a follow-up and not a hang
    if (dropRef && isLuksoStandard(dropRef.standardId)) void listOnProfile(dropRef)
  }

  useEffect(() => {
    if (!isConfirmed) return
    // A mined revert is a receipt too — it must never read as "your drop is live"
    if (receipt?.status === 'reverted') {
      toast('The transaction reverted onchain — nothing was created. Check it on the explorer, then try again', 'error')
      resetWrite()
      return
    }
    settle(dropRefFromLogs(receipt?.logs))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const handleReset = () => {
    setImage('')
    setImageName('')
    setBanner('')
    setIcon('')
    setShowBranding(false)
    setSocials({ website: '', x: '', discord: '', telegram: '', instagram: '' })
    setName('')
    setSymbol('')
    setSymbolTouched(false)
    setDescription('')
    setShape('numbered')
    setSupply('')
    setTokenBaseName('')
    setTokenBaseTouched(false)
    setTokenDescription('')
    setArtworkPin(null)
    setPhases([emptyPhase()])
    setAllowlistText('')
    setRoyaltyPercent(String(DEFAULT_ROYALTY_BPS / 100))
    setBurnable(false)
    setFeatured(false)
    setPayoutMode('me')
    setPayoutAddress('')
    setPayoutRows([emptyPayee()])
    setRoyaltyMode('me')
    setRoyaltyRows([emptyPayee()])
    setReferralPercent('0')
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
    setPhases((prev) => (prev.length >= MAX_PHASES ? prev : [...prev, emptyPhase(scheduleFollowing(prev[prev.length - 1]?.schedule))]))

  const removePhase = (index) => setPhases((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))

  const handleRoyaltyPercent = percentHandler(setRoyaltyPercent, MAX_ROYALTY_BPS)
  const handleReferralPercent = percentHandler(setReferralPercent, MAX_REFERRAL_BPS)

  // The allowlist is drop-scoped onchain (`allowlist[dropId][wallet]`), so one list serves every allowlist phase
  const needsAllowlist = phases.some((phase) => phase.gate === DROP_GATES.ALLOWLIST)
  const allowlist = useMemo(
    () => (needsAllowlist ? normalizeAllowlist(allowlistText.split(/[\s,;]+/)) : []),
    [needsAllowlist, allowlistText],
  )
  const firstAllowlistPhase = phases.findIndex((phase) => phase.gate === DROP_GATES.ALLOWLIST)

  const supplyCount = supply.trim() === '' ? 0 : Number(supply)
  const isOpenEdition = supplyCount === 0

  // A half-answered schedule already shows its own warning in the picker, so the button just waits
  const schedulesReady = phases.every((phase) => !resolveSchedule(phase.schedule).error)

  /* Only a numbered collection resolves `baseURI + tokenId`, so only it has per-token metadata
     to prepare — an edition is one artwork by definition. */
  const hasArtworkStep = shape === 'numbered'
  const canTemplate = !isOpenEdition && supplyCount <= MAX_TEMPLATE_TOKENS
  const wantsTemplate = !artworkPin && hasArtworkStep && canTemplate && Boolean(tokenBaseName.trim())

  // Derived, not synchronized: switching to editions mid-flow would otherwise strand the form on
  // an artwork step that no longer exists, with no way back to a rail that never lists it
  const step = !hasArtworkStep && chosenStep === 'artwork' ? 'review' : chosenStep

  const steps = useMemo(
    () => [
      {
        key: 'chain',
        label: 'Network',
        hint: 'A drop lives on one chain forever — the collection is deployed there, and that is where it mints and trades. Pick where this one belongs.',
      },
      {
        key: 'form',
        label: 'Details',
        hint: 'What the collection is and how it sells. Name, ticker, collection type and supply are permanent once deployed, as are burnability and the referral share — artwork, description, links, royalty and where the money goes can all be changed later.',
      },
      ...(hasArtworkStep
        ? [
            {
              key: 'artwork',
              label: 'Artwork',
              hint: 'What each numbered token points at. Upload a zip for per-token art and traits, or let the template number them off the collection artwork.',
            },
          ]
        : []),
      {
        key: 'payout',
        label: 'Payout',
        hint: 'Where the money goes: your share of every mint, and the royalty on resales. Each can be you, one wallet, or a split between several — all changeable later from the manage panel.',
      },
      {
        key: 'review',
        label: 'Review',
        hint: 'Every number the transaction will carry. A mint phase is fixed forever once created, so this is the last look.',
      },
      {
        key: 'live',
        label: 'Live',
        hint: 'Deployed and minting. Share the drop link in a post here and the card mints inline for your community, or take the same link anywhere else you post.',
      },
    ],
    [hasArtworkStep],
  )
  const stepIndex = Math.max(0, steps.findIndex((entry) => entry.key === step))

  const canReview = Boolean(
    image && name.trim() && symbol && !isBusy && creationFee !== undefined && schedulesReady && (!needsAllowlist || allowlist.length > 0),
  )

  /* Every per-phase rule the engine enforces, checked when the schedule leaves the form and again
     before Create: a draft restored straight into review never went through Continue, and one such
     draft reached the chain with a zero gate asset and reverted InvalidGateConfig after 4M gas. */
  const phasesProblem = () => {
    for (const [index, phase] of phases.entries()) {
      const label = phases.length > 1 ? `Phase ${index + 1}: ` : ''
      const { error: scheduleError } = resolveSchedule(phase.schedule)

      if (scheduleError) return scheduleErrorMessage(scheduleError, label)
      if (!isOpenEdition && Number(phase.allocation || 0) > supplyCount) return `${label}the allocation can't exceed the drop's supply`
      if (phase.gate === DROP_GATES.COMMUNITY && !phase.communityId) return `${label}pick which community can mint`
      if (isAssetGate(phase.gate)) {
        // The zero address is a well-formed address the engine still refuses: an empty gate
        // asset never means the native coin, only the adapter does
        if (!isAddress(phase.gateAsset) || phase.gateAsset === zeroAddress) {
          return `${label}enter the contract wallets must hold from${nativeGate ? `, or pick ${nativeSymbol}` : ` — the ${nativeSymbol} coin itself can't be gated on this network yet`}`
        }
        // The engine rejects a zero minimum outright — it would gate nobody while looking gated
        if (!(Number(phase.gateMin) > 0)) return `${label}set how much of it a wallet must hold`
      }
      // A half-typed token address would silently fall back to native pricing on submit
      if (Number(phase.price) > 0 && phase.token && !isAddress(phase.token)) {
        return `${label}enter a valid payment token address, or price it in ${nativeSymbol}`
      }
    }
    return null
  }

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

    const problem = phasesProblem()
    if (problem) {
      toast(problem, 'error')
      return
    }

    setStep(hasArtworkStep ? 'artwork' : 'payout')
  }

  /* One check shared by the payout step's Continue and the final Create, so a draft restored
     straight into review can never carry a table the engine would refuse. */
  const payoutProblem = () => {
    if (payoutMode === 'address' && !isAddress(payoutAddress)) return 'Enter the wallet your mint proceeds should go to'
    if (payoutMode === 'split' && !payoutSplitValid) return 'The mint-proceeds split needs distinct wallets whose shares total exactly 100%'
    if (royaltyBps > 0 && royaltyMode === 'split' && !royaltySplitValid) return 'The royalty split needs distinct wallets whose shares total exactly 100%'
    if ((payoutMode === 'split' || (royaltyBps > 0 && royaltyMode === 'split')) && !splitsAvailable) return "Splits aren't available on this network yet"
    return null
  }

  const handlePayoutContinue = () => {
    const problem = payoutProblem()
    if (problem) {
      toast(problem, 'error')
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
    if (engineOutdated) {
      toast('The drops engine on this network is an older build than this app — drops can be created here once the current engine is deployed', 'error')
      return
    }
    const phaseIssue = phasesProblem()
    if (phaseIssue) {
      toast(phaseIssue, 'error')
      setStep('form')
      return
    }
    const payoutIssue = payoutProblem()
    if (payoutIssue) {
      toast(payoutIssue, 'error')
      setStep('payout')
      return
    }

    setIsUploading(true)
    let metadataUri
    let metadataHash = null
    const imageUri = normalizeIpfsUri(image)
    let artworkHash = null
    pendingAllowlistRef.current = needsAllowlist ? allowlist : []
    try {
      const links = buildDropLinks(socials)
      const isLukso = isLuksoStandard(standardId)
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
      artworkHash = imageHash

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

    /* Where each token's own metadata lives. A pinned zip wins; failing that a template gives every
       id its own file; failing both, every id resolves to the one collection file, which is what a
       drop launched with before the artwork step existed. */
    let tokenBase = artworkPin ? { cid: artworkPin.cid, suffix: artworkPin.suffix } : null

    if (!tokenBase && wantsTemplate) {
      try {
        const files = buildTemplateMetadataFiles({
          standardId,
          count: supplyCount,
          baseName: tokenBaseName.trim(),
          description: tokenDescription,
          imageUrl: imageUri,
          imageHash: artworkHash,
        })
        const cid = await uploadFolderToIPFS(
          files.map((file) => new File([file.content], file.name, { type: 'application/json' })),
        )
        tokenBase = { cid, suffix: metadataSuffix(standardId) }
      } catch (err) {
        toast(err.message || 'Failed to pin the token metadata', 'error')
        setIsUploading(false)
        return
      }
    }
    setIsUploading(false)

    // The '#' terminator makes baseURI + id resolve to the one metadata file (gateways ignore fragments)
    const baseURI = tokenBase ? `ipfs://${tokenBase.cid}/` : `${metadataUri}#`

    /* A royalty split is named as the collection's ERC2981 receiver before it exists: the factory
       predicts the address, the engine deploys it in the same transaction and checks it matches. */
    let royaltyReceiver = address
    if (royaltyBps > 0 && royaltyMode === 'split') {
      try {
        royaltyReceiver = await predictSplitAddress({ publicClient, factory: splitsFactory, payees: royaltyPayees })
      } catch (err) {
        toast(describeWalletError(err, { fallback: 'Could not predict the royalty split address — check your connection and try again' }), 'error')
        return
      }
    }

    const collectionParams = encodeCollectionParams(standardId, {
      name: name.trim(),
      symbol,
      baseURI,
      uriSuffix: tokenBase?.suffix ?? '',
      tokenURI: metadataUri,
      contractURI: metadataUri,
      lsp4MetadataValue: encodeVerifiableURIFromDigest(metadataUri, metadataHash),
      // Unverified on purpose: one digest cannot cover per-token metadata after a reveal
      baseURIValue: encodeVerifiableURI(baseURI),
      // LSP4TokenType must be COLLECTION (a drop mints many ids); immutable after deploy
      tokenType: LSP4_TOKEN_TYPE_COLLECTION,
      royaltyReceiver,
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

    /* Gate assets get the same treatment, but a missing decimals() is expected rather than fatal:
       an NFT has none, and its balance is a plain count. Those fall through to 0. */
    const gateAssets = [...new Set(phases.filter((phase) => isAssetGate(phase.gate) && isAddress(phase.gateAsset)).map((phase) => phase.gateAsset))]
    const gateDecimalsList = await Promise.all(
      gateAssets.map((asset) =>
        publicClient
          .readContract({
            address: asset,
            abi: [{ name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }],
            functionName: 'decimals',
          })
          .catch(() => 0),
      ),
    )
    const gateDecimalsByAsset = Object.fromEntries(gateAssets.map((asset, index) => [asset.toLowerCase(), Number(gateDecimalsList[index])]))

    const phaseInputs = phases.map((phase) => {
      // Resolved here, not on every keystroke: a length like "7 days" runs from the moment of submit
      const { startTime, endTime, paused } = resolveSchedule(phase.schedule)
      return {
        name: (phase.name ?? '').trim(),
        startTime,
        endTime,
        paused,
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
        // Zero is meaningful for Followers: the engine reads it as "the creator"
        gateAsset:
          (isAssetGate(phase.gate) || phase.gate === DROP_GATES.FOLLOWERS) && isAddress(phase.gateAsset)
            ? phase.gateAsset
            : zeroAddress,
        gateData:
          phase.gate === DROP_GATES.COMMUNITY
            ? toHex(BigInt(phase.communityId), { size: 32 })
            : phase.gate === DROP_GATES.ASSET_HOLDERS_1155
              ? toHex(BigInt(phase.gateTokenId || 0), { size: 32 })
              : zeroHash,
        /* Scaled by the asset's own decimals: the gate compares raw balanceOf, so "100" of an
           ERC20 is 100e18 while "100" of an NFT is a hundred of them. */
        gateMin: isAssetGate(phase.gate)
          ? parseUnits(String(phase.gateMin || 0), gateDecimalsByAsset[phase.gateAsset.toLowerCase()] ?? 0)
          : 0n,
      }
    })

    // Either table is deployed by the engine in this same transaction; an empty one means no split
    const splitsInput = {
      payoutDestination: payoutMode === 'address' ? payoutAddress : zeroAddress,
      payout: payoutMode === 'split' ? payoutPayees : [],
      royalty: royaltyBps > 0 && royaltyMode === 'split' ? royaltyPayees : [],
    }
    const args = [address, BigInt(standardId), collectionParams, BigInt(supplyCount), BigInt(referralBps), featured, phaseInputs, splitsInput]

    // Read fresh: createDrop wants msg.value to the wei, and an admin can move either fee mid-session
    let value
    try {
      const [creation, surcharge] = await Promise.all([
        publicClient.readContract({ abi: dropsAbi, address: dropsAddress, functionName: 'creationFee' }),
        featured ? publicClient.readContract({ abi: dropsAbi, address: dropsAddress, functionName: 'featuredFee' }) : 0n,
      ])
      value = creation + surcharge
    } catch (err) {
      const message = err?.shortMessage || err?.message || ''
      toast(
        /returned no data|reverted/i.test(message)
          ? 'The drops engine on this network is an older build without the featured tier — untick Featured, or deploy the current engine here'
          : 'Could not read the creation fee — check your connection and try again',
        'error',
      )
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
        // No receipt is not a success: say so rather than announce a drop nobody can find
        if (!burnerReceipt) {
          toast(`Sent as ${shortHash(tx.hash)}, but the network has not confirmed it yet — check the explorer before creating again`, 'error')
          return
        }
        if (burnerReceipt.status === 0) {
          toast('The transaction reverted onchain — nothing was created', 'error')
          return
        }
        await settle(dropRefFromLogs(burnerReceipt.logs))
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

  /* The preview prices in whatever the first phase charges, so a token-priced drop must not show
     the network's coin. wagmi keys this by address and chain, so it shares the field's own read. */
  const { symbol: firstTokenSymbol } = usePaymentToken(chainId, phases[0]?.token)
  const priceSymbol = phases[0]?.token ? firstTokenSymbol || 'token' : nativeSymbol

  // What the wallet will actually be asked for: creation plus the featured surcharge when bought
  const totalDue = (creationFee ?? 0n) + (featured ? featuredFee : 0n)

  const imageUrl = image ? resolveStorageImageUrl(image) : null
  /* The marker leads with the square icon and falls back to the artwork — the same order the
     directory tile uses, because a 16px marker reads as a logo and not as a crop of a painting. */
  const markerArt = icon || image
  const markerUrl = markerArt ? resolveStorageImageUrl(markerArt, { width: 48 }) : null

  const isAwaitingWallet = isPending || isSubmittingBurner
  const createSteps = [
    {
      key: 'upload',
      label: 'Prepare the drop',
      hint: wantsTemplate
        ? `Pinning the artwork, the details, and metadata for ${countFormat.format(supplyCount)} tokens.`
        : 'Pinning the artwork and details to IPFS.',
      active: isUploading,
      done: !isUploading && (isAwaitingWallet || awaitingReceipt || isPublishingAllowlist || Boolean(created)),
    },
    {
      key: 'sign',
      label: 'Confirm in your wallet',
      hint: 'Deploys your collection and writes the mint schedule.',
      active: isAwaitingWallet,
      done: awaitingReceipt || isPublishingAllowlist || Boolean(created),
    },
    {
      key: 'confirm',
      label: 'Wait for the network',
      hint: isReceiptStalled ? 'The network has not answered yet. Still watching — there is nothing to redo.' : 'The transaction is in a block soon.',
      active: awaitingReceipt,
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
  const currentStep = createSteps.findIndex((stage) => stage.active)
  const stepsStarted = isBusy || Boolean(created)

  const gateOptions = dropGateOptions({ chainId, hasCommunityGate })

  const showPreview = step !== 'chain' && step !== 'live'

  const preview = showPreview && (
    <aside className={styles.dropForm__aside}>
      <h4 className={styles.dropForm__asideTitle}>
        Preview
        <InfoHint label="Preview">
          How the drop reads in the directory and in a post, drawn live from the fields. Nothing here is onchain yet.
        </InfoHint>
      </h4>

      <DropPreviewCard
        chainId={chainId}
        name={name}
        symbol={symbol}
        description={description}
        imageUrl={imageUrl}
        markerUrl={markerUrl}
        price={phases[0]?.price}
        priceSymbol={priceSymbol}
        supply={supplyCount}
        standardLabel={`${dropStandardLabel(standardId)} · ${shape === 'numbered' ? 'Unique numbered' : 'Identical editions'}`}
        tokenBaseName={hasArtworkStep && !artworkPin ? tokenBaseName : ''}
        tokenDescription={tokenDescription}
      />

      <p className={styles.dropForm__asideNote}>
        {artworkPin
          ? `${countFormat.format(artworkPin.count)} tokens carry their own artwork and traits.`
          : 'You own the collection contract from its first block.'}
      </p>
    </aside>
  )

  if (!mounted) return null

  return (
    <div className={styles.dropForm} style={networkColorStyle(chainInfo)}>
      <nav className={styles.dropForm__rail} aria-label="Drop creation steps">
        {steps.map((entry, index) => {
          /* Back only. Forward is what a step's own button is for, because that is where the
             fields get validated — and once the drop is live there is nothing to go back to. */
          const canReturn = index < stepIndex && step !== 'live'

          return (
            <Tooltip key={entry.key} content={entry.hint}>
              <button
                type="button"
                className={clsx(
                  styles.dropForm__railStep,
                  index === stepIndex && styles['dropForm__railStep--active'],
                  index < stepIndex && styles['dropForm__railStep--done'],
                  canReturn && styles['dropForm__railStep--return'],
                )}
                onClick={() => canReturn && setStep(entry.key)}
                aria-current={index === stepIndex ? 'step' : undefined}
                /* Not `disabled`: a disabled button dispatches no hover, and every step's hint
                   has to stay readable whether or not you can go there */
                aria-disabled={!canReturn}
              >
                <span className={styles.dropForm__railMark}>
                  {index < stepIndex ? <CheckCircleIcon size={16} weight="fill" /> : index + 1}
                </span>
                <span className={styles.dropForm__railLabel}>
                  {entry.label}
                  <InfoIcon size={12} weight="fill" />
                </span>
              </button>
            </Tooltip>
          )
        })}
      </nav>

      {step === 'form' && (
        <header className={styles.dropForm__header}>
          <span className={styles.dropForm__headerEnd}>
            {/* Leads Reset rather than following it, so saving a draft never shifts the button */}
            {draftSaved && !resetArmed && (
              <span className={styles.dropForm__draft} title="Saved as a draft — leave and pick it up later">
                <span className={styles.dropForm__draftDot} aria-hidden="true" />
                Saved
              </span>
            )}

            <button
              type="button"
              className={clsx(styles.dropForm__reset, resetArmed && styles['dropForm__reset--armed'])}
              onClick={() => (resetArmed ? handleReset() : setResetArmed(true))}
              disabled={isBusy}
              title="Clear every field and the saved draft"
            >
              <BroomIcon size={14} weight="fill" />
              {resetArmed ? 'Tap again to clear' : 'Reset'}
            </button>
          </span>
        </header>
      )}

      <div className={clsx(styles.dropForm__columns, !showPreview && styles['dropForm__columns--single'])}>
        {step === 'chain' && (
          <div className={styles.dropForm__body}>
            <DropChainPicker chainId={chainId} disabled={isBusy} />

            <div className={clsx(styles.dropForm__nav, styles['dropForm__nav--center'])}>
              <button
                type="button"
                className={styles.dropForm__submit}
                onClick={() => setStep('form')}
                disabled={!dropsAddress}
                title={dropsAddress ? undefined : 'Choose a network that carries NFT drops'}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'form' && (
          <form className={styles.dropForm__body} onSubmit={handleReview}>
            <div className={styles.dropForm__identity}>
              <label className={clsx(styles.dropForm__image, imageUrl && styles['dropForm__image--filled'])}>
                {imageUrl ? (
                  <img src={imageUrl} alt="" />
                ) : (
                  <>
                    <DashedFrame round />
                    <ImageIcon size={24} weight="light" />
                  </>
                )}
                <input type="file" accept="image/*" onChange={handleImageSelect} disabled={isBusy} hidden />
              </label>
              <div className={styles.dropForm__imageHint}>
                {imageUrl ? (
                  <>
                    <strong title={imageName || undefined}>{imageName || 'Drop artwork'}</strong>
                    <span className={styles.dropForm__imageActions}>
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
                    <strong>
                      Collection image <span className={styles.dropForm__required}>*</span>{' '}
                      {isImageUploading && <em>uploading…</em>}
                    </strong>
                    <small>256px or larger recommended — every minted item carries it.</small>
                  </>
                )}
              </div>
            </div>

            <div className={styles.dropForm__row}>
              <label className={styles.dropForm__field}>
                <span>
                  Collection name <span className={styles.dropForm__required}>*</span>
                  <InfoHint label="Collection name">
                    Written into the contract as the token&rsquo;s name, and permanent — no standard lets it change
                    after deploy. The artwork, description and links are all editable later; this is not.
                  </InfoHint>
                </span>
                <input
                  type="text"
                  value={name}
                  maxLength={MAX_NAME_LENGTH}
                  placeholder="Untitled Drop"
                  onChange={(e) => {
                    setName(e.target.value)
                    if (!symbolTouched) setSymbol(deriveSymbol(e.target.value))
                    if (!tokenBaseTouched) setTokenBaseName(deriveTokenBaseName(e.target.value))
                  }}
                  disabled={isBusy}
                />
              </label>
              <label className={styles.dropForm__field}>
                <span>
                  Ticker symbol <span className={styles.dropForm__required}>*</span>
                  <InfoHint label="Ticker">
                    The short handle the collection trades under, like a stock ticker — stored onchain as the token
                    symbol. It follows the name until you type your own, and like the name it is permanent once
                    deployed.
                  </InfoHint>
                  {!symbolTouched && symbol && <em> from the name</em>}
                </span>
                <input
                  type="text"
                  value={symbol}
                  placeholder="DROP"
                  onChange={(e) => {
                    const next = normalizeSymbol(e.target.value)
                    setSymbol(next)
                    setSymbolTouched(next !== '')
                  }}
                  disabled={isBusy}
                />
              </label>
            </div>

            <label className={styles.dropForm__field}>
              <span>
                Description
                <em className={styles.dropForm__counter}>
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
              className={styles.dropForm__brandingToggle}
              onClick={() => setShowBranding((on) => !on)}
              aria-expanded={showBranding}
            >
              <CaretRightIcon size={13} className={clsx(showBranding && styles['dropForm__caret--open'])} />
              Branding &amp; links <em>optional — banner, website, socials</em>
            </button>

            {showBranding && (
              <div className={styles.dropForm__branding}>
                <Tooltip content="Shown atop the drop page. Recommended 1600 × 640.">
                  <label className={clsx(styles.dropForm__banner, banner && styles['dropForm__banner--filled'])}>
                    {banner ? (
                      <img src={resolveStorageImageUrl(banner)} alt="" />
                    ) : (
                      <>
                        <DashedFrame />
                        <span>
                          <ImageIcon size={18} weight="light" />
                          Upload banner {isBannerUploading && <em>uploading…</em>}
                        </span>
                      </>
                    )}
                    <input type="file" accept="image/*" onChange={handleBannerSelect} disabled={isBusy} hidden />
                  </label>
                </Tooltip>

                <Tooltip content="The square logo wallets and explorers show beside the asset. Square, 256 × 256 or larger.">
                  <label className={clsx(styles.dropForm__banner, icon && styles['dropForm__banner--filled'])}>
                    {icon ? (
                      <img src={resolveStorageImageUrl(icon)} alt="" />
                    ) : (
                      <>
                        <DashedFrame />
                        <span>
                          <ImageIcon size={18} weight="light" />
                          Upload icon {isIconUploading && <em>uploading…</em>}
                        </span>
                      </>
                    )}
                    <input type="file" accept="image/*" onChange={handleIconSelect} disabled={isBusy} hidden />
                  </label>
                </Tooltip>

                {DROP_SOCIALS.map(({ key, title, placeholder }) => (
                  <label key={key} className={styles.dropForm__field}>
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
              <div className={styles.dropForm__presets}>
                <span>Token family</span>
                <div>
                  {families.map((option) => (
                    <Tooltip key={option} content={`Deploys ${dropFamilyLabel(option)} collections.`}>
                      <button
                        type="button"
                        className={clsx(activeFamily === option && styles['dropForm__preset--active'])}
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

            <div className={styles.dropForm__presets}>
              <span>Collection type</span>
              <div>
                <Tooltip
                  content={`Every mint is its own numbered token — #1, #2, … #N of the artwork, each individually ownable and tradable. Deploys a ${dropStandardLabel(standards.numbered)} collection. Fixed at launch: the standard is chosen when the contract is deployed.`}
                >
                  <button
                    type="button"
                    className={clsx(shape === 'numbered' && styles['dropForm__preset--active'])}
                    onClick={() => setShape('numbered')}
                    disabled={isBusy}
                  >
                    Unique numbered
                  </button>
                </Tooltip>
                <Tooltip
                  content={`Every mint is an identical copy of the artwork, like a print run — collectors hold a balance, not a serial number. Deploys a ${dropStandardLabel(standards.editions)} collection. Fixed at launch: the standard is chosen when the contract is deployed.`}
                >
                  <button
                    type="button"
                    className={clsx(shape === 'editions' && styles['dropForm__preset--active'])}
                    onClick={() => setShape('editions')}
                    disabled={isBusy}
                  >
                    Identical editions
                  </button>
                </Tooltip>
              </div>
            </div>

            <label className={styles.dropForm__field}>
              <span>
                Supply
                <InfoHint label="Supply">
                  The most this drop can ever mint, across every phase. Empty or 0 leaves it open-ended. Permanent:
                  it is compiled into the collection contract, so it can never be raised or lowered afterwards.
                </InfoHint>
              </span>
              <input
                type="number"
                min="0"
                step="1"
                value={supply}
                placeholder="Open edition"
                onChange={(e) => setSupply(e.target.value)}
                disabled={isBusy}
              />
            </label>

            {phases.map((phase, index) => (
              <div key={index} className={styles.dropForm__phase}>
                {phases.length > 1 && (
                  <div className={styles.dropForm__phaseHead}>
                    <strong>Phase {index + 1}</strong>
                    <button type="button" onClick={() => removePhase(index)} disabled={isBusy} aria-label={`Remove phase ${index + 1}`}>
                      <XIcon size={12} />
                      Remove
                    </button>
                  </div>
                )}

                <label className={styles.dropForm__field}>
                  <span>
                    Phase name <em>optional</em>
                    <InfoHint label="Phase name">
                      Your own label for this phase — stored onchain, shown to minters.
                    </InfoHint>
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
                </label>

                <div className={styles.dropForm__row}>
                  <label className={styles.dropForm__field}>
                    <span>
                      Price ({phase.token ? 'token' : nativeSymbol})
                      <InfoHint label="Price">Empty or 0 mints free — collectors still pay gas.</InfoHint>
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={phase.price}
                      placeholder="Free"
                      onChange={(e) => updatePhase(index, { price: e.target.value })}
                      disabled={isBusy}
                    />
                  </label>
                  <label className={styles.dropForm__field}>
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

                {Number(phase.price) > 0 && (
                  <div className={styles.dropForm__presets}>
                    <span>Paid in</span>
                    <div>
                      <button
                        type="button"
                        className={clsx(!phase.token && styles['dropForm__preset--active'])}
                        onClick={() => updatePhase(index, { token: '', isLsp7: false })}
                        disabled={isBusy}
                      >
                        {nativeSymbol}
                      </button>
                      <Tooltip content="Price this phase in an ERC20 or LSP7 instead. Minters approve the token first, so it costs them one extra transaction.">
                        <button
                          type="button"
                          className={clsx(phase.token && styles['dropForm__preset--active'])}
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
                  <label className={styles.dropForm__field}>
                    <span>
                      Token address
                      <InfoHint label="Token address">
                        Priced in the token&rsquo;s own units, to its own decimals. Leave it empty and the phase is
                        priced in {nativeSymbol} instead — the native coin, which onchain is the zero address
                        0x0000…0000.
                      </InfoHint>
                    </span>
                    <input
                      type="text"
                      value={phase.token}
                      placeholder="0x…"
                      onChange={(e) => updatePhase(index, { token: e.target.value.trim() })}
                      disabled={isBusy}
                      spellCheck={false}
                    />

                    <DropTokenIdentity chainId={chainId} token={phase.token} isLsp7={phase.isLsp7} />

                    {/* LUKSO carries both LSP7 and ERC20 tokens, so the kind cannot be inferred from the chain */}
                    {isLuksoChain(chainId) && (
                      <span className={styles.dropForm__tokenKind}>
                        <button
                          type="button"
                          className={clsx(phase.isLsp7 && styles['dropForm__preset--active'])}
                          onClick={() => updatePhase(index, { isLsp7: true })}
                          disabled={isBusy}
                        >
                          LSP7
                        </button>
                        <button
                          type="button"
                          className={clsx(!phase.isLsp7 && styles['dropForm__preset--active'])}
                          onClick={() => updatePhase(index, { isLsp7: false })}
                          disabled={isBusy}
                        >
                          ERC20
                        </button>
                      </span>
                    )}
                  </label>
                )}

                <DropWhenPicker
                  value={phase.schedule}
                  onChange={(schedule) => updatePhase(index, { schedule })}
                  disabled={isBusy}
                />

                {phases.length > 1 && !isOpenEdition && (
                  <label className={styles.dropForm__field}>
                    <span>
                      Allocation
                      <InfoHint label="Allocation">
                        {`The most this phase may sell, out of the drop's ${supplyCount}. Leave it empty and this phase can sell the whole drop. It caps this lane rather than reserving supply for it — what guarantees a presale its turn is running before the public phase, not this number.`}
                      </InfoHint>
                      <em className={styles.dropForm__counter}>of {supplyCount}</em>
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
                  </label>
                )}

                {/* The shared row carries no chrome of its own — the card is the form's, not the picker's */}
                <div className={styles.dropForm__optionCard}>
                  <DropGatePicker
                    chainId={chainId}
                    hasCommunityGate={hasCommunityGate}
                    value={phase.gate}
                    onChange={(gate) => updatePhase(index, { gate })}
                    disabled={isBusy}
                  />
                </div>

                {phase.gate === DROP_GATES.FOLLOWERS && (
                  <label className={styles.dropForm__field}>
                    <span>
                      Whose followers <em>optional</em>
                      <InfoHint label="Whose followers">
                        Leave it empty and it means your own followers. Point it at another account — a company profile,
                        a collaborator — and its followers are the ones who may mint, while the drop stays yours.
                      </InfoHint>
                    </span>
                    <input
                      type="text"
                      value={phase.gateAsset}
                      placeholder={address ? `${address.slice(0, 6)}…${address.slice(-4)} — you` : 'Your own account'}
                      onChange={(e) => updatePhase(index, { gateAsset: e.target.value.trim() })}
                      disabled={isBusy}
                      spellCheck={false}
                    />

                    {isAddress(phase.gateAsset) && (
                      <span className={styles.dropForm__gateProfile}>
                        <Profile creator={phase.gateAsset} networkId={chainId} variant="compact" size={20} hoverCard={false} />
                      </span>
                    )}
                  </label>
                )}

                {phase.gate === DROP_GATES.ALLOWLIST &&
                  (index === firstAllowlistPhase ? (
                    <label className={styles.dropForm__field}>
                      <span>
                        Allowlist <span className={styles.dropForm__required}>*</span>
                        <InfoHint label="Allowlist">
                          One address per line. The engine keeps one list per drop, so every allowlist phase draws on
                          this same list. Written onchain right after the drop is created, in batches of{' '}
                          {ALLOWLIST_BATCH_SIZE} with one signature each.
                        </InfoHint>
                        <em className={styles.dropForm__counter}>{allowlist.length} addresses</em>
                      </span>
                      <textarea
                        rows={3}
                        value={allowlistText}
                        placeholder={'0xabc…\n0xdef…'}
                        onChange={(e) => setAllowlistText(e.target.value)}
                        disabled={isBusy}
                      />
                    </label>
                  ) : (
                    <p className={styles.dropForm__gateNote}>
                      Uses the same {allowlist.length} addresses as phase {firstAllowlistPhase + 1} — the list belongs to
                      the drop, not to a phase.
                    </p>
                  ))}

                {isAssetGate(phase.gate) && (
                  <>
                    <label className={styles.dropForm__field}>
                      <span>
                        Contract they must hold <span className={styles.dropForm__required}>*</span>
                        <InfoHint label="Contract they must hold">
                          Any contract with a balance: an ERC20 or LSP7 token, an NFT collection, a membership pass. The
                          gate reads the minter&rsquo;s balance on it at the moment they mint, so a wallet that sells up
                          stops qualifying.
                          {nativeGate
                            ? ` Leaving this empty does not mean the coin — use the ${nativeSymbol} button, which gates on the coin itself, read from the wallet after the mint price has left it.`
                            : ` Leaving this empty does not mean the coin: ${nativeSymbol} itself can't be gated on this network yet.`}
                        </InfoHint>
                      </span>
                      {nativeGate && phase.gate !== DROP_GATES.ASSET_HOLDERS_1155 && (
                        <span className={styles.dropForm__tokenKind}>
                          <button
                            type="button"
                            className={clsx(phase.gateAsset.toLowerCase() === nativeGate.toLowerCase() && styles['dropForm__preset--active'])}
                            onClick={() => updatePhase(index, { gateAsset: nativeGate })}
                            disabled={isBusy}
                          >
                            {nativeSymbol} — the native coin
                          </button>
                        </span>
                      )}
                      <input
                        type="text"
                        value={phase.gateAsset}
                        placeholder="0x…"
                        onChange={(e) => updatePhase(index, { gateAsset: e.target.value.trim() })}
                        disabled={isBusy}
                        spellCheck={false}
                      />

                      <DropGateAsset
                        chainId={chainId}
                        asset={phase.gateAsset}
                        is1155={phase.gate === DROP_GATES.ASSET_HOLDERS_1155}
                        tokenId={phase.gateTokenId}
                        nativeGate={nativeGate}
                        nativeSymbol={nativeSymbol}
                      />
                    </label>

                    <div className={styles.dropForm__row}>
                      <label className={styles.dropForm__field}>
                        <span>
                          Minimum held <span className={styles.dropForm__required}>*</span>
                          <InfoHint label="Minimum held">
                            How much of it a wallet needs. One NFT is 1; a token amount is in whole units, so 100 means
                            100 of the token, not 100 of its smallest pieces.
                          </InfoHint>
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={phase.gateMin}
                          placeholder="1"
                          onChange={(e) => updatePhase(index, { gateMin: e.target.value })}
                          disabled={isBusy}
                        />
                      </label>

                      {phase.gate === DROP_GATES.ASSET_HOLDERS_1155 && (
                        <label className={styles.dropForm__field}>
                          <span>
                            Which token id
                            <InfoHint label="Which token id">
                              An ERC1155 holds many ids in one contract, so the gate has to name the one that counts.
                            </InfoHint>
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={phase.gateTokenId}
                            placeholder="0"
                            onChange={(e) => updatePhase(index, { gateTokenId: e.target.value })}
                            disabled={isBusy}
                          />
                        </label>
                      )}
                    </div>
                  </>
                )}

                {phase.gate === DROP_GATES.COMMUNITY && (
                  <label className={styles.dropForm__field}>
                    <span>
                      Which community
                      <InfoHint label="Which community">
                        Members can mint; anyone banned from it can&rsquo;t, whatever their membership says.
                      </InfoHint>
                    </span>
                    <select
                      value={phase.communityId}
                      onChange={(e) => updatePhase(index, { communityId: e.target.value })}
                      disabled={isBusy}
                    >
                      <option value="">Choose a community…</option>
                      {communities.map((community) => (
                        // The full name rides in the title, so nothing is actually lost
                        <option key={community.id} value={community.id} title={community.name}>
                          {truncateLabel(community.name, MAX_COMMUNITY_LABEL)}
                          {community.tag ? ` · ${community.tag}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            ))}

            {phases.length < MAX_PHASES && (
              <button type="button" className={styles.dropForm__addPhase} onClick={addPhase} disabled={isBusy}>
                <PlusIcon size={13} />
                Add a phase
                <em>{phases.length} of {MAX_PHASES}</em>
              </button>
            )}

            {/* Leads with what a creator can do, because that is the part that changes whether they
                bother building a schedule at all — the constraint follows as its consequence rather
                than as a wall. Said here, where the phases are, rather than only at review, and
                collapsed because the rest is for whoever is actually building a multi-phase drop. */}
            <div className={styles.dropForm__phaseNote}>
              <InfoIcon size={15} weight="fill" />
              <div>
                <p>
                  <strong>You can add more phases after the drop is live</strong> — up to {MAX_PHASES} in all, and
                  pause any of them whenever you like.{' '}
                  <button type="button" className={styles.dropForm__phaseNoteMore} onClick={() => setShowPhaseHelp((on) => !on)}>
                    {showPhaseHelp ? 'Show less' : 'Show more'}
                  </button>
                </p>

                {showPhaseHelp && (
                  <>
                    <p>
                      What you cannot do is edit one. A phase&rsquo;s price, token, schedule and gate are fixed the
                      moment it is created — so changing your price means adding a new phase and pausing the old one,
                      which also leaves the terms every collector minted under on the record.
                    </p>
                    <p>
                      <strong>Phases that overlap are all open at once.</strong> A minter names the phase they are
                      minting from, so anyone who passes the gate on two of them takes the cheaper one — a presale left
                      running past its public phase keeps selling at the presale price. Give them separate windows, or
                      pause the one you mean to close.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className={styles.dropForm__presets}>
              <span>
                Royalty, % of resales
                <InfoHint label="Royalty">
                  Your cut of every secondary sale, paid by the marketplaces that honour ERC2981. It never touches mint
                  proceeds, and you can change it later from the drop&rsquo;s manage panel.
                </InfoHint>
              </span>
              <div>
                {ROYALTY_PRESETS.map((bps) => (
                  <button
                    key={bps}
                    type="button"
                    className={clsx(royaltyBps === bps && styles['dropForm__preset--active'])}
                    onClick={() => setRoyaltyPercent(String(bps / 100))}
                    disabled={isBusy}
                  >
                    {formatBps(bps)}
                  </button>
                ))}
              </div>
              <label className={styles.dropForm__rateField}>
                <span className={styles.dropForm__rateIcon}>
                  <PercentIcon size={15} weight="bold" />
                </span>
                <span className={styles.dropForm__rateValue}>
                  <input
                    type="number"
                    min="0"
                    max={MAX_ROYALTY_BPS / 100}
                    step="0.1"
                    inputMode="decimal"
                    aria-label="Royalty percent"
                    style={{ '--rate-len': royaltyPercent.length || 1 }}
                    value={royaltyPercent}
                    placeholder="0"
                    onChange={(e) => handleRoyaltyPercent(e.target.value)}
                    disabled={isBusy}
                  />
                </span>
                <span className={styles.dropForm__rateCut}>
                  {royaltyBps === 0
                    ? 'Nothing on resales'
                    : `${cutFormat.format(royaltyBps / 10000)} ${nativeSymbol} on a 1 ${nativeSymbol} resale`}
                </span>
              </label>
              <small className={styles.dropForm__rateHint}>Up to {formatBps(MAX_ROYALTY_BPS)}, editable later</small>
            </div>

            <div className={styles.dropForm__presets}>
              <span>
                Burnable
                <InfoHint label="Burnable">
                  {burnable
                    ? 'Holders can permanently destroy their own tokens — needed for burn-to-claim and redeemables. An address they approve (a marketplace, a redemption contract) can burn on their behalf.'
                    : 'Nobody can destroy a token once minted.'}{' '}
                  Fixed forever at launch, because collectors decide whether to mint on this.
                </InfoHint>
              </span>
              <ToggleSwitch
                checked={burnable}
                onChange={(event) => setBurnable(event.target.checked)}
                aria-label="Let holders burn their own tokens"
                disabled={isBusy}
              />
            </div>

            <div className={styles.dropForm__presets}>
              <span>
                Feature this drop
                <InfoHint label="Featured">
                  Lifts the drop into the featured strip at the top of the drops directory, where it stays for as long
                  as it is minting. Bought once, not rented — and you can buy it later from the drop&rsquo;s manage
                  panel instead, at whatever the surcharge is then.
                </InfoHint>
              </span>
              <ToggleSwitch
                checked={featured && !engineOutdated}
                onChange={(event) => setFeatured(event.target.checked)}
                aria-label="Feature this drop in the directory"
                disabled={isBusy || engineOutdated}
              />
              <small className={styles.dropForm__rateHint}>
                {engineOutdated
                  ? 'Not available on this network yet'
                  : featuredFee === 0n
                    ? 'Free while the surcharge is unset on this network'
                    : `${formatEther(featuredFee)} ${nativeSymbol}, on top of the creation fee`}
              </small>
            </div>

            <div className={styles.dropForm__presets}>
              <span>
                Referral, % of mints
                <InfoHint label="Referral share">
                  Paid straight to whoever referred the minter, out of what that mint collects. Fixed at launch — the
                  engine reads it from the drop on every mint.
                </InfoHint>
              </span>
              <div>
                {REFERRAL_PRESETS.map((bps) => (
                  <button
                    key={bps}
                    type="button"
                    className={clsx(referralBps === bps && styles['dropForm__preset--active'])}
                    onClick={() => setReferralPercent(String(bps / 100))}
                    disabled={isBusy}
                  >
                    {formatBps(bps)}
                  </button>
                ))}
              </div>
              <label className={styles.dropForm__rateField}>
                <span className={styles.dropForm__rateIcon}>
                  <ShareNetworkIcon size={15} weight="bold" />
                </span>
                <span className={styles.dropForm__rateValue}>
                  <input
                    type="number"
                    min="0"
                    max={MAX_REFERRAL_BPS / 100}
                    step="0.5"
                    inputMode="decimal"
                    aria-label="Referral share percent"
                    style={{ '--rate-len': referralPercent.length || 1 }}
                    value={referralPercent}
                    placeholder="0"
                    onChange={(e) => handleReferralPercent(e.target.value)}
                    disabled={isBusy}
                  />
                </span>
                <span className={styles.dropForm__rateCut}>
                  {referralBps === 0
                    ? 'No referral payouts'
                    : `${cutFormat.format(referralBps / 10000)} ${nativeSymbol} on a 1 ${nativeSymbol} mint`}
                </span>
              </label>
              <small className={styles.dropForm__rateHint}>Up to {formatBps(MAX_REFERRAL_BPS)}, fixed at launch</small>
            </div>

            <button type="submit" className={styles.dropForm__submit} disabled={!canReview}>
              {hasArtworkStep ? 'Continue to artwork' : 'Continue to payout'}
            </button>
          </form>
        )}

        {step === 'artwork' && (
          <div className={styles.dropForm__body}>
            <div className={styles.dropForm__artwork}>
              <p className={styles.dropForm__artworkIntro}>
                A numbered collection resolves <strong>one metadata file per token</strong>. Upload a zip of the artwork
                and every id gets its own image and traits
                {canTemplate ? ' — or skip it, and the template below numbers each token off the collection art you already picked.' : '.'}
              </p>

              <DropArtworkUpload
                standardId={standardId}
                maxSupply={supplyCount}
                collectionName={name.trim()}
                disabled={isBusy}
                onPinned={setArtworkPin}
              />

              {artworkPin ? (
                <div className={styles.dropForm__pinned}>
                  <CheckCircleIcon size={16} weight="fill" />
                  {countFormat.format(artworkPin.count)} tokens pinned
                  <code title={artworkPin.cid}>ipfs://{artworkPin.cid}/</code>
                  {/* Pinning is not a commitment until the drop is created, so it has to be undoable */}
                  <button type="button" className={styles.dropForm__skip} onClick={() => setArtworkPin(null)} disabled={isBusy}>
                    Discard
                  </button>
                </div>
              ) : canTemplate ? (
                <>
                  <label className={styles.dropForm__field}>
                    <span>
                      Base token name
                      <InfoHint label="Base token name">
                        Every token is named with its own number appended — &ldquo;{tokenBaseName || 'Name #'}&rdquo;
                        becomes &ldquo;{tokenBaseName || 'Name #'}1&rdquo;. It follows the collection name until you type
                        your own.
                      </InfoHint>
                      {!tokenBaseTouched && tokenBaseName && <em> from the name</em>}
                    </span>
                    <input
                      type="text"
                      value={tokenBaseName}
                      maxLength={MAX_TOKEN_NAME_LENGTH}
                      placeholder={`${name.trim() || 'Untitled Drop'} #`}
                      onChange={(e) => {
                        setTokenBaseName(e.target.value)
                        setTokenBaseTouched(e.target.value !== '')
                      }}
                      disabled={isBusy}
                    />
                  </label>

                  <label className={styles.dropForm__field}>
                    <span>
                      Token description
                      <InfoHint label="Token description">
                        Written into every token&rsquo;s metadata. <code>{'{name}'}</code> is replaced with that
                        token&rsquo;s own name.
                      </InfoHint>
                      <em className={styles.dropForm__counter}>
                        {tokenDescription.length}/{MAX_TOKEN_DESCRIPTION_LENGTH}
                      </em>
                    </span>
                    <textarea
                      rows={2}
                      value={tokenDescription}
                      maxLength={MAX_TOKEN_DESCRIPTION_LENGTH}
                      placeholder="{name} — one of the collection."
                      onChange={(e) => setTokenDescription(e.target.value)}
                      disabled={isBusy}
                    />
                  </label>
                </>
              ) : (
                <p className={styles.dropForm__artworkIntro}>
                  {isOpenEdition
                    ? 'An open edition has no token count to generate metadata for, so every id resolves to the collection file until you upload artwork here or from the drop’s manage panel.'
                    : `A template generates metadata for up to ${countFormat.format(MAX_TEMPLATE_TOKENS)} tokens; this drop is bigger, so upload a zip here or point the base URI at your own folder from the manage panel.`}
                </p>
              )}
            </div>

            <div className={styles.dropForm__nav}>
              <button type="button" className={styles.dropForm__submit} onClick={() => setStep('payout')} disabled={isBusy}>
                Continue to payout
              </button>
            </div>
          </div>
        )}

        {step === 'payout' && (
          <div className={styles.dropForm__body}>
            <div className={styles.dropForm__presets}>
              <span>
                Mint proceeds go to
                <InfoHint label="Mint proceeds">
                  Your share of every mint — after the platform fee and any referral cut — is pushed in the same
                  transaction as the mint. Nothing is held for you to claim. You can re-point this later from the
                  drop&rsquo;s manage panel.
                </InfoHint>
              </span>
              <div>
                <button
                  type="button"
                  className={clsx(payoutMode === 'me' && styles['dropForm__preset--active'])}
                  onClick={() => setPayoutMode('me')}
                  disabled={isBusy}
                >
                  Me
                </button>
                <button
                  type="button"
                  className={clsx(payoutMode === 'address' && styles['dropForm__preset--active'])}
                  onClick={() => setPayoutMode('address')}
                  disabled={isBusy}
                >
                  Another wallet
                </button>
                {splitsAvailable && (
                  <button
                    type="button"
                    className={clsx(payoutMode === 'split' && styles['dropForm__preset--active'])}
                    onClick={() => setPayoutMode('split')}
                    disabled={isBusy}
                  >
                    A split
                  </button>
                )}
              </div>
            </div>

            {payoutMode === 'address' && (
              <label className={styles.dropForm__field}>
                <span>Destination wallet</span>
                <input
                  type="text"
                  value={payoutAddress}
                  placeholder="0x…"
                  onChange={(e) => setPayoutAddress(e.target.value.trim())}
                  disabled={isBusy}
                  spellCheck={false}
                />
                {isAddress(payoutAddress) && (
                  <span className={styles.dropForm__gateProfile}>
                    <Profile creator={payoutAddress} networkId={chainId} variant="compact" size={20} hoverCard={false} />
                  </span>
                )}
              </label>
            )}

            {payoutMode === 'split' && (
              <div className={styles.dropForm__field}>
                <span>
                  Who gets what
                  <InfoHint label="Mint-proceeds split">
                    Your share of each mint goes to a split contract that pays these wallets by their percentages.
                    The split is deployed with the drop and never changes — to pay different people later, point
                    the drop at a new split from the manage panel.
                  </InfoHint>
                </span>
                <DropPayeeTable rows={payoutRows} onChange={setPayoutRows} chainId={chainId} disabled={isBusy} />
                <small className={styles.dropForm__rateHint}>
                  {predicted.payout ? `Split contract: ${predicted.payout}` : 'The split address appears once the shares total 100%'}
                </small>
              </div>
            )}

            {royaltyBps > 0 && (
              <div className={styles.dropForm__presets}>
                <span>
                  Resale royalties go to
                  <InfoHint label="Royalties">
                    The {formatBps(royaltyBps)} royalty marketplaces pay on resales — to you, or to a split deployed
                    with the drop and named as the collection&rsquo;s royalty receiver.
                  </InfoHint>
                </span>
                <div>
                  <button
                    type="button"
                    className={clsx(royaltyMode === 'me' && styles['dropForm__preset--active'])}
                    onClick={() => setRoyaltyMode('me')}
                    disabled={isBusy}
                  >
                    Me
                  </button>
                  {splitsAvailable && (
                    <button
                      type="button"
                      className={clsx(royaltyMode === 'split' && styles['dropForm__preset--active'])}
                      onClick={() => setRoyaltyMode('split')}
                      disabled={isBusy}
                    >
                      A split
                    </button>
                  )}
                </div>
              </div>
            )}

            {royaltyBps > 0 && royaltyMode === 'split' && (
              <div className={styles.dropForm__field}>
                <span>Who gets what</span>
                <DropPayeeTable rows={royaltyRows} onChange={setRoyaltyRows} chainId={chainId} disabled={isBusy} />
                <small className={styles.dropForm__rateHint}>
                  {predicted.royalty ? `Split contract: ${predicted.royalty}` : 'The split address appears once the shares total 100%'}
                </small>
              </div>
            )}

            {!splitsAvailable && (
              <p className={styles.dropForm__note}>
                Splits between several wallets aren&rsquo;t available on this network yet — proceeds can still go to you
                or to any one wallet.
              </p>
            )}

            <div className={styles.dropForm__nav}>
              <button type="button" className={styles.dropForm__submit} onClick={handlePayoutContinue} disabled={isBusy}>
                Review
              </button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className={styles.dropForm__body}>
            <div className={styles.dropForm__preview}>
              {imageUrl && <img src={imageUrl} alt="" />}
              <div>
                <strong>{name.trim()}</strong>
                <span>{symbol}</span>
                {description.trim() && <p>{description.trim()}</p>}
              </div>
            </div>

            <dl className={styles.dropForm__facts}>
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
                <dd>{isOpenEdition ? 'Open edition' : countFormat.format(supplyCount)}</dd>
              </div>
              {hasArtworkStep && (
                <div>
                  <dt>Token metadata</dt>
                  <dd>
                    {artworkPin
                      ? `${countFormat.format(artworkPin.count)} files pinned`
                      : wantsTemplate
                        ? `Generated for ${countFormat.format(supplyCount)} tokens`
                        : 'One shared file'}
                    <small>
                      {artworkPin
                        ? 'each token carries its own artwork and traits'
                        : wantsTemplate
                          ? `named ${tokenBaseName.trim()}1 upward, all on the collection artwork`
                          : 'every id resolves to the collection file — upload artwork later from Manage'}
                    </small>
                  </dd>
                </div>
              )}
              {phases.map((phase, index) => {
                const phasePrice = phase.price.trim() === '' ? 0 : Number(phase.price)
                const cap = phase.perWallet.trim() === '' || Number(phase.perWallet) === 0 ? 'unlimited per wallet' : `${phase.perWallet} per wallet`
                const allocation = phase.allocation.trim() === '' || Number(phase.allocation) === 0 ? null : `${phase.allocation} reserved`

                return (
                  <div key={index}>
                    <dt>{phase.name?.trim() || (phases.length > 1 ? `Phase ${index + 1}` : 'Mint phase')}</dt>
                    <dd>
                      {phasePrice === 0 ? 'Free' : `${phase.price} ${nativeSymbol}`}
                      <small>{gateOptions.find((option) => option.id === phase.gate)?.label ?? 'Open'} · {cap}</small>
                      <small>{describeSchedule(phase.schedule)}</small>
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
                <dt>Mint proceeds</dt>
                <dd>
                  {payoutMode === 'me' && 'Straight to your wallet'}
                  {payoutMode === 'address' && <code>{payoutAddress}</code>}
                  {payoutMode === 'split' && (
                    <>
                      Split {payoutPayees.length} ways
                      <small>{predicted.payout ? `split contract ${predicted.payout}` : 'split address pending'}</small>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>Royalty</dt>
                <dd>
                  {royaltyBps === 0
                    ? 'None'
                    : royaltyMode === 'split'
                      ? `${formatBps(royaltyBps)} to a split ${royaltyPayees.length} ways`
                      : `${formatBps(royaltyBps)} to you`}
                  {royaltyBps > 0 && royaltyMode === 'split' && (
                    <small>{predicted.royalty ? `split contract ${predicted.royalty}` : 'split address pending'}</small>
                  )}
                </dd>
              </div>
              <div>
                <dt>Burnable</dt>
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
              {featured && (
                <div>
                  <dt>Featured</dt>
                  <dd>
                    In the directory&rsquo;s featured strip
                    <small>{featuredFee === 0n ? 'no surcharge on this network' : `${formatEther(featuredFee)} ${nativeSymbol} surcharge`}</small>
                  </dd>
                </div>
              )}
              <div>
                <dt>You pay now</dt>
                <dd>
                  {creationFee === undefined
                    ? 'Reading…'
                    : totalDue === 0n
                      ? 'Free'
                      : `${formatEther(totalDue)} ${nativeSymbol}`}
                  {featured && creationFee !== undefined && featuredFee > 0n && (
                    <small>
                      {creationFee === 0n ? 'free to create' : `${formatEther(creationFee)} to create`} +{' '}
                      {formatEther(featuredFee)} to feature
                    </small>
                  )}
                </dd>
              </div>
            </dl>

            <p className={styles.dropForm__note}>
              You own the collection contract from its first block. <strong>The name, ticker, collection type, supply,
              burnability and referral share can never be changed</strong>, and a mint phase is fixed forever once
              created — check them above. Artwork, description, links, royalty and where the money goes stay editable
              from the drop&rsquo;s manage panel.
            </p>

            {standardReady === false && (
              <p className={styles.dropForm__note}>
                {dropStandardLabel(standardId)} drops aren&rsquo;t enabled on this network yet — no deployer is registered for
                this standard.
              </p>
            )}

            {engineOutdated && (
              <p className={styles.dropForm__note}>
                The drops engine on this network is an older build than this app, so creating a drop here would fail.
                It works again once the current engine is deployed and registered for this network.
              </p>
            )}

            {stepsStarted && (
              <div className={styles.dropForm__steps}>
                <div className={styles.dropForm__stepsHead}>
                  <strong>Creating your drop</strong>
                  <span>
                    {Math.min(currentStep === -1 ? createSteps.length : currentStep + 1, createSteps.length)} / {createSteps.length}
                  </span>
                </div>

                <ol>
                  {createSteps.map((stage, index) => (
                    <li
                      key={stage.key}
                      className={clsx(stage.done && styles['dropForm__step--done'], stage.active && styles['dropForm__step--active'])}
                    >
                      <span className={styles.dropForm__stepMark}>
                        {stage.done ? <CheckCircleIcon size={16} weight="fill" /> : index + 1}
                      </span>
                      <span className={styles.dropForm__stepText}>
                        <strong>{stage.label}</strong>
                        <small>{stage.hint}</small>
                      </span>
                    </li>
                  ))}
                </ol>

                <small className={styles.dropForm__stepsFoot}>
                  Keep this open until it finishes. Nothing is lost if a step fails — you can try again from here.
                </small>

                {awaitingReceipt && isReceiptStalled && (
                  <p className={styles.dropForm__note}>
                    The network hasn&rsquo;t answered about <code>{shortHash(hash)}</code> yet. It is still being watched and the
                    button stays locked — sending again would create a second drop.{' '}
                    {explorerUrl && (
                      <a href={`${explorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer">
                        Open on the explorer
                      </a>
                    )}{' '}
                    <button type="button" className={styles.dropForm__noteAction} onClick={() => refetchReceipt()}>
                      Check again
                    </button>
                  </p>
                )}
              </div>
            )}

            {restoredPendingHash && !hash && !pendingDismissed && (
              <p className={styles.dropForm__note}>
                {restoredDrop ? (
                  <>
                    The Create transaction from your last visit went through — this drop is already live as drop #{restoredDrop.dropId}.{' '}
                    <Link href={`/drops/${chainId}/${restoredDrop.dropId}`}>View it</Link>, or{' '}
                    <button type="button" className={styles.dropForm__noteAction} onClick={() => setPendingDismissed(true)}>
                      start a different drop
                    </button>
                  </>
                ) : restoredReverted ? (
                  <>The Create transaction from your last visit reverted onchain, so nothing was created. You can create again.</>
                ) : (
                  <>
                    A Create transaction from your last visit, <code>{shortHash(restoredPendingHash)}</code>, was sent but had not confirmed
                    when the page closed. Still checking — if it went through, this drop already exists.{' '}
                    {explorerUrl && (
                      <a href={`${explorerUrl}/tx/${restoredPendingHash}`} target="_blank" rel="noreferrer">
                        Open on the explorer
                      </a>
                    )}{' '}
                    <button type="button" className={styles.dropForm__noteAction} onClick={() => setPendingDismissed(true)}>
                      I checked — it did not go through
                    </button>
                  </>
                )}
              </p>
            )}

            <button
              type="button"
              className={styles.dropForm__submit}
              onClick={handleCreate}
              disabled={isBusy || !address || standardReady === false || engineOutdated || pendingBlocks}
            >
              <ImageIcon size={16} weight="fill" />
              {isBusy ? (createSteps[currentStep]?.label ?? 'Working…') : 'Create drop'}
            </button>
          </div>
        )}

        {step === 'live' && created && (
          <div className={clsx(styles.dropForm__body, styles.dropForm__done)}>
            <span className={styles.dropForm__doneMark}>
              {imageUrl && <img src={imageUrl} alt="" />}
              <CheckCircleIcon size={26} weight="fill" />
            </span>
            <h4>{name.trim()} is live</h4>
            <p>Your collection is deployed and minting is open on your terms.</p>

            <Link href={`/drops/${chainId}/${created.dropId}`} className={styles.dropForm__submit}>
              View drop
            </Link>
          </div>
        )}

        {preview}
      </div>
    </div>
  )
}
