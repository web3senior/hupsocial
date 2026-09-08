'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { formatEther, isAddress, parseEther, toHex, zeroAddress, zeroHash } from 'viem'
import { useConnection, usePublicClient, useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { describeWalletError } from '@/lib/walletErrors'
import { isUniversalProfile } from '@/lib/lsp3'
import { ERC725Y_SET_DATA_BATCH_ABI, encodeIssuedAssetAppend, issuedAssetInterfaceId, readIssuedAssetListing } from '@/lib/lsp12'
import { formatUsd, rateFor, usdValue } from '@/lib/usdAmount'
import {
  ALLOWLIST_BATCH_SIZE,
  DROP_GATES,
  MAX_DROP_PHASES,
  MAX_PHASE_NAME_BYTES,
  LSP8_DATA_KEYS,
  decodeVerifiableURI,
  DROP_START_MODES,
  emptySchedule,
  formatPhaseTime,
  gateLabel,
  isLuksoStandard,
  isNumberedStandard,
  isValidSplit,
  normalizeAllowlist,
  phaseNameByteLength,
  phaseStatus,
  PHASE_STATUS,
  resolveSchedule,
  scheduleErrorMessage,
  sharesOneTokenDocument,
  toSplitPayees,
} from '@/lib/drops'
import dropsAbi from '@/abis/HupDrops.json'
import collectionAbi from '@/abis/HupDropCollection.json'
import DropPayeeTable, { emptyPayee } from '@/components/DropPayeeTable'
import SplitPayoutCard from '@/components/SplitPayoutCard'
import DropGatePicker from '@/components/DropGatePicker'
import DropPhaseTrack from '@/components/DropPhaseTrack'
import DropWhenPicker from '@/components/DropWhenPicker'
import Profile from '@/components/Profile'
import { toast } from '@/components/NextToast'
import { Spinner } from '@/components/Loading'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { PaintBrushIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import styles from './DropManagePanel.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })
const countFormat = new Intl.NumberFormat('en')
const dateTimeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' })

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

const formatNative = (wei) => amountFormat.format(Number(formatEther(BigInt(wei ?? 0))))

/**
 * Creator-only control surface on the drop detail page: indexed revenue and activity, the phase
 * schedule, payout, and the permanent close switch. Metadata itself is managed in the Studio,
 * which this panel only points at. Renders nothing unless the connected wallet is the drop's
 * creator; every action is also enforced onchain.
 *
 * @param {Object} props.drop The live drop struct from getDrop.
 * @param {string} props.collection The drop's collection contract.
 */
export default function DropManagePanel({ chainId, dropId, drop, collection, onClosed }) {
  const { address, chain: walletChain } = useConnection()
  const publicClient = usePublicClient({ chainId })
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'
  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops
  const standardId = drop ? Number(drop.standardId) : undefined
  const isLukso = isLuksoStandard(standardId)
  const isWrongChain = Boolean(walletChain && walletChain.id !== chainId)

  const isCreator = Boolean(address && drop?.creator && address.toLowerCase() === drop.creator.toLowerCase())

  const [activeTab, setActiveTab] = useState('overview')
  const [confirmClose, setConfirmClose] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [phaseBusy, setPhaseBusy] = useState(null)
  const [allowlistDraft, setAllowlistDraft] = useState('')
  const [isSavingAllowlist, setIsSavingAllowlist] = useState(false)
  const [payoutDraft, setPayoutDraft] = useState('')
  const [isSavingPayout, setIsSavingPayout] = useState(false)
  const [splitRows, setSplitRows] = useState([emptyPayee()])
  const [isSavingSplit, setIsSavingSplit] = useState(false)
  const [newPhase, setNewPhase] = useState(null)
  const [isAddingPhase, setIsAddingPhase] = useState(false)
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

  // The factory the engine deploys splits through: zero until the admin registers one
  const { data: splitsFactory } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'splits',
    chainId,
    query: { enabled: Boolean(dropsAddress && isCreator) },
  })
  const splitsAvailable = Boolean(splitsFactory && splitsFactory !== zeroAddress)
  // Every token a phase charges in — a split holding one of them shows that balance too
  const paymentTokens = phases.filter((entry) => entry.token && entry.token !== zeroAddress).map((entry) => ({ address: entry.token, isLsp7: Boolean(entry.isLsp7) }))

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
  const hasEarned = Boolean(totals) && creatorNetWei > 0n
  // Priced at read time from the route's best-effort rate; an unpriced chain shows no dollar line
  const earnedUsd = hasEarned
    ? formatUsd(usdValue(creatorNetWei, chainInfo?.nativeCurrency?.decimals ?? 18, rateFor(indexed?.data?.usd, null)))
    : null

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

  const collectionRead = { abi: collectionAbi, address: collection ?? undefined, chainId, query: { enabled: Boolean(collection && isCreator) } }
  const { data: metadataFrozen = false, refetch: refetchFrozen } = useReadContract({ ...collectionRead, functionName: 'metadataFrozen' })

  const isNumbered = isNumberedStandard(standardId)

  // Where token 1 resolves today — only read to say so; changing it is the Studio's job
  const { data: tokenOneUri } = useReadContract({
    ...collectionRead,
    functionName: 'tokenURI',
    args: [1n],
    query: { enabled: Boolean(collection && isCreator && isNumbered && !isLukso) },
  })
  const { data: lsp8BaseUriRaw } = useReadContract({
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
  // Own instance for the sequential awaits — sharing `hash` would re-fire the pendingActionRef effect
  const { writeContractAsync: writeAllowlistAsync } = useWriteContract()
  const pendingActionRef = useRef(null)
  const isBusy = isPending || isConfirming || isClosing || phaseBusy !== null || isAddingPhase || isSavingAllowlist || isSavingPayout || isSavingSplit

  /* LSP12IssuedAssets[] on the creator's profile: the other half of the LSP4Creators[] link the
     collection wrote at launch, and what makes explorers show the creator as verified. Read for a
     Universal Profile creator only — an EOA has no profile keys to list anything in. */
  const [profileListing, setProfileListing] = useState(null)
  const [isListing, setIsListing] = useState(false)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      // Yields before touching state, so the effect body itself writes nothing
      await Promise.resolve()
      if (cancelled || !isLukso || !isCreator || !collection || !publicClient) return
      if (!(await isUniversalProfile(publicClient, drop.creator))) return
      const listing = await readIssuedAssetListing(publicClient, drop.creator, collection)
      if (!cancelled) setProfileListing(listing)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [isLukso, isCreator, collection, publicClient, drop?.creator])

  const handleListOnProfile = async () => {
    if (!profileListing || profileListing.listed) return
    setIsListing(true)
    try {
      const { keys, values } = encodeIssuedAssetAppend({
        asset: collection,
        interfaceId: issuedAssetInterfaceId(isNumbered),
        count: profileListing.count,
      })
      // Written to the profile itself, which is why only the creator's own wallet can do this
      await writeAllowlistAsync({ address: drop.creator, abi: ERC725Y_SET_DATA_BATCH_ABI, functionName: 'setDataBatch', args: [keys, values], chainId })
      toast('Listed on your profile — explorers now show you as its verified creator', 'success')
      setProfileListing({ count: profileListing.count + 1, listed: true })
    } catch (err) {
      toast(describeWalletError(err, { fallback: 'Listing on your profile failed' }), 'error')
    } finally {
      setIsListing(false)
    }
  }

  useEffect(() => {
    if (!submitError) return
    toast(describeWalletError(submitError, { fallback: 'Transaction rejected' }), 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed || !pendingActionRef.current) return
    const action = pendingActionRef.current
    pendingActionRef.current = null

    if (action === 'close') {
      toast('Drop closed — minting has ended for good', 'success')
      setConfirmClose(false)
      onClosed?.()
    }
    if (action === 'phase') {
      toast('Phase updated', 'success')
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
        toast(paused ? 'Phase paused' : 'Phase started', 'success')
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

  /** setPayoutSplit deploys the table's split if it does not exist and points the drop at it, in one signature. */
  const handleSetPayoutSplit = async () => {
    const payees = toSplitPayees(splitRows)
    if (!isValidSplit(payees)) {
      toast('A split needs distinct wallets whose shares total exactly 100%', 'error')
      return
    }
    setIsSavingSplit(true)
    try {
      // Creator's own address only, like setPayoutDestination — no burner session, no forwarder
      await writeAllowlistAsync({ abi: dropsAbi, address: dropsAddress, functionName: 'setPayoutSplit', args: [BigInt(dropId), payees], chainId })
      toast('Your share of every mint now goes to the split', 'success')
      setSplitRows([emptyPayee()])
      refetchPayout()
    } catch (err) {
      toast(describeWalletError(err, { fallback: 'Setting the split failed' }), 'error')
    } finally {
      setIsSavingSplit(false)
    }
  }

  /** Appends a phase to a live drop. */
  const handleAddPhase = async () => {
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    const { startTime, endTime, paused, error: scheduleError } = resolveSchedule(newPhase.schedule)

    if (scheduleError) {
      toast(scheduleErrorMessage(scheduleError), 'error')
      return
    }
    if (newPhase.gate === DROP_GATES.COMMUNITY && !newPhase.communityId) {
      toast('Pick which community can mint', 'error')
      return
    }

    const phaseInput = {
      name: newPhase.name.trim(),
      startTime,
      endTime,
      paused,
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
      toast('Phase added — it joins the schedule at the end', 'success')
      setNewPhase(null)
      refetchPhases()
    } catch (err) {
      toast(describeWalletError(err, { fallback: 'Adding the phase failed' }), 'error')
    } finally {
      setIsAddingPhase(false)
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
  const studioHref = `/nfts/studio?network=${chainId}&address=${collection}`

  // Each tab is listed only while something in it can render, so no tab ever opens empty
  const tabOptions = [
    { value: 'overview', label: 'Overview' },
    ...(phases.length > 0 ? [{ value: 'stages', label: 'Phases' }] : []),
    { value: 'metadata', label: 'Metadata' },
    { value: 'payout', label: 'Payout' },
    ...(!metadataFrozen || !isClosed ? [{ value: 'danger', label: 'Danger' }] : []),
  ]
  // A tab can disappear under the user — closing the drop can retire Danger — so fall back
  const tab = tabOptions.some((option) => option.value === activeTab) ? activeTab : 'overview'

  return (
    <section className={styles.manage}>
      <header className={styles.manage__header}>
        <div>
          <h2>Manage drop</h2>
          <small>Only you see this — you created this drop.</small>
        </div>
        <Link href={studioHref} className={styles.manage__edit}>
          <PaintBrushIcon size={14} aria-hidden="true" />
          {metadataFrozen ? 'View metadata' : 'Edit metadata'}
        </Link>
      </header>

      <SegmentedControl
        className={styles.manage__tabs}
        options={tabOptions}
        value={tab}
        onChange={setActiveTab}
        label="Manage sections"
        as="tabs"
      />

      {/* Earnings lead, at a size that reads across a room. There is no withdraw button and
          there never will be: proceeds push to the payout destination inside the mint itself, so
          this is money already in the creator's wallet, not a balance held here waiting to be
          claimed. Saying so is the point — a creator arriving from a launchpad that escrows will
          look for the button. */}
      {tab === 'overview' && (
        <>
          <div className={styles.manage__earnings}>
            <span className={styles.manage__earningsLabel}>Earned from mints</span>
            {/* Once something is earned it takes the up colour. At zero it stays in plain ink. */}
            <strong className={clsx(styles.manage__earningsValue, hasEarned && styles['manage__earningsValue--earned'])}>
              {totals ? formatNative(creatorNetWei) : '—'}
              <em>{nativeSymbol}</em>
            </strong>
            {earnedUsd && <span className={styles.manage__earningsUsd}>≈ {earnedUsd}</span>}
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

          {profileListing && (
            <div className={styles.manage__listing}>
              <span>
                {profileListing.listed
                  ? 'Your profile lists this collection — explorers show you as its verified creator.'
                  : 'Your profile does not list this collection yet, so explorers show its creator as unverified.'}
              </span>
              {!profileListing.listed && (
                <button type="button" onClick={handleListOnProfile} disabled={isBusy || isListing || isWrongChain}>
                  {isListing ? 'Listing…' : 'List on my profile'}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'stages' && phases.length > 0 && (
        <div className={styles.manage__phases}>
          <h3>Mint phases</h3>
          {/* Ghost rungs for the phases still unspent, so the eight-phase ceiling is visible */}
          <DropPhaseTrack
            className={styles.manage__phaseTrack}
            phases={phases}
            slots={MAX_DROP_PHASES}
            color={chainInfo?.primaryColor}
          />
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
                  <span className={styles.manage__phaseName}>{phase.name?.trim() || `Phase ${index + 1}`}</span>
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
                      {phaseBusy === index ? <Spinner size="14px" color="currentColor" strokeColor="currentColor" /> : phase.paused ? 'Start' : 'Pause'}
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
                  <strong>New phase {phases.length + 1}</strong>
                  <button type="button" onClick={() => setNewPhase(null)} disabled={isBusy}>
                    <XIcon size={12} />
                    Cancel
                  </button>
                </div>

                <div className={styles.manage__newPhaseGrid}>
                  <label className={clsx(styles.manage__field, styles['manage__field--wide'])}>
                    <span>
                      Phase name <em>optional</em>
                    </span>
                    <input
                      type="text"
                      value={newPhase.name}
                      placeholder={`e.g. ${phases.length === 0 ? 'Presale' : 'Public'}`}
                      // Phase names are capped in bytes, not characters
                      onChange={(e) => {
                        let next = e.target.value
                        while (phaseNameByteLength(next) > MAX_PHASE_NAME_BYTES) next = next.slice(0, -1)
                        setNewPhase({ ...newPhase, name: next })
                      }}
                      disabled={isBusy}
                    />
                  </label>
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
                </div>

                <DropWhenPicker
                  value={newPhase.schedule}
                  onChange={(schedule) => setNewPhase({ ...newPhase, schedule })}
                  disabled={isBusy}
                />

                <DropGatePicker
                  chainId={chainId}
                  hasCommunityGate={hasCommunityGate}
                  value={newPhase.gate}
                  onChange={(gate) => setNewPhase({ ...newPhase, gate })}
                  disabled={isBusy}
                />

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

                <button type="button" className={styles.manage__newPhaseSubmit} onClick={handleAddPhase} disabled={isBusy}>
                  {isAddingPhase ? <Spinner size="14px" color="currentColor" strokeColor="currentColor" /> : <PlusIcon size={13} />}
                  {isAddingPhase ? 'Adding' : 'Add a phase'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.manage__addPhase}
                onClick={() =>
                  setNewPhase({
                    name: '',
                    // A phase added to a live drop waits for its creator by default
                    schedule: emptySchedule({ startMode: DROP_START_MODES.MANUAL }),
                    price: '',
                    perWallet: '',
                    allocation: '',
                    gate: DROP_GATES.OPEN,
                    communityId: '',
                  })
                }
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

      {tab === 'stages' && hasAllowlistPhase && (
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

      {/* Metadata is managed in the Studio, which writes to this same collection with the same
          owner keys and keeps working after the drop closes — this card only says where things
          stand and opens the door */}
      {tab === 'metadata' && (
        <div className={styles.manage__studio}>
          <div>
            <h3>Metadata lives in the Studio</h3>
            <p className={styles.manage__hint}>
              The collection&rsquo;s name, story and cover images{isLukso ? ', its creators' : ''}
              {isNumbered ? ', and the artwork behind every token' : ''} — one place, for this and any other collection
              you own.
            </p>
            {isNumbered && currentTokenUri && (
              <p className={styles.manage__hint}>
                Token #1 currently loads from <code title={currentTokenUri}>{currentTokenUri}</code>.{' '}
                {sharesOneTokenDocument(currentTokenUri)
                  ? 'That’s the single-artwork placeholder — every token shares it until you upload the set.'
                  : 'Each token resolves to its own file.'}
              </p>
            )}
            {metadataFrozen && (
              <p className={styles.manage__hint}>
                Metadata is frozen — the Studio still shows it{isLukso ? ' and lets you edit the creators' : ''}, but nothing
                else can change.
              </p>
            )}
          </div>
          <Link href={studioHref} className={styles.manage__studioLink}>
            <PaintBrushIcon size={14} aria-hidden="true" />
            Open in Studio
          </Link>
        </div>
      )}

      {tab === 'payout' && !isClosed && (
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

          {splitsAvailable && (
            <>
              <h3>Split between wallets</h3>
              {payoutOverride && <SplitPayoutCard chainId={chainId} candidate={payoutOverride} title="Your current split" tokens={paymentTokens} />}
              <p className={styles.manage__hint}>
                Deploys an immutable split that pays these wallets by share and points your proceeds at it — one
                signature. To pay different people later, save a new table; the old split stays as it was.
              </p>
              <DropPayeeTable rows={splitRows} onChange={setSplitRows} chainId={chainId} disabled={isBusy} />
              <div className={styles.manage__payoutRow}>
                <button type="button" onClick={handleSetPayoutSplit} disabled={isBusy || !isValidSplit(toSplitPayees(splitRows))}>
                  {isSavingSplit ? 'Saving…' : 'Save split'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'payout' && (
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
      )}

      {tab === 'overview' && mints.length > 0 && (
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
                  <td>
                    <Profile creator={mint.minter} networkId={chainId} variant="compact" size={24} />
                  </td>
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

      {tab === 'danger' && !metadataFrozen && (
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

      {tab === 'danger' && !isClosed && (
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

    </section>
  )
}
