'use client'

import { useState } from 'react'
import clsx from 'clsx'
import { ArrowSquareOutIcon, CheckIcon, CopyIcon, CubeIcon, LinkSimpleIcon, StackIcon } from '@phosphor-icons/react'
import { buildAssetLinks } from '@/components/TradeCard'
import { handleBrokenImage } from '@/lib/utils'
import Profile from '@/components/Profile'
import HupMark from '@/components/ui/HupMark'
import { toast } from '@/components/NextToast'
import styles from './CollectionHeader.module.scss'

const COUNT_FORMAT = new Intl.NumberFormat('en')

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

/**
 * Collection Header
 * The collection's onchain identity, Universal-Everything-style: LSP4 banner and icon,
 * name + symbol + standard, total supply, the contract address with copy/explorer
 * actions, the collection description, and LSP4Creators[] rendered as profile chips.
 * Everything shown comes from the contract (via the nft_collection_cache) — nothing here
 * is editable app state.
 * @param {Object} props
 * @param {number} props.chainId Chain the collection lives on.
 * @param {Object} [props.chainInfo] Entry from appChains, when the chain is configured.
 * @param {string} props.address Collection contract address.
 * @param {Object} props.info Result of useCollectionInfo for this collection.
 */
export default function CollectionHeader({ chainId, chainInfo, address, info }) {
  const [copied, setCopied] = useState(false)

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

  if (info.isLoading) {
    return (
      <div className={styles.header} aria-busy="true">
        <div className={clsx(styles.header__banner, styles['header__banner--skeleton'])} />
        <div className={styles.header__skeletonRow} />
      </div>
    )
  }

  return (
    <header className={styles.header}>
      {/* The LSP4 backgroundImage — or, failing that, the cover artwork — sets the stage
          exactly like a profile banner does */}
      {info.banner ? (
        <div className={styles.header__banner}>
          <img src={info.banner} alt="" onError={handleBrokenImage} />
        </div>
      ) : (
        <div className={clsx(styles.header__banner, styles['header__banner--fallback'])}>
          <HupMark size={40} />
        </div>
      )}

      <div className={styles.header__top}>
        <div className={styles.header__identity}>
          {info.icon ? (
            <img className={styles.header__icon} src={info.icon} alt="" onError={handleBrokenImage} />
          ) : (
            <span className={clsx(styles.header__icon, styles['header__icon--fallback'])}>
              <HupMark size={24} />
            </span>
          )}

          <div className={styles.header__titleBlock}>
            <div className={styles.header__titleRow}>
              <h1 className={styles.header__title}>{info.name || 'Unnamed collection'}</h1>
              {info.symbol && <span className={styles.header__symbol}>{info.symbol}</span>}
              {standard && (
                <span className={styles.header__chip} title={standardTitle}>
                  {standard}
                </span>
              )}
              {chainInfo?.name && <span className={styles.header__chip}>{chainInfo.name}</span>}
              {/* Same badge its tiles carry, raised to the collection: this drop has NFTs
                  you can turn around, not just look at */}
              {info.models?.models > 0 && (
                <span className={clsx(styles.header__chip, styles['header__chip--model'])} title={describeModels(info.models)}>
                  <CubeIcon size={12} weight="fill" />
                  3D
                </span>
              )}
            </div>

            {info.totalSupply !== null && (
              <p className={styles.header__stats}>
                <span>
                  <StackIcon size={13} weight="fill" />
                  Supply <b>{formatSupply(info.totalSupply)}</b>
                </span>
              </p>
            )}
          </div>
        </div>

        {/* LSP4Creators[] — each address renders through the shared Profile component,
            exactly like a post's author: avatar, resolved name, hover card, profile link */}
        {info.creators.length > 0 && (
          <div className={styles.header__creators}>
            <small>Created by</small>
            <div className={styles.header__creatorList}>
              {info.creators.map((creator) => (
                <Profile key={creator} variant="fullWithoutTime" creator={creator} networkId={chainId} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={styles.header__address}>
        <code title={address}>{address}</code>
        <button type="button" onClick={handleCopy} aria-label="Copy collection address" title="Copy collection address">
          {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
        </button>
        {collectionUrl && (
          <a href={collectionUrl} target="_blank" rel="noopener noreferrer" aria-label="View collection on explorer" title="View collection on explorer">
            <ArrowSquareOutIcon size={15} />
          </a>
        )}
      </div>

      {/* The collection's own links from LSP4Metadata — community, socials, website */}
      {info.links.length > 0 && (
        <div className={styles.header__links}>
          {info.links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className={styles.header__link} title={link.url}>
              <LinkSimpleIcon size={13} />
              {linkLabel(link)}
            </a>
          ))}
        </div>
      )}

      {info.description && <p className={styles.header__description}>{info.description}</p>}
    </header>
  )
}
