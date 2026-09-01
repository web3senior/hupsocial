'use client'

import { useRef } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { useActiveChain } from '@/hooks/useActiveChain'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { networkColorStyle } from '@/lib/networkColors'
import { PHASE_STATUS, dropStandardLabel, phaseStatus } from '@/lib/drops'
import CreateDropDialog from '@/components/CreateDropDialog'
import HupMark from '@/components/ui/HupMark'
import ProgressBar from '@/components/ui/ProgressBar'
import { ImageIcon } from '@phosphor-icons/react'
import styles from './DropsDirectory.module.scss'

const PAGE_SIZE = 24

const countFormat = new Intl.NumberFormat('en')
const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 4 })

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

const ageLabel = (dateValue) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(dateValue).getTime()) / 1000))
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d`
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h`
  return `${Math.max(1, Math.floor(seconds / 60))}m`
}

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

// wagmi's config stamps iconUrl onto the shared chain objects; the inline `icon` SVG is the fallback
const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

const fetcher = (url) => fetch(url).then((res) => res.json())

/**
 * One drop in the grid, rendered from its indexed /api/v1/drops row with no RPC reads. Only the
 * artwork needs a fetch, through the row's metadata pointer.
 */
function DropTile({ row }) {
  const chainId = Number(row.network_id)
  const dropId = Number(row.drop_id)
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'

  // LUKSO metadata nests under LSP4Metadata; contractURI JSON is flat
  const { data: metadata } = useSWR(row.metadata_uri ? resolveStorageImageUrl(row.metadata_uri) : null, fetcher, {
    revalidateOnFocus: false,
  })
  const body = metadata?.LSP4Metadata ?? metadata
  const image = body?.images?.[0]?.[0]?.url || body?.image || ''
  const imageUrl = image ? resolveStorageImageUrl(image) : null
  const markerUrl = image ? resolveStorageImageUrl(image, { width: 48 }) : null

  const name = row.name || body?.name || `Drop #${dropId}`
  const creatorName = row.display_name && row.display_name !== 'new-user' ? row.display_name : shortAddress(row.creator)

  const minted = Number(row.minted)
  const maxSupply = Number(row.max_supply)
  const isOpenEdition = maxSupply === 0
  const isSoldOut = !isOpenEdition && minted >= maxSupply
  const isClosed = Boolean(Number(row.closed))

  const phases = (row.phases ?? []).map((phase) => ({
    startTime: Number(phase.start_time),
    endTime: Number(phase.end_time),
    paused: Boolean(Number(phase.paused)),
    price: BigInt(phase.price ?? 0),
  }))
  const phase = phases.find((p) => phaseStatus(p) === PHASE_STATUS.LIVE) ?? phases[0]
  const price = phase?.price ?? 0n

  const chainIcon = chainIconFor(chainInfo)
  const tooltip = [name, row.created_at ? `created ${ageLabel(row.created_at)} ago · ${dateFormat.format(new Date(row.created_at))}` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <li>
      {/* Colours come from the drop's chain, not the connected wallet's */}
      <Link href={`/drops/${chainId}/${dropId}`} className={styles.directory__card} title={tooltip} style={networkColorStyle(chainInfo)}>
        <span className={styles.directory__media}>
          {imageUrl ? (
            <img src={imageUrl} alt="" loading="lazy" />
          ) : (
            <span className={styles.directory__mediaFallback} aria-hidden="true">
              <HupMark size={30} />
            </span>
          )}

          {chainInfo && (
            <span className={styles.directory__chips}>
              <span className={clsx(styles.directory__chip, styles['directory__chip--network'])}>
                {chainIcon && <img src={chainIcon} alt="" loading="lazy" />}
                {chainInfo.name}
              </span>
            </span>
          )}

          {(isClosed || isSoldOut) && (
            <span className={clsx(styles.directory__chip, styles['directory__chip--status'])}>
              {isClosed ? 'Closed' : 'Sold out'}
            </span>
          )}
        </span>

        <span className={styles.directory__info}>
          <span className={styles.directory__nameRow}>
            <strong className={styles.directory__name}>{name}</strong>
            <span className={styles.directory__ticker}>{row.symbol || dropStandardLabel(row.standard_id)}</span>
          </span>
          <span className={styles.directory__by}>By {creatorName}</span>
          <span className={styles.directory__stats}>
            <b>{price === 0n ? 'Free' : `${amountFormat.format(Number(formatEther(price)))} ${nativeSymbol}`}</b>
            <em>{isOpenEdition ? `${countFormat.format(minted)} minted` : `${countFormat.format(minted)}/${countFormat.format(maxSupply)}`}</em>
          </span>

          {!isOpenEdition && (
            <ProgressBar
              className={styles.directory__progress}
              value={minted}
              max={maxSupply}
              height={5}
              color={chainInfo?.primaryColor}
              animated={!isSoldOut && !isClosed}
              sparkle={!isSoldOut && !isClosed}
              marker={markerUrl ? <img src={markerUrl} alt="" loading="lazy" /> : <HupMark size={8} />}
              ariaLabel={`${countFormat.format(minted)} of ${countFormat.format(maxSupply)} minted`}
            />
          )}
        </span>
      </Link>
    </li>
  )
}

/**
 * Drops Directory
 * Browse drops minting across every chain and create one without composing a post. Both grids
 * read the cidex index (/api/v1/drops); live mint state resolves onchain on the detail page and feed card.
 */
const DropsDirectory = () => {
  const createDialogRef = useRef(null)
  const { chainId } = useActiveChain()
  const { address } = useConnection()

  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops
  const anyChainEnabled = appChains.some((chain) => CONTRACTS[`chain${chain.id}`]?.drops)

  const { data: mine } = useSWR(address ? `/api/v1/drops?creator=${address.toLowerCase()}&limit=24` : null, fetcher)
  const myDrops = mine?.data ?? []

  const { data: live } = useSWR(`/api/v1/drops?status=live&limit=${PAGE_SIZE}`, fetcher, { refreshInterval: 30_000 })
  const liveDrops = live?.data ?? []

  return (
    <div className={styles.directory}>
      <header className={styles.directory__header}>
        {/* No heading here — PageTitle already puts "Drops" in the fixed header */}
        <p>Every drop deploys a collection you own outright. Fixed phases, gated mints, referral rewards.</p>
        <div className={styles.directory__actions}>
          <button
            type="button"
            className={styles.directory__create}
            onClick={() => createDialogRef.current?.open()}
            disabled={!dropsAddress}
            title={dropsAddress ? undefined : 'NFT drops are not available on this network yet'}
          >
            <ImageIcon size={16} weight="fill" />
            Create drop
          </button>
        </div>
      </header>

      {!anyChainEnabled && <p className={styles.directory__empty}>NFT drops aren&rsquo;t live yet.</p>}

      {myDrops.length > 0 && (
        <section className={styles.directory__section}>
          <div className={styles.directory__sectionHead}>
            <h2>My drops</h2>
            <small>Create and manage your drops — open one to edit metadata or close it.</small>
          </div>
          <ul className={clsx(styles.directory__grid, 'animate fade')}>
            {myDrops.map((row) => (
              <DropTile key={`mine-${row.network_id}-${row.drop_id}`} row={row} />
            ))}
          </ul>
        </section>
      )}

      {liveDrops.length > 0 && (
        <section className={styles.directory__section}>
          <div className={styles.directory__sectionHead}>
            <h2>Live drops</h2>
          </div>
          <ul className={clsx(styles.directory__grid, 'animate fade')}>
            {liveDrops.map((row) => (
              <DropTile key={`live-${row.network_id}-${row.drop_id}`} row={row} />
            ))}
          </ul>
        </section>
      )}

      <CreateDropDialog ref={createDialogRef} fixedChainId={chainId} showSuccessStep />
    </div>
  )
}

export default DropsDirectory
