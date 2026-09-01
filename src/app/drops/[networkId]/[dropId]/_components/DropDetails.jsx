'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useReadContract } from 'wagmi'
import { formatEther, zeroAddress } from 'viem'
import clsx from 'clsx'
import { ArrowSquareOutIcon, CaretLeftIcon, CheckIcon, CopyIcon, WarningIcon } from '@phosphor-icons/react'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { PHASE_STATUS, dropStandardLabel, formatPhaseTime, gateLabel, isLuksoStandard, phaseStatus } from '@/lib/drops'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { networkColorStyle } from '@/lib/networkColors'
import { handleBrokenImage } from '@/lib/utils'
import { useDropCollection } from '@/hooks/useDropCollection'
import dropsAbi from '@/abis/HupDrops.json'
import { buildAssetLinks } from '@/components/TradeCard'
import DropCard from '@/components/DropCard'
import DropEligibility from '@/components/DropEligibility'
import DropManagePanel from '@/components/DropManagePanel'
import Profile from '@/components/Profile'
import PageTitle from '@/components/PageTitle'
import HupMark from '@/components/ui/HupMark'
import { toast } from '@/components/NextToast'
import { ContentSpinner } from '@/components/Loading'
import styles from './DropDetails.module.scss'

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

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
 * The page behind DropCard's View link. Everything resolves live from the HupDrops engine and the
 * collection contract; the compact DropCard supplies the mint panel, this page the artwork.
 */
const countFormat = new Intl.NumberFormat('en')

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

  const { data: payoutDestination } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'payoutDestination',
    args: [id ?? 0n],
    chainId,
    query: { enabled: Boolean(dropsAddress && id) },
  })
  const payoutOverride = payoutDestination && payoutDestination !== zeroAddress ? payoutDestination : null

  // Same phase pick as DropCard, so the eligibility panel and the mint panel agree
  const { data: phases = [] } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'phasesOf',
    args: [id ?? 0n],
    chainId,
    query: { enabled: Boolean(dropsAddress && id) },
  })
  const livePhaseIndex = phases.findIndex((entry) => phaseStatus(entry) === PHASE_STATUS.LIVE)

  // Straight off the engine's drop record — the stats strip should agree with the mint panel
  // to the token, and both read the same source rather than one trusting an indexed copy.
  const minted = Number(drop?.minted ?? 0)
  const maxSupply = Number(drop?.maxSupply ?? 0)
  const isOpenEdition = maxSupply === 0
  const eligibilityIndex = livePhaseIndex === -1 ? 0 : livePhaseIndex

  const { name, symbol, description, image, banner, links, refreshMetadata } = useDropCollection({
    chainId,
    collection,
    standardId: drop ? Number(drop.standardId) : undefined,
  })
  const imageUrl = image ? resolveStorageImageUrl(image) : null
  const bannerUrl = banner ? resolveStorageImageUrl(banner) : null

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

          <Profile creator={drop.creator} networkId={chainId} variant="compact" className={styles.drop__creator} />

          {/* Primary-sale facts only. A launchpad page has no floor, no volume and no top offer
              until a secondary market exists for the collection, and printing em-dashes under
              six headings says less than four numbers that are actually true. */}
          <dl className={styles.drop__stats}>
            <div>
              <dt>Minted</dt>
              <dd>
                {countFormat.format(minted)}
                {isOpenEdition ? '' : ` / ${countFormat.format(maxSupply)}`}
              </dd>
            </div>
            <div>
              <dt>Supply</dt>
              <dd>{isOpenEdition ? 'Open' : countFormat.format(maxSupply)}</dd>
            </div>
            <div>
              <dt>Stages</dt>
              <dd>{countFormat.format(phases.length)}</dd>
            </div>
            <div>
              <dt>Standard</dt>
              <dd>{dropStandardLabel(drop.standardId)}</dd>
            </div>
          </dl>

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

          {phases.length > 0 && (
            <section className={styles.drop__schedule}>
              <h2>Mint schedule</h2>
              <ol>
                {phases.map((phase, index) => {
                  const status = phaseStatus(phase)
                  const priced = phase.price > 0n
                  return (
                    <li key={index} className={clsx(status === PHASE_STATUS.LIVE && styles['drop__stage--live'])}>
                      <div className={styles.drop__stageHead}>
                        <strong>{phase.name?.trim() || `Stage ${index + 1}`}</strong>
                        {status === PHASE_STATUS.LIVE && <em>Live</em>}
                      </div>
                      <small>
                        {priced ? `${formatEther(phase.price)} ${chainInfo.nativeCurrency?.symbol ?? ''}` : 'Free'}
                        {' · '}
                        {Number(phase.perWallet) === 0 ? 'Unlimited per wallet' : `${countFormat.format(Number(phase.perWallet))} per wallet`}
                        {' · '}
                        {gateLabel(Number(phase.gate))}
                      </small>
                      <small className={styles.drop__stageWhen}>
                        {status === PHASE_STATUS.ENDED
                          ? `Ended ${formatPhaseTime(phase.endTime)}`
                          : status === PHASE_STATUS.PAUSED
                            ? 'Paused by the creator'
                            : status === PHASE_STATUS.UPCOMING
                              ? `Starts ${formatPhaseTime(phase.startTime)}`
                              : phase.endTime && Number(phase.endTime) > 0
                                ? `Open until ${formatPhaseTime(phase.endTime)}`
                                : 'Open — no end date'}
                      </small>
                    </li>
                  )
                })}
              </ol>
            </section>
          )}

          <DropEligibility
            chainId={chainId}
            dropId={dropId}
            phaseIndex={eligibilityIndex}
            phase={phases[eligibilityIndex] ?? null}
            creator={drop.creator}
          />

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
            {payoutOverride && (
              <div>
                <dt>Proceeds go to</dt>
                <dd className={styles.drop__address} title={payoutOverride}>
                  {shortAddress(payoutOverride)}
                </dd>
              </div>
            )}
            {createdAt > 0 && (
              <div>
                <dt>Created</dt>
                <dd>{dateFormat.format(new Date(createdAt * 1000))}</dd>
              </div>
            )}
          </dl>

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
