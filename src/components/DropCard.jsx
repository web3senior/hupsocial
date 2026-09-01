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
import { DROP_GATES, formatPhaseTime, gateLabel, phaseStatus, PHASE_STATUS } from '@/lib/drops'
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

/**
 * Drop Card
 * Embedded mint card for posts carrying an `nftDrop` content reference. The payload is only a
 * pointer plus static art; supply, phases, progress, and gate eligibility resolve live from the engine.
 * @param {string} [props.referral] Reposter credited with mints that arrive via their share.
 * @param {boolean} [props.compact] Mint panel only — no media or title.
 */
const DropCard = ({ drop, referral, showDetailsLink = true, compact = false }) => {
  const [quantity, setQuantity] = useState(1)
  const [selectedPhase, setSelectedPhase] = useState(null)
  const [isBurnerBusy, setIsBurnerBusy] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const { address } = useConnection()
  const mintedToastRef = useRef(false)

  const chainId = Number(drop?.chainId)
  const publicClient = usePublicClient({ chainId })
  const chainInfo = appChains.find((c) => c.id === chainId)
  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops || null
  const nativeCurrency = chainInfo?.nativeCurrency
  const dropId = drop?.dropId ? BigInt(drop.dropId) : null

  const { data: liveDrop, refetch: refetchDrop } = useReadContract({
    abi: dropsAbi,
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
  const phaseLabel = (phase, index) => phase?.name?.trim() || `Stage ${index + 1}`
  const phaseIndex = selectedPhase ?? (activeIndex === -1 ? 0 : activeIndex)
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
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  // Separate hook: sharing `hash` with the mint would fire the confirmed effect on the approval's receipt
  const { writeContractAsync: writeApprovalAsync } = useWriteContract()
  const isBusy = isPending || isConfirming || isBurnerBusy || isApproving

  useEffect(() => {
    if (!submitError) return
    toast(describeWalletError(submitError, { fallback: 'Transaction rejected' }), 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed || mintedToastRef.current) return
    mintedToastRef.current = true
    toast('Minted — it now belongs to you', 'success')
    refetchDrop()
    refetchPhases()
    refetchMintedByMe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  if (!drop?.dropId || !dropsAddress) return null

  const minted = liveDrop ? Number(liveDrop.minted) : 0
  const maxSupply = liveDrop ? Number(liveDrop.maxSupply) : 0
  const creator = liveDrop?.creator
  const isClosed = Boolean(liveDrop?.closed)
  const isSoldOut = maxSupply > 0 && minted >= maxSupply
  const isOpenEdition = maxSupply === 0

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

  // The engine rejects self- and creator-referrals
  const referralArg =
    referral && isAddress(referral) && referral.toLowerCase() !== address?.toLowerCase() && referral.toLowerCase() !== creator?.toLowerCase()
      ? referral
      : zeroAddress

  const imageUrl = drop.image ? resolveStorageImageUrl(drop.image) : null
  const markerUrl = drop.image ? resolveStorageImageUrl(drop.image, { width: 48 }) : null

  const handleMint = async (e) => {
    e.stopPropagation()
    if (!phase || !address) return

    if (gate === DROP_GATES.ALLOWLIST && gatePasses === false) {
      toast("You're not on this drop's allowlist", 'error')
      return
    }

    mintedToastRef.current = false
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
          toast('Approve the token first — one transaction, then the mint', 'success')
          await writeApprovalAsync({
            address: phase.token,
            abi: phase.isLsp7 ? LSP7_TOKEN_ABI : ERC20_TOKEN_ABI,
            functionName: phase.isLsp7 ? 'authorizeOperator' : 'approve',
            args: phase.isLsp7 ? [dropsAddress, totalPrice, '0x'] : [dropsAddress, totalPrice],
            chainId,
          })
        }
      } catch (err) {
        toast(describeWalletError(err, { fallback: 'Approving the token failed' }), 'error')
        return
      } finally {
        setIsApproving(false)
      }
    }

    // Burner sessions send msg.value 0, so any paid mint (platform fee included) uses the connected wallet
    const session =
      mintValue === 0n
        ? await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))
        : { active: false }

    if (session.active) {
      setIsBurnerBusy(true)
      try {
        await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: dropsAddress,
          abi: dropsAbi,
          functionName: 'mint',
          args: [...args, { value: mintValue }],
        })

        toast('Minted — it now belongs to you', 'success')
        refetchDrop()
        refetchPhases()
        refetchMintedByMe()
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
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
    <div className={clsx(styles.dropCard, { [styles['dropCard--compact']]: compact })} style={networkColorStyle(chainInfo)} onClick={(e) => e.stopPropagation()}>
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

            {phase && (
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

      {isOpenEdition ? (
        <div className={styles.dropCard__progress}>
          <span className={styles.dropCard__progressLabel}>{countFormat.format(minted)} minted · open edition</span>
        </div>
      ) : (
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

      {phases.length > 1 && (
        <div className={styles.dropCard__phases}>
          {phases.map((p, i) => {
            const s = phaseStatus(p)
            return (
              <button
                key={i}
                type="button"
                className={clsx(styles.dropCard__phase, {
                  [styles['dropCard__phase--selected']]: i === phaseIndex,
                  [styles['dropCard__phase--live']]: s === PHASE_STATUS.LIVE,
                })}
                onClick={() => setSelectedPhase(i)}
              >
                {phaseLabel(p, i)}
                {s === PHASE_STATUS.LIVE && <em>Live</em>}
              </button>
            )
          })}
        </div>
      )}

      <div className={styles.dropCard__actions}>
        {statusBadge && <span className={styles.dropCard__badge}>{statusBadge}</span>}

        {isLive && gateBlocked && (
          <span className={styles.dropCard__badge}>
            {gate === DROP_GATES.FOLLOWERS ? 'Follow the creator to mint' : 'Requires the gated asset'}
          </span>
        )}

        {isLive && !gateBlocked && (
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
                  onClick={() => reviewRef.current?.open()}
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

        {showDetailsLink && (
          <Link href={`/drops/${chainId}/${drop.dropId}`} className={styles.dropCard__view}>
            View
          </Link>
        )}

        {/* The card still owns the mint — the dialog only gathers the confirmation, so every
            path out of it (session key, approval, plain write) stays in one place */}
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
          onConfirm={handleMint}
        />
      </div>
    </div>
  )
}

export default DropCard
