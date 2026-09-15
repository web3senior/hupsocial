'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { formatEther } from 'viem'
import { ArrowRightIcon, CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { appChains } from '@/config/contracts'
import { chainIconFor, networkColorStyle } from '@/lib/networkColors'
import { PHASE_STATUS, phaseStatus } from '@/lib/drops'
import { metadataFetcher } from '@/hooks/useDropCollection'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { useStripScroll } from '@/hooks/useStripScroll'
import HupMark from '@/components/ui/HupMark'
import ProgressBar from '@/components/ui/ProgressBar'
import styles from './DropsRail.module.scss'

// One screenful of cards. The rail is a pointer to /drops, not a second directory.
const RAIL_LIMIT = 12
const REFRESH_MS = 60_000
// Cards are 2x their layout width on a retina screen — the next rung up the ladder
const ARTWORK_WIDTH = 384

const countFormat = new Intl.NumberFormat('en')
const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 4 })
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' })

const RELATIVE_STEPS = [
  { unit: 'day', ms: 86_400_000 },
  { unit: 'hour', ms: 3_600_000 },
  { unit: 'minute', ms: 60_000 },
]

const fetcher = (url) => fetch(url).then((res) => res.json())

/** "in 2 hr." for a unix-seconds deadline, or null when there isn't one (or it has passed). */
const countdownLabel = (unixSeconds) => {
  const deadline = Number(unixSeconds) * 1000
  if (!deadline) return null
  const remaining = deadline - Date.now()
  if (remaining <= 0) return null
  const step = RELATIVE_STEPS.find((entry) => remaining >= entry.ms) ?? RELATIVE_STEPS.at(-1)
  return relativeFormat.format(Math.round(remaining / step.ms), step.unit)
}

/**
 * The phase the rail speaks for: the one open now, else the next one to open. A drop whose
 * phases have all ended (or are paused) has nothing to mint and returns null, which takes it
 * out of the rail entirely.
 */
const railPhase = (row) => {
  const phases = (row.phases ?? []).map((phase) => ({
    startTime: Number(phase.start_time),
    endTime: Number(phase.end_time),
    paused: Boolean(Number(phase.paused)),
    price: BigInt(phase.price ?? 0),
  }))

  const live = phases.find((phase) => phaseStatus(phase) === PHASE_STATUS.LIVE)
  if (live) return { phase: live, status: PHASE_STATUS.LIVE }

  const upcoming = phases.filter((phase) => phaseStatus(phase) === PHASE_STATUS.UPCOMING).sort((a, b) => a.startTime - b.startTime)[0]
  return upcoming ? { phase: upcoming, status: PHASE_STATUS.UPCOMING } : null
}

const STATUS_RANK = { [PHASE_STATUS.LIVE]: 0, [PHASE_STATUS.UPCOMING]: 1 }

// How much of the run is still there, as the tiebreak: an open edition never runs out, so it
// sorts behind every limited drop that could actually sell out under the reader.
const remainingRatio = (row) => {
  const maxSupply = Number(row.max_supply)
  if (!maxSupply) return Infinity
  return (maxSupply - Number(row.minted)) / maxSupply
}

/** One drop, drawn from its indexed row. Only the artwork needs a fetch. */
function DropRailCard({ row, phase, status }) {
  const chainId = Number(row.network_id)
  const dropId = Number(row.drop_id)
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'

  // LUKSO metadata nests under LSP4Metadata; contractURI JSON is flat
  const { data: metadata } = useSWR(row.metadata_uri || null, metadataFetcher, { revalidateOnFocus: false })
  const body = metadata?.LSP4Metadata ?? metadata
  const image = body?.images?.[0]?.[0]?.url || body?.image || ''
  // Spec LSP4 icon is flat; the nested read covers our own pre-spec writes
  const icon = body?.icon?.[0]?.[0]?.url || body?.icon?.[0]?.url || (typeof body?.icon === 'string' ? body.icon : '')
  const artwork = image || icon
  const imageUrl = artwork ? resolveStorageImageUrl(artwork, { width: ARTWORK_WIDTH }) : null

  const name = row.name || body?.name || `Drop #${dropId}`
  const minted = Number(row.minted)
  const maxSupply = Number(row.max_supply)
  const isOpenEdition = maxSupply === 0

  const price = phase?.price ?? 0n
  const isLive = status === PHASE_STATUS.LIVE
  // Live drops count down to their close, upcoming ones up to their open; either way the chip
  // carries the number that decides whether to click now
  const timer = countdownLabel(isLive ? phase?.endTime : phase?.startTime)
  const chainIcon = chainIconFor(chainInfo)

  return (
    // Colours come from the drop's chain, not the connected wallet's
    <li className={styles['drops-rail__card']} style={networkColorStyle(chainInfo)}>
      <Link href={`/drops/${chainId}/${dropId}`} className={styles['drops-rail__link']} title={`${name} · ${chainInfo?.name ?? `Chain ${chainId}`}`}>
        <span className={styles['drops-rail__media']}>
          {imageUrl ? (
            <img src={imageUrl} alt="" loading="lazy" />
          ) : (
            <span className={styles['drops-rail__media-fallback']} aria-hidden="true">
              <HupMark size={26} />
            </span>
          )}

          {chainIcon && (
            <span className={styles['drops-rail__chain']} aria-hidden="true">
              <img src={chainIcon} alt="" loading="lazy" />
            </span>
          )}

          <span className={clsx(styles['drops-rail__chip'], !isLive && styles['drops-rail__chip--soon'])}>
            {isLive ? timer ?? 'Live' : timer ? `opens ${timer}` : 'Soon'}
          </span>
        </span>

        <span className={styles['drops-rail__body']}>
          <strong className={styles['drops-rail__name']}>{name}</strong>

          <span className={styles['drops-rail__stats']}>
            <b>{price === 0n ? 'Free' : `${amountFormat.format(Number(formatEther(price)))} ${nativeSymbol}`}</b>
            <em>{isOpenEdition ? `${countFormat.format(minted)} minted` : `${countFormat.format(minted)}/${countFormat.format(maxSupply)}`}</em>
          </span>

          {!isOpenEdition && (
            <ProgressBar
              className={styles['drops-rail__progress']}
              value={minted}
              max={maxSupply}
              height={4}
              color={chainInfo?.primaryColor}
              animated={isLive}
              ariaLabel={`${countFormat.format(minted)} of ${countFormat.format(maxSupply)} minted`}
            />
          )}
        </span>
      </Link>
    </li>
  )
}

/**
 * Drops Rail
 * The strip of drops minting right now, dropped into the home feed between posts. Rows come
 * from the cidex index (/api/v1/drops) — no chain reads — and lead to the drop page, where the
 * mint itself resolves onchain.
 *
 * Ordering is urgency, not recency: paid placements first, then what is open over what is
 * merely scheduled, then whatever closes soonest. A drop that is already unmintable — every
 * phase ended or paused — is left out rather than shown as a dead card.
 *
 * @param {number|null} [props.networkId] Scopes the rail to one chain, for a network tab.
 */
export default function DropsRail({ networkId = null, className }) {
  const query = new URLSearchParams({ status: 'live', limit: String(RAIL_LIMIT) })
  if (networkId) query.set('networkId', String(networkId))

  const { data } = useSWR(`/api/v1/drops?${query}`, fetcher, { refreshInterval: REFRESH_MS, revalidateOnFocus: false })

  const drops = useMemo(() => {
    const rows = data?.data ?? []
    return rows
      .map((row) => ({ row, ...(railPhase(row) ?? {}) }))
      .filter((entry) => entry.status)
      .sort((a, b) => {
        const featured = Number(b.row.featured ?? 0) - Number(a.row.featured ?? 0)
        if (featured !== 0) return featured
        if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) return STATUS_RANK[a.status] - STATUS_RANK[b.status]
        // A phase with no end never runs out of time, so it sorts behind every one that does
        const aEnd = a.phase.endTime > 0 ? a.phase.endTime : Infinity
        const bEnd = b.phase.endTime > 0 ? b.phase.endTime : Infinity
        if (aEnd !== bEnd) return aEnd - bEnd
        return remainingRatio(a.row) - remainingRatio(b.row)
      })
  }, [data])

  const { trackRef, edges, nudge } = useStripScroll(drops.length)

  // Nothing minting, or the drops tables aren't indexed yet. A feed is no place for an empty
  // state — the rail simply isn't there.
  if (drops.length === 0) return null

  return (
    <section className={clsx(styles['drops-rail'], className)} aria-labelledby="drops-rail-title">
      <div className={styles['drops-rail__head']}>
        <h2 id="drops-rail-title" className={styles['drops-rail__title']}>
          <span className={styles['drops-rail__pulse']} aria-hidden="true" />
          Minting now
        </h2>

        <Link href="/drops" className={styles['drops-rail__all']}>
          All drops
          <ArrowRightIcon size={13} weight="bold" />
        </Link>
      </div>

      <div className={styles['drops-rail__strip']}>
        <ul ref={trackRef} className={styles['drops-rail__track']}>
          {drops.map((entry) => (
            <DropRailCard key={`${entry.row.network_id}-${entry.row.drop_id}`} row={entry.row} phase={entry.phase} status={entry.status} />
          ))}
        </ul>

        {/* Hidden from assistive tech: the track itself is already a keyboard-scrollable region,
            so these would only add duplicate stops */}
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          className={clsx(styles['drops-rail__arrow'], styles['drops-rail__arrow--start'], edges.start && styles['drops-rail__arrow--hidden'])}
          onClick={() => nudge(-1)}
        >
          <CaretLeftIcon size={14} weight="bold" />
        </button>
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          className={clsx(styles['drops-rail__arrow'], styles['drops-rail__arrow--end'], edges.end && styles['drops-rail__arrow--hidden'])}
          onClick={() => nudge(1)}
        >
          <CaretRightIcon size={14} weight="bold" />
        </button>
      </div>
    </section>
  )
}
