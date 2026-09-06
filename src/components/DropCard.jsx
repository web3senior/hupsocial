'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useConnection, usePublicClient, useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { formatUnits, isAddress, zeroAddress } from 'viem'
import clsx from 'clsx'
import { LockSimpleOpenIcon, LockSimpleIcon, MinusIcon, PlusIcon, UsersIcon } from '@phosphor-icons/react'
import HupMark from '@/components/ui/HupMark'
import ProgressBar from '@/components/ui/ProgressBar'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { DROP_GATES, DROP_RECORD_ABI, formatPhaseTime, gateLabel, isLuksoStandard, isNumberedStandard, latestMintedTokenIds, normalizeDropCardOptions, phaseStatus, PHASE_STATUS } from '@/lib/drops'
import { tokenPageHref } from '@/lib/nftLinks'
import useNftMetadata from '@/hooks/useNftMetadata'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { networkColorStyle } from '@/lib/networkColors'
import { describeWalletError } from '@/lib/walletErrors'
import { handleBrokenImage } from '@/lib/utils'
import dropsAbi from '@/abis/HupDrops.json'
import { toast } from '@/components/NextToast'
import MintReviewDialog from './MintReviewDialog'
import styles from './DropCard.module.scss'

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })
const countFormat = new Intl.NumberFormat('en')

const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`

// What each of the engine's refusals means to the person minting; the ones that carry numbers
// read them out of the revert when the node decoded it
const MINT_REVERTS = {
  WalletLimitReached: ([limit]) =>
    limit !== undefined ? `This wallet has already minted its ${countFormat.format(Number(limit))} for this phase.` : 'This wallet has minted all this phase allows.',
  SupplyExceeded: ([, remaining]) =>
    remaining !== undefined ? `Only ${countFormat.format(Number(remaining))} left — lower the quantity.` : 'Not enough left for that quantity.',
  AllocationExceeded: ([, remaining]) =>
    remaining !== undefined ? `This phase has only ${countFormat.format(Number(remaining))} left.` : 'This phase does not have that many left.',
  PhaseNotActive: () => 'This phase is not open right now.',
  DropNotActive: () => 'This drop has closed.',
  GateNotPassed: () => "This wallet doesn't meet the phase's requirement.",
  InsufficientPayment: () => 'The price changed since this page loaded — reload and try again.',
  InvalidReferral: () => 'This referral link cannot credit anyone for your mint — open the drop without it and try again.',
  Unauthorized: () => 'Your wallet is signing as a different account than the one connected here — switch accounts in the wallet or reconnect.',
  SessionExpired: () => 'Your session key has expired — reconnect and try again.',
  EnforcedPause: () => 'Minting is paused on this network for the moment.',
  TransferFailed: () => "The creator's payout address is refusing the payment — the creator has to fix it before anyone can mint.",
}
// The same sentences keyed by name, for describeWalletError once a wallet has already refused
const KNOWN_MINT_REVERTS = Object.fromEntries(Object.entries(MINT_REVERTS).map(([name, describe]) => [name, describe([])]))

/** The engine's decoded refusal inside a viem error, as a sentence, or null when it is something else. */
const describeMintRevert = (error) => {
  const revert = error?.walk?.((link) => link?.name === 'ContractFunctionRevertedError')
  const name = revert?.data?.errorName
  return name && MINT_REVERTS[name] ? MINT_REVERTS[name](revert.data.args ?? []) : null
}

const isInsufficientFunds = (error) => Boolean(error?.walk?.((link) => /insufficient funds/i.test(`${link?.details ?? ''} ${link?.message ?? ''}`)))

const ERC20_TOKEN_ABI = [
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
]

const LSP7_TOKEN_ABI = [
  { name: 'authorizedAmountFor', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'authorizeOperator', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }], outputs: [] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
]

/** One tile of the minted-pieces strip; its own component because each token resolves through useNftMetadata. */
function DropPiece({ chainId, collection, tokenId, isLsp8, fallbackUrl, preview }) {
  const { image, name } = useNftMetadata({ chainId, collection, tokenId, isLsp8, imageWidth: 192, still: true })
  const src = image || fallbackUrl
  const label = name || `#${BigInt(tokenId).toString()}`
  const href = preview ? null : tokenPageHref({ networkId: chainId, collection, tokenId, isLsp8 })
  const body = src ? (
    <img src={src} alt={label} loading="lazy" onError={handleBrokenImage} />
  ) : (
    <span className={styles.dropCard__pieceFallback}>
      <HupMark size={14} />
    </span>
  )

  return href ? (
    <Link href={href} className={styles.dropCard__piece} title={label}>
      {body}
    </Link>
  ) : (
    <span className={styles.dropCard__piece} title={label}>
      {body}
    </span>
  )
}

/**
 * Drop Card
 * Embedded mint card for posts carrying an `nftDrop` content reference. The payload is only a
 * pointer plus static art; supply, phases, progress, and gate eligibility resolve live from the engine.
 * `drop.show` (stats / pieces / mint) is what the author chose to embed; absent flags show everything.
 * @param {string} [props.referral] Reposter credited with mints that arrive via their share.
 * @param {boolean} [props.compact] Mint panel only — no media or title.
 * @param {boolean} [props.preview] Inert — composer and embed-dialog previews; nothing mints or navigates.
 * @param {string} [props.className] Extra class on the root, for the consumer's spacing.
 */
const DropCard = ({ drop, referral, showDetailsLink = true, compact = false, preview = false, className }) => {
  const [quantity, setQuantity] = useState(1)
  const [isBurnerBusy, setIsBurnerBusy] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const { address, connector } = useConnection()
  const mintedToastRef = useRef(false)
  // The one loading toast a mint holds open from the wallet prompt to the receipt
  const mintToastRef = useRef(null)

  const chainId = Number(drop?.chainId)
  const publicClient = usePublicClient({ chainId })
  const chainInfo = appChains.find((c) => c.id === chainId)
  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops || null
  const nativeCurrency = chainInfo?.nativeCurrency
  const dropId = drop?.dropId ? BigInt(drop.dropId) : null

  const { data: liveDrop, refetch: refetchDrop } = useReadContract({
    abi: DROP_RECORD_ABI,
    address: dropsAddress,
    functionName: 'getDrop',
    args: [dropId ?? 0n],
    chainId,
    query: { enabled: Boolean(dropsAddress && dropId) },
  })

  const { data: phases = [], refetch: refetchPhases } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'phasesOf',
    args: [dropId ?? 0n],
    chainId,
    query: { enabled: Boolean(dropsAddress && dropId) },
  })

  // Flat per-item platform fee; it applies to free phases too
  const { data: feeReads } = useReadContracts({
    contracts: [
      { address: dropsAddress ?? undefined, abi: dropsAbi, functionName: 'mintFee', chainId },
      { address: dropsAddress ?? undefined, abi: dropsAbi, functionName: 'mintFeeEnabled', chainId },
    ],
    query: { enabled: Boolean(dropsAddress) },
  })
  const platformFee = feeReads?.[1]?.result === true ? (feeReads[0]?.result ?? 0n) : 0n

  const activeIndex = useMemo(() => phases.findIndex((phase) => phaseStatus(phase) === PHASE_STATUS.LIVE), [phases])
  // Nothing live: the card quotes the next phase up, else the last one that ran
  const upcomingIndex = useMemo(() => phases.findIndex((phase) => phaseStatus(phase) === PHASE_STATUS.UPCOMING), [phases])
  const phaseIndex = activeIndex !== -1 ? activeIndex : upcomingIndex !== -1 ? upcomingIndex : Math.max(0, phases.length - 1)
  const phase = phases[phaseIndex] ?? null

  const { data: mintedByMe = 0n, refetch: refetchMintedByMe } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'mintedInPhaseBy',
    args: [dropId ?? 0n, BigInt(phaseIndex), address ?? zeroAddress],
    chainId,
    query: { enabled: Boolean(dropsAddress && dropId && address && phase) },
  })

  // isMintable covers every gate onchain, the allowlist included
  const { data: gatePasses } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'isMintable',
    args: [dropId ?? 0n, BigInt(phaseIndex), address ?? zeroAddress, 1n],
    chainId,
    query: { enabled: Boolean(dropsAddress && dropId && address && phase) },
  })

  const phaseToken = phase?.token && phase.token !== zeroAddress ? phase.token : null
  const { data: tokenMetaReads } = useReadContracts({
    contracts: [
      { address: phaseToken ?? undefined, abi: ERC20_TOKEN_ABI, functionName: 'decimals', chainId },
      { address: phaseToken ?? undefined, abi: ERC20_TOKEN_ABI, functionName: 'symbol', chainId },
    ],
    query: { enabled: Boolean(phaseToken) },
  })
  // LSP7 answers decimals() but keeps its symbol in ERC725Y, so a missing symbol is normal
  const tokenMeta = phaseToken
    ? { decimals: Number(tokenMetaReads?.[0]?.result ?? 18), symbol: tokenMetaReads?.[1]?.result || 'tokens' }
    : null

  const reviewRef = useRef(null)

  // Read here rather than only inside handleMint: the review screen has to say whether this is a
  // one- or two-transaction mint BEFORE the first prompt, and finding out at the second one is
  // exactly the surprise the screen exists to prevent.
  const { data: allowanceRaw } = useReadContract({
    address: phaseToken ?? undefined,
    abi: phase?.isLsp7 ? LSP7_TOKEN_ABI : ERC20_TOKEN_ABI,
    functionName: phase?.isLsp7 ? 'authorizedAmountFor' : 'allowance',
    args: phase?.isLsp7 ? [dropsAddress, address ?? zeroAddress] : [address ?? zeroAddress, dropsAddress],
    chainId,
    query: { enabled: Boolean(phaseToken && address && dropsAddress) },
  })

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { data: receipt, isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  // Separate hook: sharing `hash` with the mint would fire the confirmed effect on the approval's receipt
  const { writeContractAsync: writeApprovalAsync } = useWriteContract()
  const isBusy = isPending || isConfirming || isBurnerBusy || isApproving || isChecking
  // What the review dialog's button says while it waits — derived, so no effect has to set it
  const mintStage = isApproving ? 'approve' : isChecking ? 'check' : isPending ? 'wallet' : isConfirming || isBurnerBusy ? 'mining' : null

  /** The verdict lands on the loading toast the mint opened, or on a fresh one if that is gone. */
  const settleMint = (message, type) => {
    const handle = mintToastRef.current
    mintToastRef.current = null
    if (!handle?.update(message, type)) toast(message, type)
  }

  // A refusal hands the review form back rather than closing it, so the minter can try again
  useEffect(() => {
    if (!submitError) return
    settleMint(describeWalletError(submitError, { known: KNOWN_MINT_REVERTS, fallback: 'Transaction rejected' }), 'error')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitError])

  // Signed: the wait moves from the wallet to the chain
  useEffect(() => {
    if (hash) mintToastRef.current?.update('Minting… waiting for the network to confirm', 'loading')
  }, [hash])

  useEffect(() => {
    if (!isConfirmed || mintedToastRef.current) return
    mintedToastRef.current = true
    // viem hands back a reverted receipt rather than throwing, so the status is the verdict
    if (receipt?.status === 'reverted') {
      settleMint('The mint failed onchain — nothing was charged beyond gas', 'error')
      return
    }
    settleMint('Minted — it now belongs to you', 'success')
    reviewRef.current?.close()
    refetchDrop()
    refetchPhases()
    refetchMintedByMe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  // A card that leaves the page mid-mint takes its spinner with it rather than leaving one stuck
  useEffect(() => () => mintToastRef.current?.dismiss(), [])

  if (!drop?.dropId || !dropsAddress) return null

  const minted = liveDrop ? Number(liveDrop.minted) : 0
  const maxSupply = liveDrop ? Number(liveDrop.maxSupply) : 0
  const creator = liveDrop?.creator
  const isClosed = Boolean(liveDrop?.closed)
  const isSoldOut = maxSupply > 0 && minted >= maxSupply
  const isOpenEdition = maxSupply === 0

  const show = normalizeDropCardOptions(drop.show)
  const isLsp8 = isLuksoStandard(drop.standardId)
  // Editions share one artwork, so only numbered collections have pieces to show
  const pieceIds = show.pieces && isNumberedStandard(drop.standardId) && drop.collection ? latestMintedTokenIds(minted, drop.standardId) : []

  const status = phase ? phaseStatus(phase) : null
  const isLive = status === PHASE_STATUS.LIVE && !isClosed && !isSoldOut

  const price = phase ? phase.price : 0n
  const isTokenPriced = Boolean(phase?.token && phase.token !== zeroAddress)
  const perWallet = phase ? Number(phase.perWallet) : 0
  const allocation = phase ? Number(phase.allocation) : 0
  const gate = phase ? Number(phase.gate) : DROP_GATES.OPEN

  const supplyRemaining = isOpenEdition ? Infinity : Math.max(0, maxSupply - minted)
  const allocationRemaining = allocation === 0 ? Infinity : Math.max(0, allocation - Number(phase?.minted ?? 0))
  const walletRemaining = perWallet === 0 ? Infinity : Math.max(0, perWallet - Number(mintedByMe))
  const maxQuantity = Math.min(supplyRemaining, allocationRemaining, walletRemaining, 100)
  const boundedQuantity = Math.max(1, Math.min(quantity, maxQuantity === Infinity ? 100 : maxQuantity || 1))

  const totalPrice = price * BigInt(boundedQuantity)
  const isFree = price === 0n
  // The platform fee is always native, so it never folds into totalPrice (the phase's currency)
  const totalPlatformFee = platformFee * BigInt(boundedQuantity)
  const hasPlatformFee = totalPlatformFee > 0n
  const platformFeeNumber = Number(formatUnits(totalPlatformFee, nativeCurrency?.decimals ?? 18))
  const nativeSymbol = nativeCurrency?.symbol ?? ''
  // Token prices are in the token's own decimals
  const paymentDecimals = isTokenPriced ? (tokenMeta?.decimals ?? 18) : (nativeCurrency?.decimals ?? 18)
  const priceNumber = Number(formatUnits(price, paymentDecimals))
  const totalNumber = Number(formatUnits(totalPrice, paymentDecimals))
  const symbol = isTokenPriced ? (tokenMeta?.symbol ?? 'tokens') : (nativeCurrency?.symbol ?? '')

  const gateBlocked = Boolean(address && phase && gate !== DROP_GATES.OPEN && gatePasses === false)

  // The engine rejects self- and creator-referrals, and any referral on a drop that pays none
  const paysReferral = Number(liveDrop?.referralBps ?? 0) > 0
  const referralArg =
    paysReferral &&
    referral &&
    isAddress(referral) &&
    referral.toLowerCase() !== address?.toLowerCase() &&
    referral.toLowerCase() !== creator?.toLowerCase()
      ? referral
      : zeroAddress

  const imageUrl = drop.image ? resolveStorageImageUrl(drop.image) : null
  // The square icon reads at marker size where the full artwork cannot; older feed embeds carry no icon
  const markerArt = drop.icon || drop.image
  const markerUrl = markerArt ? resolveStorageImageUrl(markerArt, { width: 48 }) : null

  /**
   * Runs the mint against the chain before the wallet is asked, so a refusal arrives as a reason
   * rather than the wallet's bare "could not estimate gas". Resolves to the sentence to show, or
   * null when the mint should go ahead — which includes the check itself failing to run, since a
   * flaky RPC must not block a mint the wallet's own node would accept.
   */
  const preflightMint = async (args, value) => {
    if (!publicClient) return null
    const decimals = nativeCurrency?.decimals ?? 18
    const symbol = nativeCurrency?.symbol ?? ''
    const amount = (wei) => `${amountFormat.format(Number(formatUnits(wei, decimals)))} ${symbol}`

    // The wallet signs with whichever account it has selected, which is not always the one this page connected
    const accounts = await connector?.getAccounts?.().catch(() => null)
    if (accounts?.length && !accounts.some((account) => account.toLowerCase() === address.toLowerCase())) {
      return `Your wallet is on a different account than the one connected here (${shortAddress(address)}) — switch to it in the wallet or reconnect.`
    }

    let balance
    let code
    try {
      ;[balance, code] = await Promise.all([publicClient.getBalance({ address }), publicClient.getCode({ address })])
    } catch {
      return null
    }
    if (balance < value) return `This wallet holds ${amount(balance)} and the mint costs ${amount(value)}.`

    const request = { address: dropsAddress, abi: dropsAbi, functionName: 'mint', args, account: address, value }
    try {
      await publicClient.simulateContract(request)
      // A smart account (Universal Profile, Safe) usually has its gas relayed, so only a plain
      // wallet paying its own way has to afford gas on top of the price
      if (value > 0n && !code) await publicClient.estimateContractGas(request)
      return null
    } catch (err) {
      const reason = describeMintRevert(err)
      if (reason) return reason
      if (isInsufficientFunds(err)) {
        return `This wallet holds ${amount(balance)}: enough for the price, not for the gas on top. Add a little ${symbol} and try again.`
      }
      return null
    }
  }

  // No event when the review dialog confirms — only a direct card click has one to contain
  const handleMint = async (e) => {
    e?.stopPropagation()
    if (!phase || !address) return

    if (gate === DROP_GATES.ALLOWLIST && gatePasses === false) {
      toast("You're not on this drop's allowlist", 'error')
      return
    }

    mintedToastRef.current = false
    // One toast for the whole mint: it changes its words at each wait and ends as the verdict
    mintToastRef.current?.dismiss()
    mintToastRef.current = toast('Checking the mint…', 'loading')
    const args = [address, dropId, BigInt(phaseIndex), BigInt(boundedQuantity), referralArg]
    // A token phase sends only the native platform fee as value — the engine pulls the token price
    const mintValue = (isTokenPriced ? 0n : totalPrice) + totalPlatformFee

    if (isTokenPriced && totalPrice > 0n) {
      try {
        setIsApproving(true)
        // ERC20 allowance is (owner, spender); LSP7 is (operator, owner)
        const allowance = await publicClient.readContract({
          address: phase.token,
          abi: phase.isLsp7 ? LSP7_TOKEN_ABI : ERC20_TOKEN_ABI,
          functionName: phase.isLsp7 ? 'authorizedAmountFor' : 'allowance',
          args: phase.isLsp7 ? [dropsAddress, address] : [address, dropsAddress],
        })

        if (allowance < totalPrice) {
          mintToastRef.current?.update('Approve the token in your wallet — one transaction, then the mint', 'loading')
          await writeApprovalAsync({
            address: phase.token,
            abi: phase.isLsp7 ? LSP7_TOKEN_ABI : ERC20_TOKEN_ABI,
            functionName: phase.isLsp7 ? 'authorizeOperator' : 'approve',
            args: phase.isLsp7 ? [dropsAddress, totalPrice, '0x'] : [dropsAddress, totalPrice],
            chainId,
          })
          mintToastRef.current?.update('Approved — now confirm the mint in your wallet…', 'loading')
        }
      } catch (err) {
        settleMint(describeWalletError(err, { fallback: 'Approving the token failed' }), 'error')
        return
      } finally {
        setIsApproving(false)
      }
    }

    setIsChecking(true)
    const problem = await preflightMint(args, mintValue).finally(() => setIsChecking(false))
    if (problem) {
      settleMint(problem, 'error')
      return
    }
    mintToastRef.current?.update('Confirm the mint in your wallet…', 'loading')

    // Burner sessions send msg.value 0, so any paid mint (platform fee included) uses the connected wallet
    const session =
      mintValue === 0n
        ? await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))
        : { active: false }

    if (session.active) {
      setIsBurnerBusy(true)
      // The session key signs without a prompt and the write waits for the receipt itself
      mintToastRef.current?.update('Minting… waiting for the network to confirm', 'loading')
      try {
        await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: dropsAddress,
          abi: dropsAbi,
          functionName: 'mint',
          args: [...args, { value: mintValue }],
        })

        settleMint('Minted — it now belongs to you', 'success')
        reviewRef.current?.close()
        refetchDrop()
        refetchPhases()
        refetchMintedByMe()
      } catch (err) {
        settleMint(describeWalletError(err, { known: KNOWN_MINT_REVERTS, fallback: 'Transaction rejected or encountered an error.' }), 'error')
      } finally {
        setIsBurnerBusy(false)
      }
      return
    }

    writeContract({
      abi: dropsAbi,
      address: dropsAddress,
      functionName: 'mint',
      args,
      chainId,
      value: mintValue,
    })
  }

  const statusBadge = isClosed
    ? 'Closed'
    : isSoldOut
      ? 'Sold out'
      : status === PHASE_STATUS.PAUSED
        ? 'Paused by the creator'
        : status === PHASE_STATUS.UPCOMING
          ? `Starts ${formatPhaseTime(phase.startTime)}`
          : status === PHASE_STATUS.ENDED
            ? 'Ended'
            : null

  return (
    // Colours come from the drop's chain, not the connected wallet's
    <div
      className={clsx(styles.dropCard, { [styles['dropCard--compact']]: compact, [styles['dropCard--preview']]: preview }, className)}
      style={networkColorStyle(chainInfo)}
      onClick={(e) => e.stopPropagation()}
    >
      {!compact && (
        <div className={styles.dropCard__top}>
          <div className={styles.dropCard__media}>
            {imageUrl ? (
              <img src={imageUrl} alt={drop.name || 'Drop artwork'} loading="lazy" onError={handleBrokenImage} />
            ) : (
              <div className={styles.dropCard__mediaFallback}>
                <HupMark size={22} />
              </div>
            )}
            {isSoldOut && <span className={styles.dropCard__mediaBadge}>Sold out</span>}
          </div>

          <div className={styles.dropCard__info}>
            <span className={styles.dropCard__eyebrow}>{drop.symbol ? `Drop · ${drop.symbol}` : 'Drop'}</span>
            <div className={styles.dropCard__title}>{drop.name || 'Untitled drop'}</div>

            {show.stats && phase && (
              <div className={styles.dropCard__meta}>
                <span className={styles.dropCard__chip}>{isFree ? 'Free' : `${amountFormat.format(priceNumber)} ${symbol}`}</span>
                {hasPlatformFee && (
                  <span className={clsx(styles.dropCard__chip, styles['dropCard__chip--muted'])}>
                    + {amountFormat.format(Number(formatUnits(platformFee, nativeCurrency?.decimals ?? 18)))} {nativeSymbol} fee
                  </span>
                )}
                <span className={clsx(styles.dropCard__chip, styles['dropCard__chip--muted'])}>
                  {gate === DROP_GATES.OPEN ? <LockSimpleOpenIcon size={11} /> : gate === DROP_GATES.FOLLOWERS ? <UsersIcon size={11} /> : <LockSimpleIcon size={11} />}
                  {gateLabel(gate)}
                </span>
                <span className={clsx(styles.dropCard__chip, styles['dropCard__chip--muted'])}>
                  {perWallet === 0 ? '∞ per wallet' : `${perWallet} per wallet`}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {show.stats && isOpenEdition && (
        <div className={styles.dropCard__progress}>
          <span className={styles.dropCard__progressLabel}>{countFormat.format(minted)} minted · open edition</span>
        </div>
      )}

      {show.stats && !isOpenEdition && (
        <ProgressBar
          className={styles.dropCard__progress}
          label={<span className={styles.dropCard__progressLabel}>{`${countFormat.format(minted)}/${countFormat.format(maxSupply)} minted`}</span>}
          value={minted}
          max={maxSupply}
          color={chainInfo?.primaryColor}
          animated={isLive}
          sparkle={isLive}
          marker={markerUrl ? <img src={markerUrl} alt="" loading="lazy" /> : <HupMark size={9} />}
          markerSize={16}
          ariaLabel={`${countFormat.format(minted)} of ${countFormat.format(maxSupply)} minted`}
        />
      )}

      {pieceIds.length > 0 && (
        <div className={styles.dropCard__pieces} aria-label="Latest minted pieces">
          {pieceIds.map((tokenId) => (
            <DropPiece key={tokenId} chainId={chainId} collection={drop.collection} tokenId={tokenId} isLsp8={isLsp8} fallbackUrl={imageUrl} preview={preview} />
          ))}
        </div>
      )}

      <div className={styles.dropCard__actions}>
        {statusBadge && <span className={styles.dropCard__badge}>{statusBadge}</span>}

        {show.mint && isLive && gateBlocked && (
          <span className={styles.dropCard__badge}>
            {gate === DROP_GATES.FOLLOWERS ? 'Follow the creator to mint' : 'Requires the gated asset'}
          </span>
        )}

        {show.mint && isLive && !gateBlocked && (
          <>
            {maxQuantity !== 1 && (
              <div className={styles.dropCard__quantity}>
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, boundedQuantity - 1))}
                  disabled={isBusy || boundedQuantity <= 1}
                  aria-label="Fewer"
                >
                  <MinusIcon size={14} />
                </button>
                <span>{boundedQuantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(Math.min(maxQuantity === Infinity ? 100 : maxQuantity, boundedQuantity + 1))}
                  disabled={isBusy || boundedQuantity >= maxQuantity}
                  aria-label="More"
                >
                  <PlusIcon size={14} />
                </button>
              </div>
            )}

            {walletRemaining === 0 ? (
              <span className={styles.dropCard__badge}>Wallet limit reached</span>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.dropCard__mint}
                  onClick={() => !preview && reviewRef.current?.open()}
                  disabled={isBusy || !address}
                >
                  {isBusy ? 'Minting…' : isFree ? 'Mint free' : `Mint · ${amountFormat.format(totalNumber)} ${symbol}`}
                </button>
                {hasPlatformFee && (
                  <span className={styles.dropCard__feeNote}>
                    {isFree ? 'Free to mint · ' : ''}
                    {amountFormat.format(platformFeeNumber)} {nativeSymbol} platform fee
                    {boundedQuantity > 1 ? ` (${boundedQuantity} × ${amountFormat.format(Number(formatUnits(platformFee, nativeCurrency?.decimals ?? 18)))})` : ''}
                  </span>
                )}
              </>
            )}
          </>
        )}

        {showDetailsLink && preview && <span className={styles.dropCard__view}>View</span>}
        {showDetailsLink && !preview && (
          <Link href={`/drops/${chainId}/${drop.dropId}`} className={styles.dropCard__view}>
            View
          </Link>
        )}

        {/* The card still owns the mint — the dialog only gathers the confirmation, so every
            path out of it (session key, approval, plain write) stays in one place */}
        {!preview && (
          <MintReviewDialog
            ref={reviewRef}
            name={drop.name || 'this drop'}
            imageUrl={imageUrl}
            quantity={boundedQuantity}
            unitPrice={price}
            totalPrice={totalPrice}
            priceSymbol={symbol}
            priceDecimals={paymentDecimals}
            platformFeeTotal={totalPlatformFee}
            nativeSymbol={nativeSymbol}
            nativeDecimals={nativeCurrency?.decimals ?? 18}
            needsApproval={Boolean(isTokenPriced && totalPrice > 0n && (allowanceRaw ?? 0n) < totalPrice)}
            recipient={address ?? ''}
            chainName={chainInfo?.name}
            busy={isBusy}
            stage={mintStage}
            onConfirm={handleMint}
          />
        )}
      </div>
    </div>
  )
}

export default DropCard
