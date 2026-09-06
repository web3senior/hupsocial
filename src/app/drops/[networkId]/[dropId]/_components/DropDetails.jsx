'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useConnection, useReadContract, useReadContracts } from 'wagmi'
import { formatUnits, isAddress, zeroAddress } from 'viem'
import clsx from 'clsx'
import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  CheckIcon,
  CopyIcon,
  DiscordLogoIcon,
  GlobeIcon,
  InfoIcon,
  InstagramLogoIcon,
  LinkSimpleIcon,
  ShareNetworkIcon,
  StorefrontIcon,
  TelegramLogoIcon,
  WarningIcon,
  XLogoIcon,
} from '@phosphor-icons/react'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import {
  DROP_GATES,
  DROP_RECORD_ABI,
  LSP8_DATA_KEYS,
  PHASE_STATUS,
  decodeVerifiableURI,
  dropStandardLabel,
  formatPhaseTime,
  gateLabel,
  isLuksoStandard,
  isNumberedStandard,
  phaseStatus,
  sharesOneTokenDocument,
} from '@/lib/drops'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { networkColorStyle } from '@/lib/networkColors'
import { formatRelativeTime } from '@/lib/collectionAuditFormat'
import { handleBrokenImage } from '@/lib/utils'
import { useDropCollection } from '@/hooks/useDropCollection'
import dropsAbi from '@/abis/HupDrops.json'
import collectionAbi from '@/abis/HupDropCollection.json'
import { buildAssetLinks } from '@/components/TradeCard'
import DropCard from '@/components/DropCard'
import DropEligibility from '@/components/DropEligibility'
import DropManagePanel from '@/components/DropManagePanel'
import DropSchedule from '@/components/DropSchedule'
import SplitPayoutCard from '@/components/SplitPayoutCard'
import Profile from '@/components/Profile'
import PageTitle from '@/components/PageTitle'
import HupMark from '@/components/ui/HupMark'
import ProgressBar from '@/components/ui/ProgressBar'
import Tooltip from '@/components/ui/Tooltip'
import CopyButton from '@/components/ui/CopyButton'
import Share from '@/components/ui/Share'
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
const countFormat = new Intl.NumberFormat('en')
const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })
const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
const dateTimeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

// LSP7 answers decimals() but keeps its symbol in ERC725Y, so a missing symbol read is normal
const PHASE_TOKEN_ABI = [
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
]

// The mint panel is the page's own: the artwork, title, progress and stages are drawn around it
const MINT_ONLY = { stats: false, pieces: false, mint: true }

const fetcher = (url) => fetch(url).then((res) => res.json())

const STATUS_LABELS = {
  live: 'Live',
  upcoming: 'Upcoming',
  paused: 'Paused',
  ended: 'Ended',
  soldout: 'Sold out',
  closed: 'Closed',
  draft: 'No stages yet',
}

// A numbered drop can mint long before its per-token artwork exists, so what the page shows may be
// a placeholder every id shares — which a collector is entitled to be told before they mint
const SHARED_ART = {
  pending: {
    badge: 'Placeholder art',
    value: 'Placeholder — not revealed yet',
    hint: 'Every NFT in this drop resolves to this one file, so the token you mint looks exactly like the artwork above. The creator can point each token at its own artwork later; nothing obliges them to.',
  },
  frozen: {
    badge: 'One shared artwork',
    value: 'One artwork, shared forever',
    hint: 'Every NFT in this drop resolves to this one file, and the collection metadata is frozen — this artwork is final and shared by every token. There is no reveal to wait for.',
  },
}

const GATE_HINTS = {
  [DROP_GATES.ALLOWLIST]: 'Only addresses the creator has allowlisted can mint this stage.',
  [DROP_GATES.FOLLOWERS]: 'Only wallets that follow the creator on Hup can mint this stage.',
  [DROP_GATES.ASSET_HOLDERS]: 'Only wallets holding the gate asset can mint this stage.',
  [DROP_GATES.ASSET_HOLDERS_1155]: 'Only wallets holding the gate asset can mint this stage.',
  [DROP_GATES.COMMUNITY]: 'Only members of the gated community can mint this stage.',
}

// One icon per link, matched the way the branding form matches its socials: title first, then host
const linkIcon = (link) => {
  const title = String(link.title ?? '').toLowerCase()
  const host = linkHost(link.url)
  if (title === 'x' || title === 'twitter' || /(^|\.)(x|twitter)\.com$/.test(host)) return XLogoIcon
  if (title === 'discord' || /discord\.(gg|com)$/.test(host)) return DiscordLogoIcon
  if (title === 'telegram' || /^(t\.me|telegram\.me)$/.test(host)) return TelegramLogoIcon
  if (title === 'instagram' || /instagram\.com$/.test(host)) return InstagramLogoIcon
  if (title === 'website') return GlobeIcon
  return LinkSimpleIcon
}

/**
 * Drop Details
 * The page behind DropCard's View link. Everything resolves live from the HupDrops engine and the
 * collection contract; DropCard supplies the mint action, this page the artwork, facts and history.
 */
export default function DropDetails({ networkId, dropId, referral }) {
  const chainId = Number(networkId)
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops || null
  const [copied, setCopied] = useState(false)
  const { address } = useConnection()
  // The referral link is absolute, and the server has no origin to agree on — read it at hydration
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => ''
  )
  const id = useMemo(() => {
    try {
      return BigInt(dropId)
    } catch {
      return null
    }
  }, [dropId])

  const {
    data: drop,
    isLoading,
    refetch: refetchDrop,
  } = useReadContract({
    abi: DROP_RECORD_ABI,
    address: dropsAddress,
    functionName: 'getDrop',
    args: [id ?? 0n],
    chainId,
    query: { enabled: Boolean(dropsAddress && id) },
  })

  const collection = drop?.collection && drop.collection !== zeroAddress ? drop.collection : null
  const numbered = drop ? isNumberedStandard(drop.standardId) : false
  const isLukso = drop ? isLuksoStandard(drop.standardId) : false

  const { data: payoutDestination } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'payoutDestination',
    args: [id ?? 0n],
    chainId,
    query: { enabled: Boolean(dropsAddress && id) },
  })
  const payoutOverride = payoutDestination && payoutDestination !== zeroAddress ? payoutDestination : null

  // Same phase pick as DropCard, so the facts sheet, the eligibility panel and the mint panel agree
  const { data: phases = [] } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'phasesOf',
    args: [id ?? 0n],
    chainId,
    query: { enabled: Boolean(dropsAddress && id) },
  })
  const statuses = useMemo(() => phases.map((entry) => phaseStatus(entry)), [phases])
  const livePhaseIndex = statuses.indexOf(PHASE_STATUS.LIVE)
  const eligibilityIndex = livePhaseIndex === -1 ? 0 : livePhaseIndex
  const sheetPhase = phases[eligibilityIndex] ?? null
  // Every token a phase charges in — a split holding one of them shows that balance too
  const paymentTokens = useMemo(
    () =>
      phases
        .filter((entry) => entry.token && entry.token !== zeroAddress)
        .map((entry) => ({ address: entry.token, isLsp7: Boolean(entry.isLsp7) })),
    [phases]
  )

  // Form facts that live on the collection contract rather than the engine's drop record
  const { data: collectionFacts } = useReadContracts({
    contracts: [
      { address: collection ?? undefined, abi: collectionAbi, functionName: 'burnable', chainId },
      { address: collection ?? undefined, abi: collectionAbi, functionName: 'royaltyBps', chainId },
      { address: collection ?? undefined, abi: collectionAbi, functionName: 'royaltyReceiver', chainId },
    ],
    query: { enabled: Boolean(collection) },
  })
  const burnable = Boolean(collectionFacts?.[0]?.result)
  const royaltyBps = Number(collectionFacts?.[1]?.result ?? 0)
  const royaltyReceiver = collectionFacts?.[2]?.result ?? null

  // The sheet quotes one stage, so only that stage's token needs resolving here — the full
  // schedule below does its own reads for the rest
  const sheetToken = sheetPhase?.token && sheetPhase.token !== zeroAddress ? sheetPhase.token : null
  const { data: sheetTokenReads } = useReadContracts({
    contracts: [
      { address: sheetToken ?? undefined, abi: PHASE_TOKEN_ABI, functionName: 'decimals', chainId },
      { address: sheetToken ?? undefined, abi: PHASE_TOKEN_ABI, functionName: 'symbol', chainId },
    ],
    query: { enabled: Boolean(sheetToken) },
  })
  const sheetTokenMeta = sheetToken
    ? { decimals: Number(sheetTokenReads?.[0]?.result ?? 18), symbol: sheetTokenReads?.[1]?.result || 'tokens' }
    : null

  // Mint history comes from the index; the live counts still come off the engine's drop record
  const { data: indexed } = useSWR(collection ? `/api/v1/drops/${dropId}?networkId=${chainId}` : null, fetcher, {
    refreshInterval: 30_000,
  })
  const recentMints = indexed?.data?.mints ?? []

  const minted = Number(drop?.minted ?? 0)
  const maxSupply = Number(drop?.maxSupply ?? 0)
  const isOpenEdition = maxSupply === 0

  /* Whether the artwork on this page is the final one or a placeholder every id still shares.
     LSP8 keeps its base URI in ERC725Y, readable from the collection's first block; ERC721 has no
     base URI getter, so the only way to ask is a minted token — hence the `minted` gate, which
     also skips a read that would revert. `metadataFrozen` separates a reveal that is still coming
     from one that can never happen. */
  const { data: tokenArtReads } = useReadContracts({
    contracts: [
      isLukso
        ? { address: collection ?? undefined, abi: collectionAbi, functionName: 'getData', args: [LSP8_DATA_KEYS.baseUri], chainId }
        : { address: collection ?? undefined, abi: collectionAbi, functionName: 'tokenURI', args: [1n], chainId },
      { address: collection ?? undefined, abi: collectionAbi, functionName: 'metadataFrozen', chainId },
    ],
    query: { enabled: Boolean(collection && numbered && (isLukso || minted > 0)) },
  })
  const tokenUri = isLukso ? decodeVerifiableURI(tokenArtReads?.[0]?.result) : (tokenArtReads?.[0]?.result ?? null)
  const artIsShared = numbered && sharesOneTokenDocument(tokenUri)
  const artSharedForever = artIsShared && Boolean(tokenArtReads?.[1]?.result)

  const { name, symbol, description, image, icon, links } = useDropCollection({
    chainId,
    collection,
    standardId: drop ? Number(drop.standardId) : undefined,
  })
  /* An LSP4 collection may carry only its square `icon` (images empty) — never blank the hero */
  const artwork = image || icon
  const imageUrl = artwork ? resolveStorageImageUrl(artwork) : null
  // The square icon reads at marker size where the full artwork cannot
  const markerArt = icon || image
  const markerUrl = markerArt ? resolveStorageImageUrl(markerArt, { width: 48 }) : null

  const { collectionUrl } = buildAssetLinks({
    chainId,
    chainInfo,
    collection,
    tokenId: '0',
    isLsp8: isLukso,
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

  const cardDrop = useMemo(
    () => ({ dropId, chainId, name, symbol, image: artwork, icon, show: MINT_ONLY }),
    [dropId, chainId, name, symbol, artwork, icon]
  )

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
  const isSoldOut = !isOpenEdition && minted >= maxSupply
  const dropStatus = isClosed
    ? 'closed'
    : isSoldOut
      ? 'soldout'
      : livePhaseIndex !== -1
        ? 'live'
        : statuses.includes(PHASE_STATUS.UPCOMING)
          ? 'upcoming'
          : statuses.includes(PHASE_STATUS.PAUSED)
            ? 'paused'
            : phases.length > 0
              ? 'ended'
              : 'draft'
  const isLive = dropStatus === 'live'
  const remaining = isOpenEdition ? null : Math.max(0, maxSupply - minted)
  const referralBps = Number(drop.referralBps ?? 0)
  const createdAt = Number(drop.createdAt ?? 0)
  const symbolLabel = symbol || dropStandardLabel(drop.standardId)

  // A link only earns while the drop pays a share and still has something to mint
  const referralOpen = referralBps > 0 && !isClosed && !isSoldOut && dropStatus !== 'ended'
  const viewerIsCreator = Boolean(address && drop.creator && address.toLowerCase() === drop.creator.toLowerCase())
  const referralPath = address ? `/drops/${chainId}/${dropId}?ref=${address}` : null
  const referralUrl = referralPath ? `${origin}${referralPath}` : null
  // Whose link brought this visitor: named only when the engine would actually pay them
  const referrer =
    referralOpen &&
    referral &&
    isAddress(referral) &&
    referral.toLowerCase() !== address?.toLowerCase() &&
    referral.toLowerCase() !== drop.creator?.toLowerCase()
      ? referral
      : null
  // What one NFT pays the referrer at the quoted stage's price, in that stage's currency
  const referralCut =
    referralOpen && sheetPhase && sheetPhase.price > 0n
      ? `${amountFormat.format(
          Number(
            formatUnits(
              (sheetPhase.price * BigInt(referralBps)) / 10000n,
              sheetTokenMeta?.decimals ?? chainInfo.nativeCurrency?.decimals ?? 18
            )
          )
        )} ${sheetTokenMeta ? sheetTokenMeta.symbol : (chainInfo.nativeCurrency?.symbol ?? '')}`
      : null

  const sharedArt = !artIsShared ? null : artSharedForever ? SHARED_ART.frozen : SHARED_ART.pending

  const sheetStatus = sheetPhase ? statuses[eligibilityIndex] : null
  const sheetGate = sheetPhase ? Number(sheetPhase.gate) : DROP_GATES.OPEN
  const sheetPrice = !sheetPhase
    ? null
    : sheetPhase.price === 0n
      ? 'Free'
      : `${amountFormat.format(
          Number(formatUnits(sheetPhase.price, sheetTokenMeta?.decimals ?? chainInfo.nativeCurrency?.decimals ?? 18))
        )} ${sheetTokenMeta ? sheetTokenMeta.symbol : (chainInfo.nativeCurrency?.symbol ?? '')}`
  const timing = !sheetPhase
    ? null
    : sheetStatus === PHASE_STATUS.UPCOMING
      ? ['Starts', formatPhaseTime(sheetPhase.startTime)]
      : sheetStatus === PHASE_STATUS.ENDED
        ? ['Ended', formatPhaseTime(sheetPhase.endTime)]
        : sheetStatus === PHASE_STATUS.PAUSED
          ? ['Status', 'Paused by the creator']
          : Number(sheetPhase.endTime) > 0
            ? ['Ends', formatPhaseTime(sheetPhase.endTime)]
            : null

  return (
    // Colours come from the drop's chain, not the connected wallet's
    <div className={`${styles.drop} animate fade`} style={networkColorStyle(chainInfo)}>
      {name && <PageTitle name={name} spacer={false} />}

      <Link href="/drops" className={styles.drop__back}>
        <ArrowLeftIcon size={14} />
        All drops
      </Link>

      <div className={styles.drop__hero}>
        {/* The column stretches so the artwork inside it can hold position while the facts scroll */}
        <div className={styles.drop__mediaColumn}>
          <div className={styles.drop__media}>
            {imageUrl ? (
              <img src={imageUrl} alt={name || `Drop #${dropId}`} onError={handleBrokenImage} />
            ) : (
              <div className={styles.drop__mediaFallback}>
                <HupMark size={48} />
              </div>
            )}
            <span className={clsx(styles.drop__status, styles[`drop__status--${dropStatus}`])}>{STATUS_LABELS[dropStatus]}</span>
            {sharedArt && <span className={styles.drop__sharedArt}>{sharedArt.badge}</span>}
          </div>
        </div>

        <div className={styles.drop__info}>
          <h1 className={styles.drop__title}>{name || `Drop #${dropId}`}</h1>

          <div className={styles.drop__byline}>
            <span>by</span>
            <Profile creator={drop.creator} networkId={chainId} variant="compact" size={24} />
          </div>

          {description && <p className={styles.drop__description}>{description}</p>}

          {links.length > 0 && (
            <div className={styles.drop__links}>
              {links.map((link) => {
                if (!link?.url) return null
                const Icon = linkIcon(link)
                const label = link.title || linkHost(link.url)
                return (
                  <Tooltip key={link.url} content={label} size="compact" hoverOnly>
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className={styles.drop__link} aria-label={label}>
                      <Icon size={16} />
                    </a>
                  </Tooltip>
                )
              })}
            </div>
          )}

          <dl className={styles.drop__sheet}>
            {phases.length > 1 && sheetPhase && (
              <div className={styles['drop__cell--wide']}>
                <dt>Stage</dt>
                <dd>
                  {sheetPhase.name?.trim() || `Stage ${eligibilityIndex + 1}`}
                  {sheetStatus === PHASE_STATUS.LIVE && <em className={styles.drop__live}>Live</em>}
                </dd>
              </div>
            )}
            {sheetPhase && (
              <>
                <div>
                  <dt>Price</dt>
                  <dd>{sheetPrice}</dd>
                </div>
                <div>
                  <dt>Wallet limit</dt>
                  <dd>{Number(sheetPhase.perWallet) === 0 ? 'Unlimited' : `${countFormat.format(Number(sheetPhase.perWallet))} NFT`}</dd>
                </div>
                <div>
                  <dt>
                    Access
                    {GATE_HINTS[sheetGate] && (
                      <Tooltip content={GATE_HINTS[sheetGate]}>
                        <span className={styles.drop__hint} tabIndex={0}>
                          <InfoIcon size={14} />
                        </span>
                      </Tooltip>
                    )}
                  </dt>
                  <dd className={clsx(sheetGate === DROP_GATES.OPEN && styles['drop__value--open'])}>{gateLabel(sheetGate)}</dd>
                </div>
                {timing && (
                  <div>
                    <dt>{timing[0]}</dt>
                    <dd>{timing[1]}</dd>
                  </div>
                )}
              </>
            )}
            <div>
              <dt>Supply</dt>
              <dd>{isOpenEdition ? 'Open edition' : countFormat.format(maxSupply)}</dd>
            </div>
            <div className={styles['drop__cell--wide']}>
              <dt>Standard</dt>
              <dd>
                {dropStandardLabel(drop.standardId)} · {numbered ? 'Unique numbered' : 'Identical editions'}
                {burnable ? ' · Burnable' : ''}
              </dd>
            </div>
            {sharedArt && (
              <div>
                <dt>
                  Token art
                  <Tooltip content={sharedArt.hint}>
                    <span className={styles.drop__hint} tabIndex={0}>
                      <InfoIcon size={14} />
                    </span>
                  </Tooltip>
                </dt>
                <dd className={styles['drop__value--shared']}>{sharedArt.value}</dd>
              </div>
            )}
            <div>
              <dt>Network</dt>
              <dd>{chainInfo.name}</dd>
            </div>
            {royaltyBps > 0 && (
              <div>
                <dt>Royalty</dt>
                <dd>
                  {percentFormat.format(royaltyBps / 100)}%
                  {royaltyReceiver && royaltyReceiver !== drop.creator ? ` to ${shortAddress(royaltyReceiver)}` : ''}
                </dd>
              </div>
            )}
            {referralBps > 0 && (
              <div>
                <dt>Referral share</dt>
                <dd>{percentFormat.format(referralBps / 100)}% of each paid mint</dd>
              </div>
            )}
            {payoutOverride && (
              <div>
                <dt>Proceeds go to</dt>
                <dd title={payoutOverride}>{shortAddress(payoutOverride)}</dd>
              </div>
            )}
            {createdAt > 0 && (
              <div>
                <dt>Created</dt>
                <dd>{dateFormat.format(new Date(createdAt * 1000))}</dd>
              </div>
            )}
            <div className={styles['drop__cell--wide']}>
              <dt>Collection</dt>
              <dd className={styles.drop__collection}>
                <span className={styles.drop__collectionId}>
                  {markerUrl ? <img src={markerUrl} alt="" onError={handleBrokenImage} /> : <HupMark size={12} />}
                  {symbol && <span>{symbol}</span>}
                  <span className={styles.drop__address} title={collection}>
                    {shortAddress(collection)}
                  </span>
                </span>
                <span className={styles.drop__collectionActions}>
                  <button
                    type="button"
                    className={styles.drop__iconButton}
                    onClick={handleCopy}
                    title="Copy collection address"
                    aria-label="Copy collection address"
                  >
                    {copied ? <CheckIcon size={13} weight="bold" /> : <CopyIcon size={13} />}
                  </button>
                  {collectionUrl && (
                    <a
                      href={collectionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.drop__iconButton}
                      title={`Open on ${linkHost(collectionUrl)}`}
                      aria-label={`Open on ${linkHost(collectionUrl)}`}
                    >
                      <ArrowSquareOutIcon size={13} />
                    </a>
                  )}
                  {/* The market only lists numbered collections — an edition has no per-token page to walk */}
                  {numbered && (
                    <Link href={`/nfts/${chainId}/collection/${collection}`} className={styles.drop__marketLink}>
                      <StorefrontIcon size={13} aria-hidden="true" />
                      View collection
                    </Link>
                  )}
                </span>
              </dd>
            </div>
          </dl>

          <div className={styles.drop__progress}>
            <div className={styles.drop__progressHead}>
              <span>NFTs minted</span>
              <strong>
                {countFormat.format(minted)}
                {isOpenEdition ? '' : ` / ${countFormat.format(maxSupply)}`}
              </strong>
            </div>
            {!isOpenEdition && (
              <ProgressBar
                value={minted}
                max={maxSupply}
                height={10}
                color={chainInfo.primaryColor}
                animated={isLive}
                sparkle={isLive}
                marker={markerUrl ? <img src={markerUrl} alt="" /> : <HupMark size={10} />}
                markerSize={22}
                ariaLabel={`${countFormat.format(minted)} of ${countFormat.format(maxSupply)} minted`}
              />
            )}
            <span className={styles.drop__progressNote}>
              {isOpenEdition
                ? 'Open edition — no supply cap'
                : isSoldOut
                  ? 'Every NFT has been minted'
                  : `${countFormat.format(remaining)} remaining`}
            </span>
          </div>

          <DropCard drop={cardDrop} referral={referrer ?? undefined} compact showDetailsLink={false} className={styles.drop__mint} />

          {referralOpen && (
            <section className={styles.drop__referral} aria-label="Referral link">
              <header className={styles.drop__referralHead}>
                <h3>
                  <ShareNetworkIcon size={16} aria-hidden="true" />
                  Share and earn {percentFormat.format(referralBps / 100)}%
                </h3>
                <small>
                  Every paid mint that arrives through your link pays you {percentFormat.format(referralBps / 100)}% of the price
                  {referralCut ? ` — ${referralCut} per NFT at the current stage price` : ''}, sent to your wallet in the same
                  transaction as the mint.
                  {sheetPhase && sheetPhase.price === 0n ? ' The current stage is free, so it pays no referral — paid stages do.' : ''}
                </small>
              </header>

              {viewerIsCreator ? (
                <p className={styles.drop__referralNote}>
                  You created this drop, so a link of your own earns nothing extra — the creator share is already yours. Anyone
                  else who shares it earns the referral cut.
                </p>
              ) : referralPath ? (
                <div className={styles.drop__referralRow}>
                  <code className={styles.drop__referralUrl} title={referralUrl}>
                    {referralUrl}
                  </code>
                  <CopyButton
                    value={referralPath}
                    label="Copy link"
                    title="Copy your referral link"
                    copiedTitle="Copied"
                    variant="chip"
                    toastMessage="Referral link copied"
                  />
                  <Share
                    url={referralUrl}
                    title={`Mint ${name || `drop #${dropId}`} on Hup`}
                    creator={drop.creator}
                    copyLabel="Copy referral link"
                    copiedToast="Referral link copied"
                    trigger={
                      <button type="button" className={styles.drop__referralShare} aria-label="Share your referral link">
                        <ShareNetworkIcon size={14} aria-hidden="true" />
                        Share
                      </button>
                    }
                  />
                </div>
              ) : (
                <p className={styles.drop__referralNote}>Connect a wallet to get a link of your own.</p>
              )}

              {referrer && (
                <div className={styles.drop__referralVia}>
                  <span>You&apos;re minting through a link from</span>
                  <Profile creator={referrer} networkId={chainId} variant="compact" size={18} />
                  <span>— they earn the referral share and your price doesn&apos;t change.</span>
                </div>
              )}
            </section>
          )}

          {phases.length > 1 && <DropSchedule chainId={chainId} chainInfo={chainInfo} phases={phases} heading="Mint stages" />}

          <DropEligibility chainId={chainId} dropId={dropId} phaseIndex={eligibilityIndex} phase={sheetPhase} creator={drop.creator} />

          {/* Money that reached a split waits there; these cards are where its payees collect it.
              One table can serve both mint money and royalties, in which case one card covers both. */}
          {payoutOverride && (
            <SplitPayoutCard
              chainId={chainId}
              candidate={payoutOverride}
              title={
                royaltyReceiver && royaltyReceiver.toLowerCase() === payoutOverride.toLowerCase()
                  ? 'Mint proceeds and resale royalties'
                  : 'Mint proceeds'
              }
              tokens={paymentTokens}
            />
          )}
          {royaltyReceiver && royaltyReceiver !== zeroAddress && royaltyReceiver.toLowerCase() !== payoutOverride?.toLowerCase() && (
            <SplitPayoutCard chainId={chainId} candidate={royaltyReceiver} title="Resale royalties" tokens={paymentTokens} />
          )}
        </div>
      </div>

      {recentMints.length > 0 && (
        <section className={styles.drop__mints}>
          <header>
            <h2>Recent mints</h2>
            {isLive && <span className={styles.drop__mintsLive}>Live</span>}
          </header>
          <ul>
            {recentMints.map((mint) => {
              const quantity = Number(mint.quantity)
              const first = Number(mint.first_token_id)
              // Numbered collections mint a contiguous run; editions are copies of the one artwork
              const what = numbered
                ? quantity > 1
                  ? `#${first}–#${first + quantity - 1}`
                  : `#${first}`
                : `${countFormat.format(quantity)} ×`
              return (
                <li key={`${mint.tx_hash}-${mint.first_token_id}`}>
                  <Profile creator={mint.minter} networkId={chainId} variant="compact" size={28} className={styles.drop__minter} />
                  <span className={styles.drop__mintVerb}>minted</span>
                  <b className={styles.drop__mintWhat}>
                    {what} {symbolLabel}
                  </b>
                  <time className={styles.drop__mintWhen} dateTime={mint.minted_at} title={dateTimeFormat.format(new Date(mint.minted_at))}>
                    {formatRelativeTime(mint.minted_at)}
                  </time>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <DropManagePanel chainId={chainId} dropId={dropId} drop={drop} collection={collection} onClosed={refetchDrop} />
    </div>
  )
}
