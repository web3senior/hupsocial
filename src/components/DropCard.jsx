'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useConnection, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { formatUnits, isAddress, zeroAddress } from 'viem'
import clsx from 'clsx'
import { LockSimpleOpenIcon, LockSimpleIcon, MinusIcon, PlusIcon, UsersIcon } from '@phosphor-icons/react'
import HupMark from '@/components/ui/HupMark'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { DROP_GATES, allowlistProof, formatPhaseTime, gateLabel, phaseStatus, PHASE_STATUS } from '@/lib/drops'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { handleBrokenImage } from '@/lib/utils'
import { networkColorStyle } from '@/lib/networkColors'
import dropsAbi from '@/abis/HupDrops.json'
import { toast } from '@/components/NextToast'
import styles from './DropCard.module.scss'

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })
const countFormat = new Intl.NumberFormat('en')

/**
 * Drop Card
 * Embedded mint card for posts carrying an `nftDrop` content reference — the launchpad's feed
 * surface. The content JSON is only a pointer plus static art (dropId, chainId, collection,
 * standardId, name, symbol, image, allowlistCid); supply, phases, and progress resolve live
 * from the HupDrops engine so the card can never render stale mint state.
 * @param {Object} props
 * @param {Object} props.drop The post's nftDrop content payload.
 * @param {string} [props.referral] Reposter credited with mints that arrive via their share —
 * the drop's creator-set referral share pays out to them, exactly like TradeCard sales.
 * @param {boolean} [props.showDetailsLink] Renders the View link to /drops/[networkId]/[dropId].
 * @param {boolean} [props.compact] Mint panel only — no media or title. For the drop page,
 * which already presents the artwork at full size.
 */
const DropCard = ({ drop, referral, showDetailsLink = true, compact = false }) => {
  const [quantity, setQuantity] = useState(1)
  const [selectedPhase, setSelectedPhase] = useState(null)
  const [isBurnerBusy, setIsBurnerBusy] = useState(false)
  const { address } = useConnection()
  const mintedToastRef = useRef(false)

  const chainId = Number(drop?.chainId)
  const publicClient = usePublicClient({ chainId })
  const chainInfo = appChains.find((c) => c.id === chainId)
  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops || null
  const nativeCurrency = chainInfo?.nativeCurrency
  const dropId = drop?.dropId ? BigInt(drop.dropId) : null

  // Live drop state — the single source of truth for supply, phases, and progress
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

  // First live phase is the default lane; explicit selection only matters when several
  // windows overlap (public + allowlist running together)
  const activeIndex = useMemo(() => phases.findIndex((phase) => phaseStatus(phase) === PHASE_STATUS.LIVE), [phases])
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

  // Gate probe — everything except an allowlist proof, which only the client holds
  const { data: gatePasses } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'isMintable',
    args: [dropId ?? 0n, BigInt(phaseIndex), address ?? zeroAddress, 1n],
    chainId,
    query: { enabled: Boolean(dropsAddress && dropId && address && phase) },
  })

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const isBusy = isPending || isConfirming || isBurnerBusy

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
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
  const progress = isOpenEdition ? 0 : Math.min(100, Math.round((minted / maxSupply) * 100))

  const status = phase ? phaseStatus(phase) : null
  const isLive = status === PHASE_STATUS.LIVE && !isClosed && !isSoldOut

  const price = phase ? phase.price : 0n
  const perWallet = phase ? Number(phase.perWallet) : 0
  const allocation = phase ? Number(phase.allocation) : 0
  const gate = phase ? Number(phase.gate) : DROP_GATES.OPEN

  // How many this wallet could still take through this phase, bounded like the engine bounds it
  const supplyRemaining = isOpenEdition ? Infinity : Math.max(0, maxSupply - minted)
  const allocationRemaining = allocation === 0 ? Infinity : Math.max(0, allocation - Number(phase?.minted ?? 0))
  const walletRemaining = perWallet === 0 ? Infinity : Math.max(0, perWallet - Number(mintedByMe))
  const maxQuantity = Math.min(supplyRemaining, allocationRemaining, walletRemaining, 100)
  const boundedQuantity = Math.max(1, Math.min(quantity, maxQuantity === Infinity ? 100 : maxQuantity || 1))

  const totalPrice = price * BigInt(boundedQuantity)
  const isFree = price === 0n
  const priceNumber = Number(formatUnits(price, nativeCurrency?.decimals ?? 18))
  const totalNumber = Number(formatUnits(totalPrice, nativeCurrency?.decimals ?? 18))
  const symbol = nativeCurrency?.symbol ?? ''

  // Gate verdicts the engine can already answer (followers, asset holders); allowlist
  // membership resolves at mint time from the published list
  const gateBlocked = Boolean(address && phase && gate !== DROP_GATES.OPEN && gate !== DROP_GATES.ALLOWLIST && gatePasses === false)

  // The engine rejects self- and creator-referrals — silently drop the attribution instead
  // of failing the mint, mirroring TradeCard
  const referralArg =
    referral && isAddress(referral) && referral.toLowerCase() !== address?.toLowerCase() && referral.toLowerCase() !== creator?.toLowerCase()
      ? referral
      : zeroAddress

  const imageUrl = drop.image ? resolveStorageImageUrl(drop.image) : null

  const handleMint = async (e) => {
    e.stopPropagation()
    if (!phase || !address) return

    let proof = []
    if (gate === DROP_GATES.ALLOWLIST) {
      if (!drop.allowlistCid) {
        toast('This phase is allowlist-only and its list is not published', 'error')
        return
      }
      try {
        const res = await fetch(resolveStorageImageUrl(drop.allowlistCid))
        const list = await res.json()
        proof = allowlistProof(list?.addresses ?? [], address)
      } catch {
        proof = null
      }
      if (!proof) {
        toast("You're not on this phase's allowlist", 'error')
        return
      }
    }

    mintedToastRef.current = false
    const args = [address, dropId, BigInt(phaseIndex), BigInt(boundedQuantity), referralArg, proof]

    // Route through the burner session key if one's active — same convenience TradeCard gets
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsBurnerBusy(true)
      try {
        await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: dropsAddress,
          abi: dropsAbi,
          functionName: 'mint',
          args: [...args, { value: totalPrice }],
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
      value: totalPrice,
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

      {/* Universal Page's progress bar: X/Y minted, or a running count for open editions */}
      <div className={styles.dropCard__progress}>
        <span className={styles.dropCard__progressLabel}>
          {isOpenEdition ? `${countFormat.format(minted)} minted · open edition` : `${countFormat.format(minted)}/${countFormat.format(maxSupply)} minted`}
        </span>
        {!isOpenEdition && (
          <span
            className={styles.dropCard__progressTrack}
            // Same rule the directory tiles follow: the fill belongs to the drop's network, not to
            // whichever chain the viewer's wallet happens to sit on
            style={chainInfo?.primaryColor ? { '--network-color-primary': chainInfo.primaryColor } : undefined}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={maxSupply}
            aria-valuenow={minted}
            aria-label={`${countFormat.format(minted)} of ${countFormat.format(maxSupply)} minted`}
          >
            <span
              className={clsx(styles.dropCard__progressFill, isLive && styles['dropCard__progressFill--minting'])}
              style={{ width: `${progress}%` }}
            />
          </span>
        )}
      </div>

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
                Phase {i + 1}
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
              <button type="button" className={styles.dropCard__mint} onClick={handleMint} disabled={isBusy || !address}>
                {isBusy ? 'Minting…' : isFree ? 'Mint free' : `Mint · ${amountFormat.format(totalNumber)} ${symbol}`}
              </button>
            )}
          </>
        )}

        {showDetailsLink && (
          <Link href={`/drops/${chainId}/${drop.dropId}`} className={styles.dropCard__view}>
            View
          </Link>
        )}
      </div>
    </div>
  )
}

export default DropCard
