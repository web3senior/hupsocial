'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import { ArrowRightIcon, LightningIcon } from '@phosphor-icons/react'
import { PHASE_STATUS, formatPhaseTime, phaseStatus } from '@/lib/drops'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { handleBrokenImage } from '@/lib/utils'
import { useDropCollection } from '@/hooks/useDropCollection'
import DropCard from '@/components/DropCard'
import DropEligibility from '@/components/DropEligibility'
import DropSchedule from '@/components/DropSchedule'
import HupMark from '@/components/ui/HupMark'
import styles from './CollectionMint.module.scss'

const countFormat = new Intl.NumberFormat('en')

/**
 * Collection Mint
 * The primary sale, on the collection's own page. A collection the HupDrops engine deployed
 * carries its drop with it, and this brings the drop page's mint panel to where a collector
 * browsing the collection already is: live progress, the stage picker, quantity and the
 * review-mint flow through DropCard, the full schedule, eligibility for gated stages, and the
 * way through to the drop page for everything else (facts, the creator's manage tools).
 *
 * Every number resolves from the engine rather than the index, so it agrees with the mint
 * button to the token. Once the sale is over — closed, sold out, or every stage ended — the
 * panel folds to a strip that still says where the collection came from.
 * @param {Object} props
 * @param {number} props.chainId Chain the collection lives on.
 * @param {Object} [props.chainInfo] Entry from appChains, when the chain is configured.
 * @param {string} props.collection Collection contract address.
 * @param {string} props.dropId The engine's id for this collection's drop.
 * @param {Object} props.drop The engine's Drop struct.
 * @param {Array} props.phases Phase structs from phasesOf.
 * @param {string} [props.collectionName] Name from the collection cache, ahead of the drop metadata read.
 */
export default function CollectionMint({ chainId, chainInfo, collection, dropId, drop, phases, collectionName }) {
  const { address } = useConnection()
  const { name, symbol, image, icon } = useDropCollection({ chainId, collection, standardId: Number(drop.standardId) })

  // An LSP4 collection may carry only its square icon (images empty) — never blank the artwork
  const artwork = image || icon
  const imageUrl = artwork ? resolveStorageImageUrl(artwork, { width: 768 }) : null
  const title = name || collectionName || `Drop #${dropId}`

  // No pieces strip here: this is the one page whose whole lower half is the collection's tokens
  const cardDrop = useMemo(
    () => ({ dropId, chainId, name: title, symbol, image: artwork, icon, show: { pieces: false } }),
    [dropId, chainId, title, symbol, artwork, icon],
  )

  const minted = Number(drop.minted ?? 0)
  const maxSupply = Number(drop.maxSupply ?? 0)
  const isOpenEdition = maxSupply === 0
  const isClosed = Boolean(drop.closed)
  const isSoldOut = !isOpenEdition && minted >= maxSupply
  const statuses = phases.map((phase) => phaseStatus(phase))
  const liveIndex = statuses.indexOf(PHASE_STATUS.LIVE)
  const upcomingIndex = statuses.indexOf(PHASE_STATUS.UPCOMING)
  const isOver = isClosed || isSoldOut || (phases.length > 0 && statuses.every((status) => status === PHASE_STATUS.ENDED))
  const isCreator = Boolean(address && drop.creator && address.toLowerCase() === drop.creator.toLowerCase())
  // Same phase pick as DropCard, so the eligibility panel and the mint panel agree
  const eligibilityIndex = liveIndex === -1 ? 0 : liveIndex

  const href = `/drops/${chainId}/${dropId}`
  const mintedLabel = isOpenEdition
    ? `${countFormat.format(minted)} minted`
    : `${countFormat.format(minted)} / ${countFormat.format(maxSupply)} minted`

  if (isOver) {
    return (
      <section className={clsx(styles.mint, styles['mint--over'])} aria-label="Primary sale">
        <HupMark size={18} className={styles.mint__mark} />
        <p className={styles.mint__summary}>
          <strong>Launched on Hup</strong>
          <span>
            {isClosed ? 'Closed by the creator' : isSoldOut ? 'Sold out' : 'Minting has ended'} · {mintedLabel}
          </span>
        </p>
        <Link href={href} className={styles.mint__link}>
          {isCreator ? 'Manage drop' : 'Drop details'}
          <ArrowRightIcon size={14} aria-hidden="true" />
        </Link>
      </section>
    )
  }

  const timing = liveIndex !== -1 ? 'Live now' : upcomingIndex !== -1 ? `Starts ${formatPhaseTime(phases[upcomingIndex].startTime)}` : null

  return (
    <section className={styles.mint} aria-label="Primary sale">
      <div className={styles.mint__media}>
        {imageUrl ? (
          <img src={imageUrl} alt="" onError={handleBrokenImage} />
        ) : (
          <span className={styles.mint__mediaFallback} aria-hidden="true">
            <HupMark size={40} />
          </span>
        )}
      </div>

      <div className={styles.mint__panel}>
        <div className={styles.mint__eyebrow}>
          {/* The engine's own reverse index says it deployed this collection — provenance
              proven onchain rather than declared */}
          <span className={styles.mint__origin}>
            <HupMark size={12} />
            Launched on Hup
          </span>
          {timing && (
            <span className={clsx(styles.mint__timing, liveIndex !== -1 && styles['mint__timing--live'])}>
              <LightningIcon size={12} weight="fill" aria-hidden="true" />
              {timing}
            </span>
          )}
        </div>

        <h2 className={styles.mint__title}>Mint {title}</h2>

        {/* The card owns the mint — progress, stage picker, quantity and the review dialog —
            so the collection page and the drop page can never disagree on what a click does */}
        <DropCard drop={cardDrop} compact showDetailsLink={false} />

        <DropSchedule chainId={chainId} chainInfo={chainInfo} phases={phases} />

        <DropEligibility
          chainId={chainId}
          dropId={dropId}
          phaseIndex={eligibilityIndex}
          phase={phases[eligibilityIndex] ?? null}
          creator={drop.creator}
        />

        <Link href={href} className={styles.mint__link}>
          {isCreator ? 'Manage drop' : 'Drop details'}
          <ArrowRightIcon size={14} aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}
