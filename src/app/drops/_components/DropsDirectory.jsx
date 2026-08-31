'use client'

import { useRef } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection, useReadContract } from 'wagmi'
import { formatEther, zeroAddress } from 'viem'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { useActiveChain } from '@/hooks/useActiveChain'
import { useDropCollection } from '@/hooks/useDropCollection'
import { networkColorStyle } from '@/lib/networkColors'
import { useProfile } from '@/hooks/useProfile'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { PHASE_STATUS, dropStandardLabel, phaseStatus } from '@/lib/drops'
import dropsAbi from '@/abis/HupDrops.json'
import CreateDropDialog from '@/components/CreateDropDialog'
import HupMark from '@/components/ui/HupMark'
import { ImageIcon } from '@phosphor-icons/react'
import styles from './DropsDirectory.module.scss'

// Newest-first window read straight from the engine — drop ids are 1..dropCount, so the
// last N ids ARE the latest drops. No indexer exists for HupDrops; when one lands in
// cidex this becomes an API call with paging, like the launches directory.
const PAGE_SIZE = 12

const countFormat = new Intl.NumberFormat('en')
const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 4 })

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

// "6d" / "3h" / "12m" — the drop's age, now spelled out in the tile's tooltip rather than
// spending one of the few chip slots the artwork has room for
const ageLabel = (unixSeconds) => {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(unixSeconds))
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d`
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h`
  return `${Math.max(1, Math.floor(seconds / 60))}m`
}

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

// wagmi's config module stamps iconUrl onto the shared chain objects as a side effect, so the
// inline `icon` SVG is the fallback rather than the other way round — same derivation
// NftMarketCard uses
const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

/**
 * One drop in the grid. Identity (name, symbol, artwork) resolves from the collection
 * contract and its metadata JSON; supply progress from the engine's drop struct. Tiles
 * link to the detail page — the mint panel lives there and in feed posts, not here.
 */
function DropTile({ chainId, dropId, dropsAddress, liveOnly = false }) {
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'

  const { data: drop } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'getDrop',
    args: [BigInt(dropId)],
    chainId,
  })

  const collection = drop?.collection && drop.collection !== zeroAddress ? drop.collection : null

  // Identity resolves per standard family — LSP collections carry it in ERC725Y data keys,
  // EVM ones in name()/symbol()/contractURI()
  const { name, symbol, image } = useDropCollection({
    chainId,
    collection,
    standardId: drop ? Number(drop.standardId) : undefined,
  })
  const imageUrl = image ? resolveStorageImageUrl(image) : null

  // The headline number is the live phase's price; the first phase stands in while
  // nothing is live (upcoming drops show what minting will cost)
  const { data: phases = [] } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'phasesOf',
    args: [BigInt(dropId)],
    chainId,
    query: { enabled: Boolean(collection) },
  })

  // The whole tile is one link, so the Profile component (which nests links of its own)
  // can't go here — the same hook behind it supplies the byline instead
  const { profile } = useProfile(drop?.creator)
  const creatorName =
    profile?.fullName || (profile?.name && profile.name !== 'new-user' ? profile.name : null) || shortAddress(drop?.creator)

  if (!collection) return null

  const minted = Number(drop.minted)
  const maxSupply = Number(drop.maxSupply)
  const isOpenEdition = maxSupply === 0
  const isSoldOut = !isOpenEdition && minted >= maxSupply
  const isClosed = Boolean(drop.closed)

  // The live grid only shows drops someone can still mint; My drops keeps the full history
  if (liveOnly && (isClosed || isSoldOut)) return null

  const phase = phases.find((p) => phaseStatus(p) === PHASE_STATUS.LIVE) ?? phases[0]
  const price = phase?.price ?? 0n
  const mintedPercent = isOpenEdition ? null : Math.min(100, (minted / maxSupply) * 100)

  const chainIcon = chainIconFor(chainInfo)
  const createdAt = Number(drop.createdAt)
  // Everything the chips can no longer afford to say, said on hover instead
  const tooltip = [name || `Drop #${dropId}`, createdAt > 0 ? `created ${ageLabel(createdAt)} ago · ${dateFormat.format(new Date(createdAt * 1000))}` : null]
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

          {/* Networks mix in the aggregated grids, so every tile says where it lives: the mark
              carries it at a glance, the name settles it. Chains with no icon configured show
              the name alone rather than going unlabelled. */}
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
          {/* The ticker rides with the name, where a symbol belongs — it was competing with the
              chain and the age for the artwork's chip row before */}
          <span className={styles.directory__nameRow}>
            <strong className={styles.directory__name}>{name || `Drop #${dropId}`}</strong>
            <span className={styles.directory__ticker}>{symbol || dropStandardLabel(drop.standardId)}</span>
          </span>
          <span className={styles.directory__by}>By {creatorName}</span>
          {/* Supply reads as a bar rather than a green ▲ figure — a drop filling up isn't a
              price moving, and borrowing the ticker's up-arrow said the wrong thing about it */}
          <span className={styles.directory__stats}>
            <b>{price === 0n ? 'Free' : `${amountFormat.format(Number(formatEther(price)))} ${nativeSymbol}`}</b>
            <em>{isOpenEdition ? `${countFormat.format(minted)} minted` : `${countFormat.format(minted)}/${countFormat.format(maxSupply)}`}</em>
          </span>

          {/* Open editions have no denominator to fill — their running count says it better.
              The sheen only sweeps while there's still something to mint. */}
          {!isOpenEdition && (
            <span
              className={styles.directory__progressTrack}
              // The grid aggregates every chain, so the bar wears the drop's OWN network colour —
              // the global var tracks the connected chain, which says nothing about this tile
              style={chainInfo?.primaryColor ? { '--network-color-primary': chainInfo.primaryColor } : undefined}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={maxSupply}
              aria-valuenow={minted}
              aria-label={`${countFormat.format(minted)} of ${countFormat.format(maxSupply)} minted`}
            >
              <span
                className={clsx(styles.directory__progressFill, !isSoldOut && !isClosed && styles['directory__progressFill--minting'])}
                style={{ width: `${mintedPercent}%` }}
              />
            </span>
          )}
        </span>
      </Link>
    </li>
  )
}

/**
 * Drops Directory
 * The standalone home for NFT drops: browse what's minting on the active chain, and create one
 * without composing a post. The composer flow stays the primary path — a drop that arrives with
 * a post gets distribution the moment it exists — but a drop still needs somewhere to live for
 * people who arrive from a link rather than the feed.
 */
const fetcher = (url) => fetch(url).then((res) => res.json())

/**
 * One chain's contribution to the aggregated live grid: newest-first ids straight from that
 * chain's engine. Its own component so each enabled chain carries its own dropCount
 * subscription — public RPC reads, so guests without a wallet see everything.
 */
function ChainLiveTiles({ chain }) {
  const dropsAddress = CONTRACTS[`chain${chain.id}`]?.drops

  const { data: dropCount = 0n } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'dropCount',
    chainId: chain.id,
    query: { enabled: Boolean(dropsAddress), refetchInterval: 30_000 },
  })

  const latest = Number(dropCount)
  const dropIds = Array.from({ length: Math.min(latest, PAGE_SIZE) }, (_, i) => latest - i)

  return dropIds.map((id) => <DropTile key={`${chain.id}-${id}`} chainId={chain.id} dropId={id} dropsAddress={dropsAddress} liveOnly />)
}

const DropsDirectory = () => {
  const createDialogRef = useRef(null)
  const { chainId } = useActiveChain()
  const { address } = useConnection()

  // Creating still targets the active chain (the wallet signs there); browsing does not —
  // every chain with an engine feeds the grids below regardless of wallet or connection
  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops
  const enabledChains = appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.drops)

  // The author's own drops come from the index across every chain (closed ones included —
  // they manage them here); the live grid stays chain-enumerated so discovery works even
  // while the indexer naps
  const { data: mine } = useSWR(address ? `/api/v1/drops?creator=${address.toLowerCase()}&limit=24` : null, fetcher)
  const myDrops = mine?.data ?? []

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

      {enabledChains.length === 0 && <p className={styles.directory__empty}>NFT drops aren&rsquo;t live yet.</p>}

      {myDrops.length > 0 && (
        <section className={styles.directory__section}>
          <div className={styles.directory__sectionHead}>
            <h2>My drops</h2>
            <small>Create and manage your drops — open one to edit metadata or close it.</small>
          </div>
          <ul className={clsx(styles.directory__grid, 'animate fade')}>
            {myDrops.map((drop) => (
              <DropTile
                key={`mine-${drop.network_id}-${drop.drop_id}`}
                chainId={Number(drop.network_id)}
                dropId={Number(drop.drop_id)}
                dropsAddress={CONTRACTS[`chain${drop.network_id}`]?.drops}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Everyone's still-mintable drops across every enabled chain, the viewer's own
          included — browsing needs no wallet and no network switch; the chain only matters
          when minting or managing */}
      {enabledChains.length > 0 && (
        <section className={styles.directory__section}>
          <div className={styles.directory__sectionHead}>
            <h2>Live drops</h2>
          </div>
          <ul className={clsx(styles.directory__grid, 'animate fade')}>
            {enabledChains.map((chain) => (
              <ChainLiveTiles key={chain.id} chain={chain} />
            ))}
          </ul>
        </section>
      )}

      <CreateDropDialog ref={createDialogRef} fixedChainId={chainId} showSuccessStep />
    </div>
  )
}

export default DropsDirectory
