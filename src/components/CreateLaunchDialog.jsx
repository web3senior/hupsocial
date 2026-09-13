'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { erc20Abi, formatEther, isAddress, parseEventLogs, zeroAddress } from 'viem'
import { useConnection, usePublicClient, useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import useSWR from 'swr'
import { useQuoteAsset } from '@/hooks/useQuoteAsset'

import { shortAddress } from '@/lib/address'
import { uploadFileToIPFS, uploadObjectToIPFS, withAuthor } from '@/lib/ipfs'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import {
  TOTAL_SUPPLY,
  creatorShareFromVolumeBps,
  estimateOpeningBuy,
  formatQuote,
  formatTokenAmount,
  formatVolumeBps,
  volumeBpsFromCreatorShare,
} from '@/lib/launch'
import { isValidSplit, MAX_SPLIT_PAYEES, predictSplitAddress, toSplitPayees } from '@/lib/splits'
import { useSplitDeployer } from '@/hooks/useSplitDeployer'
import launchAbi from '@/abis/HupLaunch.json'
import { toast } from '@/components/NextToast'
import { launchHref } from '@/lib/tokenRef'
import { CheckCircleIcon, ImageIcon, LightningIcon, LockIcon, RocketLaunchIcon, XCircleIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import QuoteAssetSelect from './QuoteAssetSelect'
import PayeeTable, { emptyPayee } from './PayeeTable'
import ToggleSwitch from './ui/ToggleSwitch'
import styles from './CreateLaunchDialog.module.scss'

const MAX_NAME_LENGTH = 32
const MAX_SYMBOL_LENGTH = 10
const MAX_DESCRIPTION_LENGTH = 280

// Buy-size presets as a share of total supply, matching how creators actually think about a dev
// buy ("I want 1% of the coin") rather than in units of native
const BUY_PRESETS = [0.5, 1, 2, 5]

// The creator fee is typed in basis points of every buy — an integer, because the whole range a
// creator can choose from lives under 1% and typing "0.05" is worse than typing 5
const DEFAULT_FEE_VOLUME_BPS = 10

// Who the creator fee is paid to: the creator, one other wallet, or a HupSplits split shared
// between several. The locker stores one recipient address either way — a split is just an
// address that happens to divide what it is sent.
const FEE_MODES = ['me', 'address', 'split']

const permanentList = new Intl.ListFormat('en', { type: 'conjunction' })

const clampFeeBps = (value, max) => Math.max(0, Math.min(Math.trunc(Number(value) || 0), max))

const launchRefFromLogs = (logs) => {
  try {
    const [created] = parseEventLogs({ abi: launchAbi, logs: logs ?? [], eventName: 'LaunchCreated' })
    if (!created?.args?.launchId) return null
    return { launchId: created.args.launchId.toString(), token: created.args.token }
  } catch {
    return null
  }
}

// A ticker is uppercase alphanumerics — strip as the user types rather than rejecting on submit
const normalizeSymbol = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_SYMBOL_LENGTH)

const getLaunchDraftKey = () => `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}launch-draft`

// Only what the creator typed, never the target chain: a draft written while the composer sat on
// one network must not quietly open a launch aimed at another. The image is kept as the CID it
// already uploaded to, so coming back does not mean uploading it twice.
const loadLaunchDraft = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(getLaunchDraftKey())
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')

    return {
      name: str(parsed.name, MAX_NAME_LENGTH),
      symbol: normalizeSymbol(str(parsed.symbol, MAX_SYMBOL_LENGTH)),
      description: str(parsed.description, MAX_DESCRIPTION_LENGTH),
      image: str(parsed.image, 512),
      imageName: str(parsed.imageName, 128),
      takeCreatorFee: parsed.takeCreatorFee === true,
      // Clamped against nothing here — the live ceiling comes off the factory, so the form
      // clamps again once it knows it
      feeVolumeBps: Number.isFinite(parsed.feeVolumeBps) ? Math.max(0, Math.trunc(parsed.feeVolumeBps)) : DEFAULT_FEE_VOLUME_BPS,
      feeRecipient: isAddress(str(parsed.feeRecipient, 42)) ? parsed.feeRecipient : '',
      feeMode: FEE_MODES.includes(parsed.feeMode) ? parsed.feeMode : 'me',
      feeRows: Array.isArray(parsed.feeRows)
        ? parsed.feeRows.slice(0, MAX_SPLIT_PAYEES).map((row) => ({ address: str(row?.address, 42), percent: str(row?.percent, 10) }))
        : null,
      bundleBuy: parsed.bundleBuy === true,
      // Clamped to the presets on offer — a draft written before those changed must not restore
      // a buy size the form can no longer show
      buyPercent: BUY_PRESETS.includes(parsed.buyPercent) ? parsed.buyPercent : BUY_PRESETS[1],
    }
  } catch {
    return null
  }
}

const clearLaunchDraft = () => {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(getLaunchDraftKey())
  } catch (error) {
    console.error('Failed to clear launch draft:', error)
  }
}

/**
 * Create Launch Dialog
 * Three steps: token info, review, live. Image and description arrive prefilled when the dialog
 * is opened from the post composer, so in practice the author only types a name and a ticker.
 *
 * @param {Object} props
 * @param {number} props.fixedChainId The chain to launch on.
 * @param {string} [props.prefillImage] IPFS CID of the post's first image, used as the token image.
 * @param {string} [props.prefillDescription] Post text, seeding the token description.
 * @param {boolean} [props.showSuccessStep] Show the "it's live" step with a link to the token page.
 *        The composer skips it — there the launch is one part of publishing a post, not the end
 *        of a flow — while the standalone page ends here.
 * @param {Function} props.onCreated Receives { launchId, token, chainId } once the tx confirms.
 */
const CreateLaunchDialog = forwardRef(function CreateLaunchDialog(
  { fixedChainId, prefillImage = '', prefillDescription = '', showSuccessStep = false, onCreated },
  ref,
) {
  const dialogRef = useRef(null)
  const { address, chain: walletChain } = useConnection()

  const chainId = fixedChainId
  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === chainId), [chainId])
  const launchAddress = CONTRACTS[`chain${chainId}`]?.launch
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'
  const publicClient = usePublicClient({ chainId })

  const [step, setStep] = useState('form')
  const [image, setImage] = useState(prefillImage)
  const [imageName, setImageName] = useState('')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState(prefillDescription.slice(0, MAX_DESCRIPTION_LENGTH))
  const [takeCreatorFee, setTakeCreatorFee] = useState(false)
  const [feeVolumeBps, setFeeVolumeBps] = useState(DEFAULT_FEE_VOLUME_BPS)
  const [feeRecipient, setFeeRecipient] = useState('')
  const [feeMode, setFeeMode] = useState('me')
  const [feeRows, setFeeRows] = useState([emptyPayee()])
  const [bundleBuy, setBundleBuy] = useState(false)
  const [buyPercent, setBuyPercent] = useState(1)
  // What the token is paired against. Deliberately not part of the saved draft: a draft written
  // on one chain must never carry another chain's token address into this launch.
  const [quoteAddress, setQuoteAddress] = useState(zeroAddress)
  const [isApproving, setIsApproving] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [created, setCreated] = useState(null)
  const [isImageUploading, setIsImageUploading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState(false)

  // The composer may finish uploading the post's image after this dialog mounts
  useEffect(() => {
    if (prefillImage) setImage(prefillImage)
  }, [prefillImage])

  // Restore whatever was typed last time. Runs on mount rather than on open so a refresh with the
  // dialog already showing comes back filled in, not blank.
  useEffect(() => {
    const draft = loadLaunchDraft()
    if (!draft) return

    setName(draft.name)
    setSymbol(draft.symbol)
    // The composer's prefills win: they describe the post this launch is being attached to
    if (!prefillDescription) setDescription(draft.description)
    if (!prefillImage && draft.image) {
      setImage(draft.image)
      setImageName(draft.imageName)
    }
    setTakeCreatorFee(draft.takeCreatorFee)
    setFeeVolumeBps(draft.feeVolumeBps)
    setFeeRecipient(draft.feeRecipient)
    setFeeMode(draft.feeMode)
    if (draft.feeRows?.length) setFeeRows(draft.feeRows)
    setBundleBuy(draft.bundleBuy)
    setBuyPercent(draft.buyPercent)
    setRestoredDraft(Boolean(draft.name.trim() || draft.symbol.trim() || draft.description.trim() || draft.image))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Kept through a close or a refresh — a ticker is often abandoned mid-thought. Cleared once the
  // token is onchain, which is the point it stops being a draft.
  useEffect(() => {
    const hasContent = Boolean(name.trim() || symbol.trim() || description.trim() || image)

    if (!hasContent) {
      clearLaunchDraft()
      return
    }

    try {
      localStorage.setItem(
        getLaunchDraftKey(),
        JSON.stringify({
          name,
          symbol,
          description,
          image,
          imageName,
          takeCreatorFee,
          feeVolumeBps,
          feeRecipient,
          feeMode,
          feeRows,
          bundleBuy,
          buyPercent,
        })
      )
    } catch (error) {
      console.error('Failed to save launch draft:', error)
    }
  }, [name, symbol, description, image, imageName, takeCreatorFee, feeVolumeBps, feeRecipient, feeMode, feeRows, bundleBuy, buyPercent])

  const resetLaunchForm = () => {
    clearLaunchDraft()
    setRestoredDraft(false)
    setName('')
    setSymbol('')
    setDescription(prefillDescription.slice(0, MAX_DESCRIPTION_LENGTH))
    setImage(prefillImage)
    setImageName('')
    setTakeCreatorFee(false)
    setFeeVolumeBps(DEFAULT_FEE_VOLUME_BPS)
    setFeeRecipient('')
    setFeeMode('me')
    setFeeRows([emptyPayee()])
    setBundleBuy(false)
    setBuyPercent(1)
    setAgreed(false)
  }

  const contractRead = { chainId, query: { enabled: Boolean(launchAddress) } }
  const { data: creationFee = 0n } = useReadContract({
    abi: launchAbi,
    address: launchAddress,
    functionName: 'creationFee',
    ...contractRead,
  })
  // Defaulted to the factory's own ceiling rather than zero, so the field is usable in the frame
  // before the read lands. What actually gates a launch is the contract, which checks it again.
  const { data: maxCreatorShareBps = 5_000 } = useReadContract({
    abi: launchAbi,
    address: launchAddress,
    functionName: 'maxCreatorShareBps',
    ...contractRead,
  })
  const { data: openingSupplyValue = 0n } = useReadContract({
    abi: launchAbi,
    address: launchAddress,
    functionName: 'openingSupplyValue',
    ...contractRead,
  })

  /**
   * Which assets this token may be paired against.
   *
   * Two sources, and they answer different questions. The route says what EXISTS on the chain —
   * the coin, the curated stablecoins, and every tokenized equity in the issuer's live registry,
   * which is hundreds of names and so is served rather than bundled. The factory says what is
   * ALLOWED, one `quoteOpeningValue` per candidate, because an asset no admin has priced would
   * open a pool at a nonsense valuation: one unit of a stablecoin, one share of a stock and one
   * gas coin are not the same amount of money.
   *
   * So the list is the intersection, and an asset reaches the picker only once someone has
   * decided what a whole supply is worth in it.
   */
  const { data: quoteList } = useSWR(
    chainId ? `/api/v1/launches/quotes?networkId=${chainId}` : null,
    (url) => fetch(url).then((res) => res.json()),
    { revalidateOnFocus: false, dedupingInterval: 300_000 },
  )
  const candidates = useMemo(
    () => (quoteList?.data ?? []).filter((row) => row.kind !== 'native'),
    [quoteList],
  )

  const { data: candidateValues } = useReadContracts({
    allowFailure: true,
    contracts: candidates.map((row) => ({
      abi: launchAbi,
      address: launchAddress,
      functionName: 'quoteOpeningValue',
      args: [row.address],
      chainId,
    })),
    // One multicall for the whole registry rather than a request per ticker
    batchSize: 0,
    query: { enabled: Boolean(launchAddress && candidates.length > 0), staleTime: 60_000 },
  })

  const quoteOptions = useMemo(() => {
    const native = {
      address: zeroAddress,
      symbol: chainInfo?.nativeCurrency?.symbol ?? 'ETH',
      name: chainInfo?.nativeCurrency?.name ?? 'Ether',
      logo: null,
      openingValue: BigInt(openingSupplyValue ?? 0),
    }
    const approved = candidates
      .map((row, index) => ({
        ...row,
        openingValue: candidateValues?.[index]?.status === 'success' ? BigInt(candidateValues[index].result) : 0n,
      }))
      .filter((row) => row.openingValue > 0n)

    return [native, ...approved]
  }, [candidates, candidateValues, chainInfo, openingSupplyValue])

  // A chain switch, or an admin withdrawing an asset, can strand a selection that is no longer on
  // offer — falling back to native keeps the form launchable rather than silently unpayable
  useEffect(() => {
    if (!quoteOptions.some((option) => option.address.toLowerCase() === quoteAddress.toLowerCase())) {
      setQuoteAddress(zeroAddress)
    }
  }, [quoteOptions, quoteAddress])

  const quote = useQuoteAsset(chainId, quoteAddress)
  const isNativeQuote = quote.isNative
  const openingValue = useMemo(
    () => quoteOptions.find((option) => option.address.toLowerCase() === quoteAddress.toLowerCase())?.openingValue ?? 0n,
    [quoteOptions, quoteAddress],
  )
  // The opening buy is exempt from the launch tax but still pays the standing fee, so the
  // estimate grosses up by whatever the factory will stamp onto this launch
  const { data: launchBaseFee = 10_000 } = useReadContract({
    abi: launchAbi,
    address: launchAddress,
    functionName: 'baseFee',
    ...contractRead,
  })

  // The factory stores a share of collected fees, so the creator's number is converted on the way
  // in and its ceiling on the way out. Both hang off the standing pool fee.
  const maxFeeVolumeBps = volumeBpsFromCreatorShare(maxCreatorShareBps, launchBaseFee)
  const creatorShareBps = Math.min(creatorShareFromVolumeBps(feeVolumeBps, launchBaseFee), Number(maxCreatorShareBps))
  const feeRecipientIsValid = isAddress(feeRecipient)

  // The chain's HupSplits factory. Absent until one is deployed there, and the split option
  // stays hidden until then rather than offering a recipient nothing could ever pay out.
  const { factory: splitsFactory, isAvailable: splitsAvailable, isDeploying: isDeployingSplit, ensureSplit } = useSplitDeployer(chainId)
  const feePayees = useMemo(() => toSplitPayees(feeRows), [feeRows])
  const feeSplitIsValid = isValidSplit(feePayees)
  const feePayeesKey = JSON.stringify(feePayees)

  // The split's address is decided by its table, so it can be shown — and named as the launch's
  // fee recipient — before anything is deployed. Kept alongside the table it answers for, so an
  // edit blanks the address until the new one is back rather than showing the old split's.
  const [resolvedSplit, setResolvedSplit] = useState(null)
  useEffect(() => {
    let cancelled = false

    if (!splitsAvailable || !publicClient || feeMode !== 'split' || !feeSplitIsValid) return undefined

    predictSplitAddress({ publicClient, factory: splitsFactory, payees: JSON.parse(feePayeesKey) })
      .then((split) => {
        if (!cancelled) setResolvedSplit({ key: feePayeesKey, split })
      })
      .catch(() => {
        if (!cancelled) setResolvedSplit(null)
      })

    return () => {
      cancelled = true
    }
  }, [splitsAvailable, splitsFactory, publicClient, feeMode, feeSplitIsValid, feePayeesKey])

  const predictedSplit = feeMode === 'split' && resolvedSplit?.key === feePayeesKey ? resolvedSplit.split : ''

  // A draft written on a chain with a splits factory must not leave the form stuck on a mode
  // this one cannot offer
  useEffect(() => {
    if (!splitsAvailable) setFeeMode((current) => (current === 'split' ? 'me' : current))
  }, [splitsAvailable])

  // One address reaches the factory whichever way the fee is shared: a split is an address too
  const resolvedRecipient = feeMode === 'me' ? address ?? '' : feeMode === 'split' ? predictedSplit : feeRecipient
  const recipientIsReady = feeMode === 'split' ? feeSplitIsValid && isAddress(predictedSplit) : isAddress(resolvedRecipient)

  // The ceiling is a chain read, so a restored draft — or a draft written against another chain's
  // fee schedule — can land above whatever this factory allows
  useEffect(() => {
    if (!maxFeeVolumeBps) return
    setFeeVolumeBps((current) => clampFeeBps(current, maxFeeVolumeBps) || Math.min(DEFAULT_FEE_VOLUME_BPS, maxFeeVolumeBps))
  }, [maxFeeVolumeBps])

  useImperativeHandle(ref, () => ({
    open: () => {
      setStep('form')
      setAgreed(false)
      setCreated(null)
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  const {
    data: hash,
    isPending,
    mutate: writeContract,
    mutateAsync: writeContractAsync,
    error: submitError,
  } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } = useWaitForTransactionReceipt({ hash })

  const isBusy = isPending || isConfirming || isUploading || isImageUploading || isApproving || isDeployingSplit

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  const settle = (launchRef) => {
    toast(`$${symbol} is live`, 'success')
    // Onchain now, so the wording stops being a draft
    clearLaunchDraft()
    setRestoredDraft(false)
    const payload = launchRef ? { ...launchRef, chainId } : undefined

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
    settle(launchRefFromLogs(receipt?.logs))
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

  const buyTokens = useMemo(
    () => (TOTAL_SUPPLY * BigInt(Math.round(buyPercent * 100))) / 10_000n,
    [buyPercent],
  )
  // Priced against the launch position's closed form — the pool doesn't exist yet, so the
  // chain's quoter can't answer; the factory fills this exact swap atomically at creation
  const openingBuyWei = useMemo(
    () => (bundleBuy ? estimateOpeningBuy(openingValue, buyTokens, launchBaseFee) : 0n),
    [bundleBuy, openingValue, buyTokens, launchBaseFee],
  )

  // An ERC20 opening buy is pulled by the factory, so it needs a standing approval first. The
  // contract pulls from the real caller and never from a session key, so this is always the
  // connected wallet's own allowance.
  const { data: quoteAllowance = 0n, refetch: refetchQuoteAllowance } = useReadContract({
    abi: erc20Abi,
    address: isNativeQuote ? undefined : quoteAddress,
    functionName: 'allowance',
    args: [address ?? zeroAddress, launchAddress ?? zeroAddress],
    chainId,
    query: { enabled: Boolean(!isNativeQuote && address && launchAddress && openingBuyWei > 0n) },
  })
  const needsQuoteApproval = !isNativeQuote && openingBuyWei > 0n && quoteAllowance < openingBuyWei

  // A creator fee that is switched on but has nowhere to go is the one way this form can be
  // filled in and still wrong, so it gates Review alongside the token's own details
  const feeIsReady = !takeCreatorFee || (feeVolumeBps > 0 && recipientIsReady)
  const canReview = Boolean(image && name.trim() && symbol && description.trim() && feeIsReady && !isBusy)

  const handleReview = (event) => {
    event.preventDefault()
    if (!canReview) {
      const message = !feeIsReady
        ? feeVolumeBps <= 0
          ? 'Set a creator fee above zero, or switch it off'
          : feeMode === 'split'
            ? 'Give every payee a wallet and shares totalling 100%'
            : 'Enter the wallet your creator fee should be paid to'
        : 'Image, name, ticker, and description are all required'
      toast(message, 'error')
      return
    }
    setStep('review')
  }

  /**
   * Approves the factory to pull the opening buy, when the launch is quoted in an ERC20.
   *
   * Its own step rather than a silent prelude: it is a second signature and a second gas cost,
   * and the launch it unlocks is still to be sent from here. The button holds while it mines and
   * a toast reports how it landed, so nothing about the wait is hidden.
   */
  const handleApproveQuote = async () => {
    if (!address || !launchAddress) return
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    setIsApproving(true)
    let handle = null
    const report = (message, type) => {
      if (!handle?.update(message, type)) toast(message, type)
    }

    try {
      // Tether and its clones revert on any approve that moves a non-zero allowance to another
      // non-zero value, which is exactly what changing the buy size after approving would do.
      // Clearing first costs a signature only in that case, and never on a first approval.
      if (quoteAllowance > 0n) {
        const resetHash = await writeContractAsync({
          abi: erc20Abi,
          address: quoteAddress,
          functionName: 'approve',
          args: [launchAddress, 0n],
          chainId,
        })
        handle = toast(`Clearing the old ${quote.symbol} allowance…`, 'loading')
        await waitForTransactionReceipt(config, { chainId, hash: resetHash })
      }

      const hash = await writeContractAsync({
        abi: erc20Abi,
        address: quoteAddress,
        functionName: 'approve',
        args: [launchAddress, openingBuyWei],
        chainId,
      })

      if (!handle?.update(`Approving ${quote.symbol}…`, 'loading')) handle = toast(`Approving ${quote.symbol}…`, 'loading')
      const receipt = await waitForTransactionReceipt(config, { chainId, hash })
      if (receipt.status !== 'success') throw new Error(`${quote.symbol} approval was rejected onchain`)

      report(`${quote.symbol} approved — launch when ready`, 'success')
    } catch (err) {
      report(err.shortMessage || err.message || 'Approval failed', 'error')
    } finally {
      refetchQuoteAllowance()
      setIsApproving(false)
    }
  }

  const handleLaunch = async () => {
    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (!launchAddress) {
      toast("Token launches aren't available on this network yet", 'error')
      return
    }
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    // A split is deployed before the launch names it, so its payees are verifiable from the block
    // the token goes live rather than on trust. Its address is fixed by its table either way, so a
    // launch that named one already points at the right place — this only materializes the code.
    if (takeCreatorFee && feeMode === 'split') {
      if (!(await ensureSplit(predictedSplit, feePayees))) return
    }

    setIsUploading(true)
    let cid
    try {
      cid = await uploadObjectToIPFS(withAuthor({
        name: name.trim(),
        symbol,
        description: description.trim(),
        image,
      }, address))
    } catch (err) {
      toast(err.message || 'Failed to upload token details', 'error')
      setIsUploading(false)
      return
    }
    setIsUploading(false)

    // zeroAddress prices the launch in the chain's native coin; any other address is an ERC20 an
    // admin approved and priced, which is how a token gets quoted in a stablecoin.
    const args = [
      address,
      name.trim(),
      symbol,
      takeCreatorFee ? creatorShareBps : 0,
      takeCreatorFee ? resolvedRecipient : zeroAddress,
      cid,
      quoteAddress,
      openingBuyWei,
    ]
    // The opening buy fills in the same transaction, so there is no block in which the token
    // exists and the creator has not bought. The factory checks this total exactly — and an
    // ERC20 buy is pulled from the approval above rather than carried as value, so a launch
    // quoted in a token sends only the creation fee.
    const value = isNativeQuote ? creationFee + openingBuyWei : creationFee

    // Always the connected wallet, never a burner session: a launch spends the creator's own
    // money on the creation fee and the opening buy, and a session key holds none of it. It is
    // also what keeps the creator the signer, so the opening buy is credited to them rather than
    // to whoever paid the gas. Same line Hup draws for tips.
    writeContract({
      abi: launchAbi,
      address: launchAddress,
      functionName: 'createLaunch',
      args,
      value,
      chainId,
    })
  }

  const imageUrl = image ? resolveStorageImageUrl(image) : null

  // Named live rather than as fixed copy: the pairing is only a decision where more than one
  // asset is on offer, and it is the field creators most often assume they can revisit
  const permanentFields = useMemo(() => {
    const fields = ['Name', 'ticker', 'image', 'description']
    if (quoteOptions.length > 1) fields.push(`the ${quote.symbol} pairing`)
    return permanentList.format(fields)
  }, [quoteOptions.length, quote.symbol])

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.launchDialog}
      aria-label="Launch a token"
      onClick={(e) => e.stopPropagation()}
      // Rendered inside the composer and inside the attach picker — React's synthetic
      // close/cancel events propagate up the tree, so both must stop here or closing this
      // dialog closes its host too
      onClose={(e) => e.stopPropagation()}
      onCancel={(e) => e.stopPropagation()}
    >
      <header className={styles.launchDialog__header}>
        {step !== 'live' && (
          <button
            type="button"
            className={styles.launchDialog__cancel}
            onClick={() => (step === 'review' ? setStep('form') : dialogRef.current?.close())}
          >
            {step === 'review' ? 'Back' : 'Cancel'}
          </button>
        )}
        <h3>{step === 'review' ? 'Review' : step === 'live' ? 'Launched' : 'Token info'}</h3>
      </header>

      {step === 'form' && (
        <form className={styles.launchDialog__body} onSubmit={handleReview}>
          {restoredDraft && (
            <div className={styles.launchDialog__draft}>
              <span>Picked up where you left off.</span>
              <button type="button" onClick={resetLaunchForm} disabled={isBusy}>
                Start over
              </button>
            </div>
          )}
          <div className={styles.launchDialog__locked}>
            <LockIcon size={16} weight="fill" />
            <div>
              <strong>Permanent once launched</strong>
              <small>
                {permanentFields} can never be edited, and{' '}
                {takeCreatorFee
                  ? `the fee rate is locked at ${formatVolumeBps(feeVolumeBps)}`
                  : 'a launch with no creator fee can never add one'}
                .{' '}
                {takeCreatorFee
                  ? 'Only the wallet that fee pays, and your token page, can change later.'
                  : 'Only your token page can change later.'}
              </small>
            </div>
          </div>

          <div className={styles.launchDialog__identity}>
            <label className={clsx(styles.launchDialog__image, imageUrl && styles['launchDialog__image--filled'])}>
              {imageUrl ? <img src={imageUrl} alt="" /> : <ImageIcon size={22} weight="light" />}
              <input type="file" accept="image/*" onChange={handleImageSelect} disabled={isBusy} hidden />
            </label>
            <div className={styles.launchDialog__imageHint}>
              {imageUrl ? (
                <>
                  <strong>{imageName || 'Token image'}</strong>
                  <span className={styles.launchDialog__imageActions}>
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
                  <strong>Token image {isImageUploading && <em>uploading…</em>}</strong>
                  <small>256px or larger. Pulled from your post if it has one.</small>
                </>
              )}
            </div>
          </div>

          <div className={styles.launchDialog__row}>
            <label className={styles.launchDialog__field}>
              <span>Token name</span>
              <input
                type="text"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                placeholder="Untitled Token"
                onChange={(e) => setName(e.target.value)}
                disabled={isBusy}
              />
            </label>
            <label className={styles.launchDialog__field}>
              <span>Ticker symbol</span>
              <input
                type="text"
                value={symbol}
                placeholder="$TICKER"
                onChange={(e) => setSymbol(normalizeSymbol(e.target.value))}
                disabled={isBusy}
              />
            </label>
          </div>

          <label className={styles.launchDialog__field}>
            <span>
              Description
              <em className={styles.launchDialog__counter}>
                {description.length}/{MAX_DESCRIPTION_LENGTH}
              </em>
            </span>
            <textarea
              rows={3}
              value={description}
              maxLength={MAX_DESCRIPTION_LENGTH}
              placeholder="Briefly describe your token"
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBusy}
            />
          </label>

          <div className={styles.launchDialog__toggle}>
            <div>
              <strong>Creator fee</strong>
              <small>
                {takeCreatorFee ? (
                  <>
                    Earn {formatVolumeBps(feeVolumeBps)} of every buy, paid in {quote.symbol} to the address below and
                    claimable whenever you like.
                  </>
                ) : (
                  <>
                    Earn a cut of every buy, paid in {quote.symbol}. Off by default — a token with no creator fee reads
                    as cleaner to buyers, and the setting shows on the card either way.
                  </>
                )}
              </small>
            </div>
            <ToggleSwitch
              checked={takeCreatorFee}
              onChange={(event) => {
                setTakeCreatorFee(event.target.checked)
              }}
              aria-label="Take a creator fee on each buy"
              className={styles.launchDialog__switch}
              disabled={isBusy}
            />
          </div>

          {takeCreatorFee && (
            <>
              <div className={styles.launchDialog__fee}>
                <label className={styles.launchDialog__feeAmount}>
                  <span>Fee on every buy</span>
                  <div>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={maxFeeVolumeBps || 1}
                      step={1}
                      value={feeVolumeBps}
                      onChange={(e) => setFeeVolumeBps(clampFeeBps(e.target.value, maxFeeVolumeBps || 1))}
                      disabled={isBusy}
                    />
                    <em>bps</em>
                  </div>
                </label>
                <p className={styles.launchDialog__feeQuote}>
                  <strong>{formatVolumeBps(feeVolumeBps)}</strong>
                  <span>of every buy, up to {formatVolumeBps(maxFeeVolumeBps)}</span>
                </p>
              </div>

              <div className={styles.launchDialog__presets}>
                <span>
                  Fee paid to
                  <em className={styles.launchDialog__required}>*</em>
                </span>
                <div>
                  <button
                    type="button"
                    className={clsx(feeMode === 'me' && styles['launchDialog__preset--active'])}
                    onClick={() => setFeeMode('me')}
                    disabled={isBusy}
                  >
                    Me
                  </button>
                  <button
                    type="button"
                    className={clsx(feeMode === 'address' && styles['launchDialog__preset--active'])}
                    onClick={() => setFeeMode('address')}
                    disabled={isBusy}
                  >
                    One wallet
                  </button>
                  {splitsAvailable && (
                    <button
                      type="button"
                      className={clsx(feeMode === 'split' && styles['launchDialog__preset--active'])}
                      onClick={() => setFeeMode('split')}
                      disabled={isBusy}
                    >
                      Several
                    </button>
                  )}
                </div>
              </div>

              {feeMode === 'address' && (
                <label className={styles.launchDialog__field}>
                  <span>Fee recipient</span>
                  <div
                    className={clsx(
                      styles.launchDialog__recipient,
                      feeRecipient && !feeRecipientIsValid && styles['launchDialog__recipient--invalid'],
                    )}
                  >
                    <input
                      type="text"
                      value={feeRecipient}
                      placeholder="0x…"
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(e) => setFeeRecipient(e.target.value.trim())}
                      disabled={isBusy}
                    />
                    {feeRecipient && (
                      <button type="button" onClick={() => setFeeRecipient('')} aria-label="Clear fee recipient" disabled={isBusy}>
                        <XCircleIcon size={18} weight="fill" />
                      </button>
                    )}
                  </div>
                  <small>
                    {feeRecipient && !feeRecipientIsValid
                      ? 'That is not a valid address'
                      : 'Fee recipient can be updated any time'}
                  </small>
                </label>
              )}

              {feeMode === 'split' && (
                <div className={styles.launchDialog__field}>
                  <span>Who gets what</span>
                  <PayeeTable rows={feeRows} onChange={setFeeRows} chainId={chainId} disabled={isBusy} />
                  <small>
                    {predictedSplit
                      ? `Split contract: ${predictedSplit} — deployed with the launch, and its shares never change`
                      : 'The split address appears once the shares total 100%'}
                  </small>
                </div>
              )}
            </>
          )}

          {/* Only worth a row where there is a choice — most chains have the coin and nothing else */}
          {quoteOptions.length > 1 && (
            <label className={styles.launchDialog__field}>
              <span>Paired against</span>
              <QuoteAssetSelect
                options={quoteOptions}
                value={quoteAddress}
                onChange={setQuoteAddress}
                disabled={isBusy}
              />
              <small>
                What ${symbol || 'TOKEN'} trades against, and what every trade pays its fees in. This cannot be changed
                once the pool exists.
              </small>
            </label>
          )}

          <div className={styles.launchDialog__toggle}>
            <div>
              <strong>Buy pre-launch</strong>
              <small>Bundle a ${symbol || 'TOKEN'} buy into the launch transaction, so nobody can front-run you.</small>
            </div>
            <ToggleSwitch
              checked={bundleBuy}
              onChange={(event) => setBundleBuy(event.target.checked)}
              aria-label="Bundle a buy with the launch"
              className={styles.launchDialog__switch}
              disabled={isBusy}
            />
          </div>

          {bundleBuy && (
            <div className={styles.launchDialog__buySize}>
              <div className={styles.launchDialog__presets}>
                <span>Buy size, % of supply</span>
                <div>
                  {BUY_PRESETS.map((percent) => (
                    <button
                      type="button"
                      key={percent}
                      className={clsx(buyPercent === percent && styles['launchDialog__preset--active'])}
                      onClick={() => setBuyPercent(percent)}
                      disabled={isBusy}
                    >
                      {percent}%
                    </button>
                  ))}
                </div>
              </div>
              <p className={styles.launchDialog__buyQuote}>
                <strong>
                  {formatTokenAmount(buyTokens)} ${symbol || 'TOKEN'}
                </strong>
                <span>
                  {formatQuote(openingBuyWei, quote.decimals)} {quote.symbol}
                </span>
              </p>
            </div>
          )}

          <button type="submit" className={styles.launchDialog__submit} disabled={!canReview}>
            Review
          </button>
        </form>
      )}

      {step === 'review' && (
        <div className={styles.launchDialog__body}>
          <div className={styles.launchDialog__preview}>
            {imageUrl && <img src={imageUrl} alt="" />}
            <div>
              <strong>{name.trim()}</strong>
              <span>${symbol}</span>
              <p>{description.trim()}</p>
            </div>
            <span className={styles.launchDialog__mode}>
              <LightningIcon size={12} weight="fill" />
              Instant
            </span>
          </div>

          <dl className={styles.launchDialog__facts}>
            <div>
              <dt>Tradable</dt>
              <dd>Immediately</dd>
            </div>
            <div>
              <dt>Supply</dt>
              <dd>
                {formatTokenAmount(TOTAL_SUPPLY)}, fixed forever
                <small>Entire supply mapped to bonding curve</small>
              </dd>
            </div>
            <div>
              <dt>Liquidity</dt>
              <dd>Locked forever · fees auto-compound</dd>
            </div>
            <div>
              <dt>Paired against</dt>
              <dd>
                {quote.symbol}
                <small>Fixed at creation — the pool cannot be repriced in anything else</small>
              </dd>
            </div>
            <div>
              <dt>Creator fee</dt>
              <dd>
                {takeCreatorFee ? (
                  <>
                    {formatVolumeBps(feeVolumeBps)} of every buy
                    <small>
                      {feeMode === 'split'
                        ? `Split between ${feePayees.length} wallets via ${shortAddress(predictedSplit)}, changeable later`
                        : `Paid to ${shortAddress(resolvedRecipient)}, changeable later`}
                    </small>
                  </>
                ) : (
                  'None'
                )}
              </dd>
            </div>
            <div>
              <dt>Pre-launch buy</dt>
              <dd>
                {openingBuyWei > 0n ? (
                  <>
                    {formatTokenAmount(buyTokens)} ${symbol}
                    <small>
                      {formatQuote(openingBuyWei, quote.decimals)} {quote.symbol}
                    </small>
                  </>
                ) : (
                  'None'
                )}
              </dd>
            </div>
            {creationFee > 0n && (
              <div>
                <dt>Creation fee</dt>
                <dd>
                  {formatEther(creationFee)} {nativeSymbol}
                </dd>
              </div>
            )}
          </dl>

          <label className={styles.launchDialog__agree}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={isBusy} />
            <span>
              <strong>I understand and agree to the following</strong>
              Hup Launch uses one standard configuration for every launch, intended for memecoins — tokens made for
              entertainment and culture, whose price comes from demand alone. Nobody is working to make this token
              valuable. It is extremely volatile, it may go to zero, and it carries none of the protections a regulated
              asset would. Launching anything other than a memecoin is not allowed here.
            </span>
          </label>

          {/* An ERC20 opening buy is pulled by the factory, so it is approved first. Its own
              button, because it is a second signature and a second gas cost. */}
          <button
            type="button"
            className={styles.launchDialog__submit}
            onClick={needsQuoteApproval ? handleApproveQuote : handleLaunch}
            disabled={isBusy || !address || !agreed}
          >
            <RocketLaunchIcon size={16} weight="fill" />
            {isApproving
              ? `Approving ${quote.symbol}…`
              : needsQuoteApproval
                ? `Approve ${quote.symbol}`
                : isBusy
                  ? 'Launching…'
                  : 'Launch now'}
          </button>
        </div>
      )}

      {step === 'live' && created && (
        <div className={clsx(styles.launchDialog__body, styles.launchDialog__done)}>
          <span className={styles.launchDialog__doneMark}>
            {imageUrl && <img src={imageUrl} alt="" />}
            <CheckCircleIcon size={26} weight="fill" />
          </span>
          <h4>{name.trim()} is live</h4>
          <p>Live on Uniswap — tradable anywhere, liquidity locked forever.</p>

          <Link
            href={launchHref(chainId, created.token)}
            className={styles.launchDialog__submit}
            onClick={() => dialogRef.current?.close()}
          >
            View token
          </Link>
        </div>
      )}
    </NativeDialog>
  )
})

export default CreateLaunchDialog
