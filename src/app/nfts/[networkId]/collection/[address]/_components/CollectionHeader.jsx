'use client'

import { useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  CaretRightIcon,
  CheckIcon,
  CopyIcon,
  CubeIcon,
  DiscordLogoIcon,
  DotsThreeIcon,
  GithubLogoIcon,
  GlobeSimpleIcon,
  InstagramLogoIcon,
  MediumLogoIcon,
  TelegramLogoIcon,
  XLogoIcon,
  YoutubeLogoIcon,
} from '@phosphor-icons/react'
import { buildAssetLinks } from '@/components/TradeCard'
import { formatStake } from '@/hooks/useStakeToken'
import { handleBrokenImage } from '@/lib/utils'
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

// The links row is icon-only in this layout, so each one has to be recognisable without its
// label; anything unrecognised keeps the generic globe rather than guessing
const LINK_ICONS = [
  [/(^|\.)x\.com$|(^|\.)twitter\.com$/, XLogoIcon],
  [/(^|\.)discord\.(gg|com)$/, DiscordLogoIcon],
  [/(^|\.)t\.me$|(^|\.)telegram\.(me|org)$/, TelegramLogoIcon],
  [/(^|\.)instagram\.com$/, InstagramLogoIcon],
  [/(^|\.)github\.com$/, GithubLogoIcon],
  [/(^|\.)medium\.com$/, MediumLogoIcon],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, YoutubeLogoIcon],
]

const linkIcon = (url) => {
  try {
    const { hostname } = new URL(url)
    const match = LINK_ICONS.find(([pattern]) => pattern.test(hostname))
    return match ? match[1] : GlobeSimpleIcon
  } catch {
    return GlobeSimpleIcon
  }
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
      <div className={clsx(styles.header__banner, !info.banner && styles['header__banner--fallback'])}>
        {info.banner ? <img src={info.banner} alt="" onError={handleBrokenImage} /> : <HupMark size={48} />}
      </div>

      <nav className={styles.header__crumbs} aria-label="Breadcrumb">
        <Link href="/nfts">NFTs</Link>
        <CaretRightIcon size={12} />
        <span>{info.name || 'Collection'}</span>
      </nav>

      <div className={styles.header__card}>
        <div className={styles.header__main}>
          {info.icon ? (
            <img className={styles.header__icon} src={info.icon} alt="" onError={handleBrokenImage} />
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
                {info.links.map((link) => {
                  const Icon = linkIcon(link.url)
                  return (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.header__action}
                      title={linkLabel(link)}
                      aria-label={linkLabel(link)}
                    >
                      <Icon size={16} weight="fill" />
                    </a>
                  )
                })}

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
