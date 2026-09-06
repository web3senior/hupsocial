'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { useActiveChain } from '@/hooks/useActiveChain'
import { metadataFetcher } from '@/hooks/useDropCollection'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { networkColorStyle } from '@/lib/networkColors'
import { PHASE_STATUS, dropStandardLabel, phaseStatus } from '@/lib/drops'
import DropsHero, { HeroChain } from '@/components/DropsHero'
import HupMark from '@/components/ui/HupMark'
import ProgressBar from '@/components/ui/ProgressBar'
import Profile from '@/components/Profile'
import { ImageIcon, StarIcon } from '@phosphor-icons/react'
import styles from './DropsDirectory.module.scss'

const PAGE_SIZE = 24

const countFormat = new Intl.NumberFormat('en')
const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 4 })

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
function DropTile({ row, inStrip = false }) {
  const chainId = Number(row.network_id)
  const dropId = Number(row.drop_id)
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'

  // LUKSO metadata nests under LSP4Metadata; contractURI JSON is flat
  const { data: metadata } = useSWR(row.metadata_uri || null, metadataFetcher, {
    revalidateOnFocus: false,
  })
  const body = metadata?.LSP4Metadata ?? metadata
  const image = body?.images?.[0]?.[0]?.url || body?.image || ''
  // Spec LSP4 icon is flat; the nested read covers our own pre-spec writes
  const icon = body?.icon?.[0]?.[0]?.url || body?.icon?.[0]?.url || (typeof body?.icon === 'string' ? body.icon : '')
  /* Either can stand in for a missing other — but the tile leads with the artwork, while the
     tiny progress marker leads with the square icon, which reads at 16px where artwork cannot */
  const artwork = image || icon
  const imageUrl = artwork ? resolveStorageImageUrl(artwork) : null
  const markerArt = icon || image
  const markerUrl = markerArt ? resolveStorageImageUrl(markerArt, { width: 48 }) : null

  const name = row.name || body?.name || `Drop #${dropId}`

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
  // The overlay pills take no pointer, so the chain — an icon only up there — is named here
  const tooltip = [name, chainInfo?.name, row.created_at ? `created ${ageLabel(row.created_at)} ago · ${dateFormat.format(new Date(row.created_at))}` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    // Colours come from the drop's chain, not the connected wallet's
    <li className={styles.directory__card} style={networkColorStyle(chainInfo)}>
      <Link href={`/drops/${chainId}/${dropId}`} className={styles.directory__link} title={tooltip}>
        <span className={styles.directory__media}>
          {imageUrl ? (
            <img src={imageUrl} alt="" loading="lazy" />
          ) : (
            <span className={styles.directory__mediaFallback} aria-hidden="true">
              <HupMark size={30} />
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

      {/* Rides over the artwork, outside the card's link */}
      <span className={styles.directory__overlay}>
        <span className={styles.directory__chips}>
          <span className={clsx(styles.directory__chip, styles['directory__chip--age'])}>
            {chainIcon && <img src={chainIcon} alt="" loading="lazy" />}
            {row.created_at ? ageLabel(row.created_at) : chainInfo?.name}
          </span>

          {/* Redundant inside the strip, which is itself the mark */}
          {Boolean(Number(row.featured)) && !inStrip && (
            <span className={clsx(styles.directory__chip, styles['directory__chip--featured'])}>
              <StarIcon weight="fill" aria-hidden="true" />
              Featured
            </span>
          )}
        </span>

        {/* Who made it, at the other corner — the one part of the overlay that answers a pointer,
            since the profile card and the link to their page are worth having from a tile */}
        {row.creator && (
          <span className={styles.directory__creator}>
            <Profile creator={row.creator} networkId={chainId} variant="imageOnly" size={26} fingerprint={false} />
          </span>
        )}
      </span>
    </li>
  )
}

/**
 * Drops Directory
 * Browse drops minting across every chain and create one without composing a post. Both grids
 * read the cidex index (/api/v1/drops); live mint state resolves onchain on the detail page and feed card.
 */
const DropsDirectory = () => {
  const { chainId } = useActiveChain()
  const { address } = useConnection()

  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops
  const anyChainEnabled = appChains.some((chain) => CONTRACTS[`chain${chain.id}`]?.drops)

  const { data: live } = useSWR(`/api/v1/drops?status=live&limit=${PAGE_SIZE}`, fetcher, { refreshInterval: 30_000 })
  const featuredDrops = live?.meta?.featured ?? []
  // Finished drops still have a page worth visiting — the collection is the thing, and it outlives the mint
  const { data: ended } = useSWR(`/api/v1/drops?status=ended&limit=${PAGE_SIZE}`, fetcher)
  const endedDrops = ended?.data ?? []

  // The API leaves featured rows in the main list as well — drop them here so one drop is not two cards
  const liveDrops = useMemo(() => {
    const rows = live?.data ?? []
    if (featuredDrops.length === 0) return rows
    const stripKeys = new Set(featuredDrops.map((row) => `${row.network_id}-${row.drop_id}`))
    return rows.filter((row) => !stripKeys.has(`${row.network_id}-${row.drop_id}`))
  }, [live, featuredDrops])

  return (
    <div className={styles.directory}>
      {/* No heading here — PageTitle already puts "Drops" in the fixed header */}
      <DropsHero
        chainId={chainId}
        title="Launch an NFT collection you own outright."
        action={
          /* A page, not a modal: the form runs to an artwork upload that takes minutes, and a
             draft nobody can dismiss with the Esc key */
          dropsAddress ? (
            <Link href={`/drops/create?chain=${chainId}`}>
              <ImageIcon size={16} weight="fill" />
              Create drop
            </Link>
          ) : (
            <button type="button" disabled title="NFT drops are not available on this network yet">
              <ImageIcon size={16} weight="fill" />
              Create drop
            </button>
          )
        }
      >
        Minting on <HeroChain chainId={chainId} />
      </DropsHero>

      {!anyChainEnabled && <p className={styles.directory__empty}>NFT drops aren&rsquo;t live yet.</p>}

      {/* A creator's own drops live in the Studio now, beside everything else they can edit — this
          page is the shop window, not the back room */}
      {address && (
        <p className={styles.directory__studioNote}>
          Looking for your own drops? They are in the <Link href="/nfts/studio">Studio</Link>, with every collection you can manage.
        </p>
      )}

      {featuredDrops.length > 0 && (
        <section className={styles.directory__section}>
          <div className={styles.directory__sectionHead}>
            <h2>Featured</h2>
            <small>Creators paid to put these up here.</small>
          </div>
          <ul className={clsx(styles.directory__grid, 'animate fade')}>
            {featuredDrops.map((row) => (
              <DropTile key={`featured-${row.network_id}-${row.drop_id}`} row={row} inStrip />
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

      {endedDrops.length > 0 && (
        <section className={styles.directory__section}>
          <div className={styles.directory__sectionHead}>
            <h2>Minted out</h2>
            <small>Every piece is taken, or the creator closed the drop — the collections live on in the market.</small>
          </div>
          <ul className={clsx(styles.directory__grid, 'animate fade')}>
            {endedDrops.map((row) => (
              <DropTile key={`ended-${row.network_id}-${row.drop_id}`} row={row} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export default DropsDirectory
