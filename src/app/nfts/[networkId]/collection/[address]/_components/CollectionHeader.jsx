'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import useSWRImmutable from 'swr/immutable'
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  CaretRightIcon,
  CheckIcon,
  CopyIcon,
  CubeIcon,
  DotsThreeIcon,
  LinkSimpleIcon,
  ShieldCheckIcon,
  SpinnerGapIcon,
} from '@phosphor-icons/react'
import { buildAssetLinks } from '@/components/TradeCard'
import { getNftCollectionTokens } from '@/lib/api'
import { formatStake } from '@/hooks/useStakeToken'
import useNftMetadata from '@/hooks/useNftMetadata'
import { handleBrokenImage } from '@/lib/utils'
import { describeBadge, gradeColor } from '@/lib/collectionAuditFormat'
import useCollectionAudit from '@/hooks/useCollectionAudit'
import Profile from '@/components/Profile'
import HupMark from '@/components/ui/HupMark'
import NativePopover from '@/components/ui/NativePopover'
import { toast } from '@/components/NextToast'
import styles from './CollectionHeader.module.scss'

const COUNT_FORMAT = new Intl.NumberFormat('en')

// Past this, the description collapses behind "Read more" — roughly the three lines the card
// gives it, so a short blurb never sprouts a toggle that does nothing
const DESCRIPTION_CLAMP = 240

const formatSupply = (value) => {
  try {
    return new Intl.NumberFormat().format(BigInt(value))
  } catch {
    return String(value)
  }
}

/**
 * What the 3D chip promises, spelled out. The badge can only speak for the tokens this app
 * has already resolved, so the tooltip says how many that is rather than letting a single
 * mesh in a 900-piece drop read as "this collection is 3D".
 */
const describeModels = ({ models, cached, types }) => {
  const formats = types.length > 0 ? ` (${types.map((type) => `.${type}`).join(', ')})` : ''
  const scope = models === cached ? 'Every NFT loaded from this collection ships' : `${COUNT_FORMAT.format(models)} of the NFTs loaded from this collection ship`
  return `${scope} a 3D file${formats}`
}

// Untitled links still need a label the user can read — the hostname is the honest one
const linkLabel = (link) => {
  if (link.title) return link.title
  try {
    return new URL(link.url).hostname.replace(/^www\./, '')
  } catch {
    return link.url
  }
}

// Every link in this row is a plain link icon — a collection can point anywhere, and guessing a
// brand from the hostname mislabels more links than it helps. X is the one exception, because
// 𝕏 is a character rather than a logo we have to recognise.
const isXLink = (url) => {
  try {
    const { hostname } = new URL(url)
    return /(^|\.)x\.com$|(^|\.)twitter\.com$/.test(hostname)
  } catch {
    return false
  }
}

/**
 * One sample token's artwork in the icon mosaic. A hook can't run in a loop over a
 * variable-length list, so the mosaic renders a fixed three of these — each resolves through
 * the same metadata read-through the listing grid below already fills, so the tiles are
 * usually free.
 */
function SampleTile({ chainId, collection, sample }) {
  const metadata = useNftMetadata({
    chainId,
    collection,
    tokenId: sample?.token_id,
    isLsp8: Boolean(sample?.is_lsp8),
    enabled: Boolean(sample),
    imageWidth: 192,
    still: true,
  })

  if (!sample) return null

  return (
    <span className={styles.header__iconTile}>
      {metadata.image ? (
        <img src={metadata.image} alt="" loading="lazy" decoding="async" onError={handleBrokenImage} />
      ) : (
        <span className={styles.header__iconTileFallback}>
          <HupMark size={14} />
        </span>
      )}
    </span>
  )
}

/**
 * The bannerless fallback: the lead sample's artwork blown up and blurred past recognition,
 * so whatever its aspect ratio, the band reads as the collection's own colour rather than a
 * crop of one NFT.
 */
function SampleBanner({ chainId, collection, sample }) {
  // A source that dies after resolving would blur the line-art placeholder into the band —
  // hiding it keeps the tinted plate instead, which at least isn't pretending to be artwork
  const [failed, setFailed] = useState(false)
  const metadata = useNftMetadata({
    chainId,
    collection,
    tokenId: sample.token_id,
    isLsp8: Boolean(sample.is_lsp8),
    imageWidth: 1024,
    still: true,
  })

  if (!metadata.image || failed) return <HupMark size={48} />

  return <img className={styles.header__bannerAmbient} src={metadata.image} alt="" onError={() => setFailed(true)} />
}

/**
 * Collection Header
 * The collection's onchain identity as a hero: a full-bleed LSP4 banner with the identity
 * card floating over it — icon, name, creators, description, standard/chain chips, the
 * collection's own links as icon buttons — and the market stat row underneath (volume,
 * highest sale, NFTs traded, supply).
 *
 * Everything shown comes from the contract (via nft_collection_cache) or from settled trades
 * (nft_trades) — nothing here is editable app state. The contract address, explorer link and
 * the metadata re-read live in the overflow menu, since they're maintenance, not identity.
 * @param {Object} props
 * @param {number} props.chainId Chain the collection lives on.
 * @param {Object} [props.chainInfo] Entry from appChains, when the chain is configured.
 * @param {string} props.address Collection contract address.
 * @param {Object} props.info Result of useCollectionInfo for this collection.
 * @param {Object} props.stats Result of useCollectionStats for this collection.
 * @param {Function} props.onRefresh Re-reads collection identity + token metadata from chain.
 * @param {boolean} props.isRefreshing Whether that sweep is in flight.
 */
export default function CollectionHeader({ chainId, chainInfo, address, info, stats, onRefresh, isRefreshing }) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // The permanence grade, as cidex scored it. Looking at a collection is what puts it in the
  // queue, so the market audits itself as people browse it; the chip links to the full report.
  const permanence = useCollectionAudit({ chainId, collection: address, summary: true, autoRequest: true })
  const permanenceTitle = permanence.audit?.grade
    ? `${permanence.audit.score}/100 · ${permanence.audit.badges.map((id) => describeBadge(id).label).join(' · ')} — open the full audit`
    : undefined

  // A cached icon or banner whose bytes have since died counts as missing too — the swap
  // to the fallback happens on the img's error, and resets when the URL itself changes
  // (a new collection, or a refresh that found working artwork)
  const [iconFailed, setIconFailed] = useState(false)
  const [bannerFailed, setBannerFailed] = useState(false)
  useEffect(() => setIconFailed(false), [info.icon])
  useEffect(() => setBannerFailed(false), [info.banner])
  const hasIcon = Boolean(info.icon) && !iconFailed
  const hasBanner = Boolean(info.banner) && !bannerFailed

  // Artless collections dress themselves in their own tokens: up to three for the icon
  // mosaic, the first as the banner's ambient wash. Only fetched when something is actually
  // missing, and only from the cache — a collection Hup has never seen keeps the plain mark.
  const needsSampleArt = !info.isLoading && (!hasIcon || !hasBanner)
  const { data: sampleData } = useSWRImmutable(needsSampleArt ? ['nft-collection-samples', chainId, address] : null, () =>
    getNftCollectionTokens(chainId, address, 1, 3),
  )
  const samples = sampleData?.data || []

  const isLsp8 = Boolean(info.isLsp8)
  // LUKSO's standard reads as "NFT 2.0" in the UI; the literal LSP8 name lives in the tooltip
  const standard = info.isLsp8 === null ? null : isLsp8 ? 'NFT 2.0' : 'ERC721'
  const standardTitle = isLsp8 ? 'LSP8' : undefined

  const { collectionUrl } = buildAssetLinks({ chainId, chainInfo, collection: address, tokenId: '0', isLsp8 })

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('Could not copy the address', 'error')
    }
  }

  // Volume and the high sale are quoted in one payment token — a collection that also traded
  // in another gets told so here rather than having the difference silently folded in
  const quoteNote =
    stats.currencies > 1 ? `Quoted in ${stats.symbol || 'the collection’s main currency'} — ${COUNT_FORMAT.format(stats.quotedSales)} of ${COUNT_FORMAT.format(stats.saleCount)} sales` : undefined

  const money = (value) => {
    const amount = formatStake(value, stats.decimals)
    if (!amount) return null
    return (
      <>
        {amount}
        {stats.symbol && <small>{stats.symbol}</small>}
      </>
    )
  }

  const statTiles = [
    { key: 'volume', label: 'Volume', value: money(stats.volume), title: quoteNote },
    { key: 'highest', label: 'Highest sale', value: money(stats.highestSale), title: quoteNote },
    {
      key: 'traded',
      label: 'NFTs traded',
      value: stats.itemsSold > 0 ? COUNT_FORMAT.format(stats.itemsSold) : null,
      title: stats.saleCount > 0 ? `${COUNT_FORMAT.format(stats.saleCount)} sales settled through HupTrade` : undefined,
    },
    {
      key: 'supply',
      label: 'Total supply',
      value: info.totalSupply !== null ? formatSupply(info.totalSupply) : null,
    },
  ]

  const isLongDescription = (info.description?.length || 0) > DESCRIPTION_CLAMP

  if (info.isLoading) {
    return (
      <div className={styles.header} aria-busy="true">
        <div className={clsx(styles.header__banner, styles['header__banner--skeleton'])} />
        <div className={styles.header__card}>
          <div className={styles.header__skeletonRow} />
        </div>
      </div>
    )
  }

  return (
    <header className={styles.header}>
      {/* The LSP4 backgroundImage — or, failing that, a tinted plate — runs the full width of
          the viewport, with the card below floating over its lower edge */}
      <div className={clsx(styles.header__banner, !hasBanner && styles['header__banner--fallback'])}>
        {hasBanner ? (
          <img src={info.banner} alt="" onError={() => setBannerFailed(true)} />
        ) : samples.length > 0 ? (
          <SampleBanner chainId={chainId} collection={address} sample={samples[0]} />
        ) : (
          <HupMark size={48} />
        )}
      </div>

      <nav className={styles.header__crumbs} aria-label="Breadcrumb">
        <Link href="/nfts">NFTs</Link>
        <CaretRightIcon size={12} />
        <span>{info.name || 'Collection'}</span>
      </nav>

      <div className={styles.header__card}>
        <div className={styles.header__main}>
          {hasIcon ? (
            <img className={styles.header__icon} src={info.icon} alt="" onError={() => setIconFailed(true)} />
          ) : samples.length > 0 ? (
            <span
              className={clsx(styles.header__icon, styles['header__icon--mosaic'], samples.length < 2 && styles['header__icon--single'])}
              aria-hidden="true"
            >
              <SampleTile chainId={chainId} collection={address} sample={samples[0]} />
              {samples.length > 1 && (
                <span className={styles.header__iconSide}>
                  <SampleTile chainId={chainId} collection={address} sample={samples[1]} />
                  <SampleTile chainId={chainId} collection={address} sample={samples[2]} />
                </span>
              )}
            </span>
          ) : (
            <span className={clsx(styles.header__icon, styles['header__icon--fallback'])}>
              <HupMark size={44} />
            </span>
          )}

          <div className={styles.header__identity}>
            <div className={styles.header__titleRow}>
              <h1 className={styles.header__title}>{info.name || 'Unnamed collection'}</h1>
              {info.symbol && <span className={styles.header__symbol}>{info.symbol}</span>}

              {/* The collection's own links from LSP4Metadata, plus the maintenance menu —
                  right-aligned icon buttons, out of the title's way */}
              <div className={styles.header__actions}>
                {info.links.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.header__action}
                    title={linkLabel(link)}
                    aria-label={linkLabel(link)}
                  >
                    {/* The label above is what a screen reader announces, so the mark itself is decorative */}
                    {isXLink(link.url) ? (
                      <span className={styles.header__actionGlyph} aria-hidden="true">
                        𝕏
                      </span>
                    ) : (
                      <LinkSimpleIcon size={16} weight="bold" />
                    )}
                  </a>
                ))}

                <NativePopover
                  placement="bottom-end"
                  className={styles.header__menu}
                  trigger={
                    <button type="button" className={styles.header__action} aria-label="More collection actions" title="More">
                      <DotsThreeIcon size={18} weight="bold" />
                    </button>
                  }
                >
                  {({ close }) => (
                    <>
                      <button
                        type="button"
                        className={styles.header__menuItem}
                        onClick={() => {
                          handleCopy()
                          close()
                        }}
                      >
                        {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
                        <span>
                          Copy address
                          <small>{address}</small>
                        </span>
                      </button>

                      {collectionUrl && (
                        <a href={collectionUrl} target="_blank" rel="noopener noreferrer" className={styles.header__menuItem} onClick={close}>
                          <ArrowSquareOutIcon size={15} />
                          {/* Universal Everything, OpenSea or the chain's explorer, depending on
                              the standard and chain — the hostname says which without guessing */}
                          <span>
                            Open externally
                            <small>{linkLabel({ url: collectionUrl })}</small>
                          </span>
                        </a>
                      )}

                      <button
                        type="button"
                        className={styles.header__menuItem}
                        disabled={isRefreshing}
                        onClick={() => {
                          onRefresh?.()
                          close()
                        }}
                      >
                        <ArrowsClockwiseIcon size={15} className={clsx(isRefreshing && styles['header__menuItem--spinning'])} />
                        <span>
                          Refresh collection
                          <small>Re-read the banner, description, links and every NFT from the blockchain</small>
                        </span>
                      </button>
                    </>
                  )}
                </NativePopover>
              </div>
            </div>

            {/* LSP4Creators[] — each address renders through the shared Profile component,
                exactly like a post's author: avatar, resolved name, hover card, profile link */}
            {info.creators.length > 0 && (
              <div className={styles.header__creators}>
                <small>by</small>
                {info.creators.map((creator) => (
                  <Profile key={creator} variant="fullWithoutTime" creator={creator} networkId={chainId} />
                ))}
              </div>
            )}

            {info.description && (
              <p className={clsx(styles.header__description, !expanded && isLongDescription && styles['header__description--clamped'])}>
                {info.description}
                {isLongDescription && (
                  <button type="button" className={styles.header__readMore} onClick={() => setExpanded((current) => !current)}>
                    {expanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </p>
            )}

            <div className={styles.header__chips}>
              {chainInfo?.name && <span className={styles.header__chip}>{chainInfo.name}</span>}
              {standard && (
                <span className={styles.header__chip} title={standardTitle}>
                  {standard}
                </span>
              )}
              {/* Where the bytes live, graded — the one chip that can say a collection is
                  already gone. Painted in the grade's colour, not the chain's. */}
              {permanence.audit?.grade ? (
                <Link
                  href={`/nfts/audit?network=${chainId}&address=${address}`}
                  className={clsx(styles.header__chip, styles['header__chip--audit'])}
                  style={{ '--audit-color': gradeColor(permanence.audit.grade) }}
                  title={permanenceTitle}
                >
                  <ShieldCheckIcon size={12} weight="fill" />
                  Permanence {permanence.audit.grade}
                </Link>
              ) : permanence.isPending ? (
                <span
                  className={clsx(styles.header__chip, styles['header__chip--auditing'])}
                  title={permanence.audit?.startedAt ? "Hup is probing where this collection's bytes live" : "Queued for Hup's permanence audit — a worker picks it up next"}
                >
                  <SpinnerGapIcon size={12} className={styles['header__menuItem--spinning']} />
                  {permanence.audit?.startedAt ? 'Auditing' : 'Audit queued'}
                </span>
              ) : null}
              {/* Same badge its tiles carry, raised to the collection: this drop has NFTs
                  you can turn around, not just look at */}
              {info.models?.models > 0 && (
                <span className={clsx(styles.header__chip, styles['header__chip--model'])} title={describeModels(info.models)}>
                  <CubeIcon size={12} weight="fill" />
                  3D
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.header__stats}>
          {statTiles.map((tile) => (
            <div key={tile.key} className={styles.header__stat} title={tile.title}>
              <small>{tile.label}</small>
              <strong className={clsx(!tile.value && styles['header__statValue--empty'])}>
                {tile.value || (stats.isLoading ? '···' : '—')}
              </strong>
            </div>
          ))}
        </div>
      </div>
    </header>
  )
}
