'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useReadContract } from 'wagmi'
import { zeroAddress } from 'viem'
import clsx from 'clsx'
import { ArrowSquareOutIcon, CaretLeftIcon, CheckIcon, CopyIcon, WarningIcon } from '@phosphor-icons/react'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { dropStandardLabel, isLuksoStandard } from '@/lib/drops'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { networkColorStyle } from '@/lib/networkColors'
import { handleBrokenImage } from '@/lib/utils'
import { useDropCollection } from '@/hooks/useDropCollection'
import dropsAbi from '@/abis/HupDrops.json'
import { buildAssetLinks } from '@/components/TradeCard'
import DropCard from '@/components/DropCard'
import DropManagePanel from '@/components/DropManagePanel'
import Profile from '@/components/Profile'
import PageTitle from '@/components/PageTitle'
import HupMark from '@/components/ui/HupMark'
import { toast } from '@/components/NextToast'
import { ContentSpinner } from '@/components/Loading'
import styles from './DropDetails.module.scss'

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

// The destination varies by standard and chain, so the tooltip names the host rather than
// promising a marketplace the link may not go to
const linkHost = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const percentFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

/**
 * Drop Details
 * The standalone page behind DropCard's View link. Drop state has no indexed API — everything
 * resolves live from the HupDrops engine and the drop's collection contract, so the page can
 * never present stale supply or phase state. The compact DropCard supplies the mint panel;
 * this page presents the artwork at full size (the same TradeCard-compact split the NFT
 * listing page uses).
 */
export default function DropDetails({ networkId, dropId }) {
  const router = useRouter()
  const chainId = Number(networkId)
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops || null
  const [copied, setCopied] = useState(false)
  const id = useMemo(() => {
    try {
      return BigInt(dropId)
    } catch {
      return null
    }
  }, [dropId])

  const { data: drop, isLoading, refetch: refetchDrop } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'getDrop',
    args: [id ?? 0n],
    chainId,
    query: { enabled: Boolean(dropsAddress && id) },
  })

  const collection = drop?.collection && drop.collection !== zeroAddress ? drop.collection : null

  // Identity resolves per standard family — LSP collections carry it in ERC725Y data keys,
  // EVM ones in name()/symbol()/contractURI()
  const { name, symbol, description, image, banner, links, refreshMetadata } = useDropCollection({
    chainId,
    collection,
    standardId: drop ? Number(drop.standardId) : undefined,
  })
  const imageUrl = image ? resolveStorageImageUrl(image) : null
  const bannerUrl = banner ? resolveStorageImageUrl(banner) : null

  // Same resolver the NFT market uses: LUKSO collections open on Universal Everything, ERC ones
  // on OpenSea where the chain has a slug, and everything else on the chain's explorer
  const { collectionUrl } = buildAssetLinks({
    chainId,
    chainInfo,
    collection,
    tokenId: '0',
    isLsp8: drop ? isLuksoStandard(drop.standardId) : false,
  })

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(collection)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('Could not copy the address', 'error')
    }
  }

  // The mint panel resolves everything else live; the page only seeds the static identity.
  // No allowlistCid here — that file's pointer only travels in posts, so allowlist mints
  // happen from the feed card while this page still shows the phase terms.
  const cardDrop = useMemo(() => ({ dropId, chainId, name, symbol, image }), [dropId, chainId, name, symbol, image])

  if (!chainInfo || !dropsAddress) {
    return (
      <div className={styles.drop__empty}>
        <WarningIcon size={28} />
        <p>NFT drops aren&apos;t live on this network.</p>
      </div>
    )
  }

  if (isLoading) return <ContentSpinner />

  if (!collection) {
    return (
      <div className={styles.drop__empty}>
        <WarningIcon size={28} />
        <p>This drop doesn&apos;t exist on {chainInfo.name}.</p>
      </div>
    )
  }

  const isClosed = Boolean(drop.closed)
  const referralBps = Number(drop.referralBps ?? 0)
  const createdAt = Number(drop.createdAt ?? 0)

  return (
    // Colours come from the drop's chain, not the connected wallet's
    <div className={`${styles.drop} animate fade`} style={networkColorStyle(chainInfo)}>
      {name && <PageTitle name={name} spacer={false} />}

      <button type="button" className={styles.drop__back} onClick={() => router.back()}>
        <CaretLeftIcon size={16} />
        Back
      </button>

      {bannerUrl && <img src={bannerUrl} alt="" className={styles.drop__banner} onError={handleBrokenImage} />}

      <div className={styles.drop__layout}>
        <div className={styles.drop__media}>
          {imageUrl ? (
            <img src={imageUrl} alt={name || `Drop #${dropId}`} onError={handleBrokenImage} />
          ) : (
            <div className={styles.drop__mediaFallback}>
              <HupMark size={40} />
            </div>
          )}
        </div>

        <div className={styles.drop__info}>
          <span className={styles.drop__eyebrow}>{symbol ? `Drop · ${symbol}` : 'Drop'}</span>
          <h1 className={styles.drop__title}>{name || `Drop #${dropId}`}</h1>

          <div className={styles.drop__chips}>
            <span className={styles.drop__chip}>{chainInfo.name}</span>
            <span className={styles.drop__chip}>{dropStandardLabel(drop.standardId)}</span>
            {isClosed && <span className={clsx(styles.drop__chip, styles['drop__chip--closed'])}>Closed</span>}
          </div>

          {/* The creator reads as a person, not a hex string — same Profile the feed uses,
              with its avatar, chain badge, and follow card */}
          <Profile creator={drop.creator} networkId={chainId} variant="compact" className={styles.drop__creator} />

          {description && <p className={styles.drop__description}>{description}</p>}

          {links.length > 0 && (
            <div className={styles.drop__links}>
              {links.map((link) =>
                link?.url ? (
                  <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">
                    {link.title || link.url}
                  </a>
                ) : null,
              )}
            </div>
          )}

          <DropCard drop={cardDrop} compact showDetailsLink={false} />

          <dl className={styles.drop__facts}>
            <div>
              <dt>Collection</dt>
              <dd className={styles.drop__address}>
                {collectionUrl ? (
                  <a href={collectionUrl} target="_blank" rel="noopener noreferrer" title={`Open on ${linkHost(collectionUrl)}`}>
                    {shortAddress(collection)}
                    <ArrowSquareOutIcon size={12} aria-hidden="true" />
                  </a>
                ) : (
                  shortAddress(collection)
                )}
                <button type="button" className={styles.drop__copy} onClick={handleCopy} title="Copy collection address" aria-label="Copy collection address">
                  {copied ? <CheckIcon size={12} weight="bold" /> : <CopyIcon size={12} />}
                </button>
              </dd>
            </div>
            {referralBps > 0 && (
              <div>
                <dt>Referral share</dt>
                <dd>{percentFormat.format(referralBps / 100)}% of each paid mint</dd>
              </div>
            )}
            {createdAt > 0 && (
              <div>
                <dt>Created</dt>
                <dd>{dateFormat.format(new Date(createdAt * 1000))}</dd>
              </div>
            )}
          </dl>

          {/* Creator-only management — renders nothing for everyone else */}
          <DropManagePanel
            chainId={chainId}
            dropId={dropId}
            drop={drop}
            collection={collection}
            collectionIdentity={{ name, symbol, description, image, banner, links }}
            onMetadataUpdated={refreshMetadata}
            onClosed={refetchDrop}
          />
        </div>
      </div>
    </div>
  )
}
