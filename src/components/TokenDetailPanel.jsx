'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { formatUnits } from 'viem'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  ArrowsClockwiseIcon,
  ArrowSquareOutIcon,
  ChartLineUpIcon,
  ClockCounterClockwiseIcon,
  CrownSimpleIcon,
  HandCoinsIcon,
  InfoIcon,
  ListBulletsIcon,
  PaperPlaneTiltIcon,
  ProhibitIcon,
  ReceiptIcon,
  SquaresFourIcon,
  StackIcon,
  TagIcon,
  TextAlignLeftIcon,
} from '@phosphor-icons/react'
import { appChains, CONTRACTS } from '@/config/contracts'
import { toRelative } from '@/lib/predict'
import { displayTokenId, normalizeTokenId } from '@/lib/walletNfts'
import { formatUsdAmount, rateFor } from '@/lib/usdAmount'
import { PERCENT_FORMAT, readFloorDelta } from '@/lib/nftFloorDelta'
import { formatStake } from '@/hooks/useStakeToken'
import { useProfile } from '@/hooks/useProfile'
import useNftMetadata from '@/hooks/useNftMetadata'
import useNftTokenMarket from '@/hooks/useNftTokenMarket'
import useTokenOwner from '@/hooks/useTokenOwner'
import useCollectionInfo from '@/hooks/useCollectionInfo'
import useCollectionFloor from '@/hooks/useCollectionFloor'
import useCollectionRarity from '@/hooks/useCollectionRarity'
import useCollectionTraits from '@/hooks/useCollectionTraits'
import useCollectionMetadataRefresh, { collectionRefreshLabel, describeCollectionRefresh } from '@/hooks/useCollectionMetadataRefresh'
import Profile from '@/components/Profile'
import TradeCard, { buildAssetLinks } from '@/components/TradeCard'
import OfferList from '@/components/OfferList'
import OfferModal from '@/components/OfferModal'
import SellNftModal from '@/components/SellNftModal'
import SendNftModal from '@/components/SendNftModal'
import DetailSection from '@/components/ui/DetailSection'
import { toast } from '@/components/NextToast'
import styles from './TokenDetailPanel.module.scss'

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

// Past this, the collection's blurb collapses behind "Read more" — the same ceiling the collection
// header gives it, so the two surfaces cut the same text at the same place
const COLLECTION_CLAMP = 240

// How rare a trait has to be to earn each badge colour. Read top-down: the first band a share
// falls under wins, so the thresholds are "at most this common".
const RARITY_TIERS = [
  { max: 0.05, key: 'legendary' },
  { max: 0.15, key: 'rare' },
  { max: 0.35, key: 'uncommon' },
  { max: Infinity, key: 'common' },
]

const rarityTier = (share) => RARITY_TIERS.find((tier) => share < tier.max).key

// Whole percents read as rarity; below one percent they'd all collapse to "0%", so the rarest
// traits — the ones a reader most wants the number for — get the decimals instead
const sharePercent = (share) =>
  new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: share < 0.01 ? 2 : 0 }).format(share)

const countFormatter = new Intl.NumberFormat()
const chartDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const chartPrice = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 3 })

// Each label names what the wallet printed beneath it did, not what happened to the token: a trade
// row credits the buyer, so it reads "Bought" rather than "Sale", which a reader takes as the
// profile having sold.
const ACTIVITY_META = {
  sale: { label: 'Bought', Icon: ReceiptIcon },
  listed: { label: 'Listed', Icon: TagIcon },
  cancelled: { label: 'Listing cancelled', Icon: ProhibitIcon },
  offer: { label: 'Offer', Icon: HandCoinsIcon },
}

/**
 * Wallet credit on one line — the resolved profile name, linking to their page. The shortened
 * address is the fallback while the lookup runs or when the wallet has no stored name. Deliberately
 * not the Profile component: this sits inside a sentence in the header, where an avatar and a
 * hover card would be a block element in the middle of a line.
 */
function WalletName({ address }) {
  const { profile } = useProfile(address)
  const name = profile?.fullName || (profile?.name && profile.name !== 'new-user' ? profile.name : null)

  return (
    <Link href={`/${address}`} title={address}>
      {name || shortAddress(address)}
    </Link>
  )
}

function PriceTooltip({ active, payload, symbol }) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null

  return (
    <div className={styles.token__tooltip}>
      <span>{chartDate.format(new Date(row.at * 1000))}</span>
      <strong>
        {chartPrice.format(row.price)} {symbol}
      </strong>
    </div>
  )
}

/**
 * Token Detail Panel
 * Everything one NFT carries, as the market sees it: who holds it, what it costs, what has been
 * offered for it, what it has done, and what makes it rare. The information column only — no
 * artwork — so the token page, the listing page and the collection grid's dialog can each frame
 * it their own way while showing a reader the same thing.
 *
 * The record is a stack of collapsible sections rather than tabs, because these questions aren't
 * mutually exclusive: a reader comparing a bid against the traits it is bidding on needs both
 * open at once, which a tab bar forbids by construction. `<details>` also means find-in-page
 * reaches a trait value inside a closed section, which the tabs silently prevented.
 *
 * The price card above them never scrolls away with the sections: whichever are open, buying,
 * listing, transferring and the top offer stay one tap from the top of the column.
 *
 * Ownership is read from the collection contract rather than from the listing row — HupTrade is
 * non-custodial, so an indexed seller is only who listed it, not who holds it now. Every
 * owner-only action gates on that read, which is also why they appear a beat late rather than
 * appearing and being retracted.
 *
 * Two of the figures here are shares of a sample rather than of the drop: trait rarity and the
 * rarity rank both come from cached metadata that fills in as tokens are rendered. Both suppress
 * themselves below their coverage floor instead of printing a number that would move on the next
 * reader's visit — see useCollectionTraits and useCollectionRarity.
 *
 * Dollar figures are decoration and fail soft: DefiLlama has no price for a testnet coin or an
 * unlisted ERC20, and those rows render in token terms alone rather than as "$0.00".
 *
 * @param {Object} props
 * @param {number|string} props.chainId Chain the collection lives on.
 * @param {string} props.collection Collection contract address.
 * @param {string} props.tokenId Token id in its raw form — bytes32 hex for LSP8, decimal for ERC721.
 * @param {boolean} [props.isLsp8]
 * @param {string|null} [props.collectionName] Names the token while its own metadata resolves.
 * @param {'h1'|'h2'} [props.as='h2'] Heading level for the token's name — a page passes h1, a
 * dialog h2.
 * @param {boolean} [props.showCollectionLink=true] Links the collection name to its page. The
 * collection page's own modal passes false: a link back to the page you are on is a dead end.
 * @param {boolean} [props.showListingLink=false] Offers a link through to the listing's own page
 * — /nfts/[chain]/[listingId], where this listing's fee and referral terms live. The token page
 * passes true; the listing page itself leaves it off.
 * @param {string|null} [props.tokenHref] The token's own page. Passed by the dialog, which is the
 * one surface a reader can't link anyone to; the token page itself passes null.
 * @param {boolean} [props.showCollectionAbout=true] Carries the collection's own description into
 * the Description section. The listing page passes false — its "About the collection" aside
 * already prints it, and the same blurb twice on one page reads as a bug.
 */
export default function TokenDetailPanel({
  chainId,
  collection,
  tokenId,
  isLsp8 = false,
  collectionName,
  as: Heading = 'h2',
  showCollectionLink = true,
  showListingLink = false,
  tokenHref = null,
  showCollectionAbout = true,
}) {
  const [sellOpen, setSellOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [offerOpen, setOfferOpen] = useState(false)
  const [aboutExpanded, setAboutExpanded] = useState(false)
  // The only controlled section: the card's "Top offer" button has to be able to open the offer
  // book, which means something outside the section decides its state
  const [offersOpen, setOffersOpen] = useState(true)

  const chain = Number(chainId)
  const chainInfo = appChains.find((item) => item.id === chain)
  const explorerUrl = chainInfo?.blockExplorers?.default?.url?.replace(/\/$/, '') || null
  // Offers live in HupOffers, not HupTrade — every offers surface here only exists on chains
  // where that contract is deployed
  const offersAddress = CONTRACTS[`chain${chain}`]?.offers || null

  // Shares its SWR key with whatever tile opened this, so the read costs nothing twice
  const metadata = useNftMetadata({ chainId: chain, collection, tokenId, isLsp8, imageWidth: 720 })
  const market = useNftTokenMarket({ chainId: chain, collection, tokenId, chainInfo })
  const owner = useTokenOwner({ chainId: chain, collection, tokenId, isLsp8 })
  const collectionInfo = useCollectionInfo({ chainId: chain, collection, isLsp8 })
  const collectionRefresh = useCollectionMetadataRefresh({ chainId: chain, collection })

  // What every price on this page is measured against — the ask as much as each bid, so it is
  // fetched wherever there is a price, not only where HupOffers is deployed. Shares its cache key
  // with the collection table's own read.
  const floor = useCollectionFloor({ chainId: chain, collection, chainInfo })

  const rarity = useCollectionRarity({ chainId: chain, collection, totalSupply: collectionInfo.totalSupply })
  // Collection scope, not listed: "52% have Hide" is a claim about the drop, and counting it over
  // the handful of tokens that happen to be for sale would make it a claim about the shelf
  const traits = useCollectionTraits({
    chainId: chain,
    collection,
    scope: 'collection',
    floor: true,
    totalSupply: collectionInfo.totalSupply,
  })

  const label = displayTokenId(tokenId)
  const name = metadata.name || (collectionName ? `${collectionName} #${label}` : `#${label}`)
  const collectionLabel = metadata.collectionName || collectionInfo.name || collectionName || null
  const collectionHref = `/nfts/${chain}/collection/${collection.toLowerCase()}`

  // What the drop says about itself, for the many tokens that carry no words of their own. Dropped
  // when the collection stamped the same paragraph onto every token — printing it twice under one
  // heading would read as the token repeating itself.
  const collectionAbout = useMemo(() => {
    const text = collectionInfo.description?.trim()
    if (!showCollectionAbout || !text) return null
    return text === metadata.description?.trim() ? null : text
  }, [showCollectionAbout, collectionInfo.description, metadata.description])

  // Roughly the three lines the clamp gives it, so a one-line blurb never sprouts a toggle
  const isLongAbout = (collectionAbout?.length || 0) > COLLECTION_CLAMP

  // LUKSO's standard reads as "NFT 2.0" in the UI; the literal LSP8 name lives in the tooltip
  const standard = isLsp8 ? 'NFT 2.0' : 'ERC721'
  const standardTitle = isLsp8 ? 'LSP8' : undefined

  const { collectionUrl, tokenUrl } = buildAssetLinks({ chainId: chain, chainInfo, collection, tokenId, isLsp8 })

  const listing = market.listing
  const topOffer = market.topOffer
  const topOfferPrice = topOffer ? formatStake(topOffer.price, topOffer.decimals) : null
  const topOfferUsd = topOffer ? formatUsdAmount(topOffer.price, topOffer.decimals, rateFor(market.usd, topOffer.payment_token)) : null
  const listingUsd = listing ? formatUsdAmount(listing.price, listing.decimals, rateFor(market.usd, listing.payment_token)) : null
  const isOwner = owner.isOwner

  // The route answers newest first, so the head of the list is the most recent sale
  const lastSale = market.sales[0] || null

  // Rank lookups are keyed on the id as it is stored, and the two dialects both reach this
  // component — a bytes32 id from the collection grid, a decimal one from a listing row
  const rank = useMemo(() => {
    if (!rarity.isTrustworthy) return null
    const ranks = rarity.rankByToken
    return ranks.get(String(tokenId)) ?? ranks.get(displayTokenId(tokenId)) ?? null
  }, [rarity.isTrustworthy, rarity.rankByToken, tokenId])

  // A rank means little without its denominator, but a percentile reads at a glance — so the
  // badge carries the percentile and the tooltip carries the rank it came from
  const rankPercentile = rank && rarity.total ? rank / rarity.total : null

  // One currency only, the one most of this token's sales settled in. Plotting an ETH sale and a
  // USDC sale on one axis would draw a price move that never happened.
  const priceSeries = useMemo(() => {
    const sales = market.sales
    if (!sales.length) return null

    const counts = new Map()
    for (const sale of sales) counts.set(sale.payment_token, (counts.get(sale.payment_token) || 0) + 1)
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]

    const kept = sales.filter((sale) => sale.payment_token === dominant && sale.decimals !== undefined)
    const points = kept
      .map((sale) => {
        try {
          return { at: sale.at, price: Number(formatUnits(BigInt(sale.price), sale.decimals)), tx_hash: sale.tx_hash }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      // The route answers newest first, for the timeline; a chart reads the other way
      .sort((a, b) => a.at - b.at)

    return {
      points,
      symbol: kept[0]?.symbol || '',
      // Sales in another currency aren't plotted, and a chart that quietly drops half a token's
      // history is worse than one that says it did
      omitted: sales.length - kept.length,
    }
  }, [market.sales])

  const handleRefreshMetadata = async () => {
    try {
      await metadata.refresh()
      toast('Metadata refreshed from the blockchain', 'success')
    } catch (error) {
      toast(error.message || 'Could not refresh metadata', 'error')
    }
  }

  const handleRefreshCollection = async () => {
    try {
      const result = await collectionRefresh.refresh()
      if (!result) return
      toast(...describeCollectionRefresh(result))
    } catch (error) {
      toast(error.message || 'Could not refresh the collection', 'error')
    }
  }

  // The panel's own actions are what change this token's market record, so nothing else would
  // tell it to re-read — and the owner read has to follow a transfer as well as the market one
  const handleTraded = () => {
    market.refresh()
    owner.refetch()
  }

  // How the live ask compares to the rest of the collection, which is the question a reader asks
  // of a price before they ask anything else about it
  const listingFloor = readFloorDelta({ price: listing?.price, symbol: listing?.symbol, floor })

  return (
    <section className={styles.token}>
      <header className={styles.token__header}>
        {/* Collection above the name, the way a drop names its tokens — the token's own name is
            rarely meaningful without it */}
        {collectionLabel &&
          (showCollectionLink ? (
            <Link href={collectionHref} className={styles.token__collection}>
              {collectionLabel}
            </Link>
          ) : (
            <span className={styles.token__collection}>{collectionLabel}</span>
          ))}

        <Heading className={styles.token__title}>{name}</Heading>

        <div className={styles.token__identity}>
          <span className={styles.token__owner}>
            Owned by{' '}
            {isOwner ? <strong>You</strong> : owner.owner ? <WalletName address={owner.owner} /> : <span aria-hidden="true">…</span>}
          </span>

          {/* Suppressed entirely rather than shown as a placeholder: a rank the cache can't
              stand behind is worse than no rank at all */}
          {rankPercentile !== null && (
            <span
              className={styles.token__rank}
              title={`Rank ${countFormatter.format(rank)} of ${countFormatter.format(rarity.total)} by ${
                rarity.source === 'published' ? 'the collection’s own rarity ranking' : 'trait rarity across the tokens Hup has resolved'
              }`}
            >
              <CrownSimpleIcon size={14} weight="fill" />
              Top {sharePercent(rankPercentile)}
            </span>
          )}
        </div>

        {/* The facts this app can actually stand behind about the token, in place of the view and
            favourite counters a marketplace with an account system would print here. Hup indexes
            neither, and a fabricated number is worse than a missing one. */}
        <dl className={styles.token__stats}>
          <div className={styles.token__stat}>
            <dt>Chain</dt>
            <dd>{chainInfo?.name || `#${chain}`}</dd>
          </div>
          <div className={styles.token__stat}>
            <dt>Standard</dt>
            <dd title={standardTitle}>{standard}</dd>
          </div>
          {collectionInfo.totalSupply !== null && (
            <div className={styles.token__stat}>
              <dt>Items</dt>
              <dd>{countFormatter.format(collectionInfo.totalSupply)}</dd>
            </div>
          )}
          {lastSale && (
            <div className={styles.token__stat}>
              <dt>Last sale</dt>
              <dd>
                {formatStake(lastSale.price, lastSale.decimals) ?? '…'} {lastSale.symbol}
              </dd>
            </div>
          )}
        </dl>
      </header>

      {/* Price card. When there is a live ask, TradeCard is the card: it resolves price and status
          onchain before it will sell anything, so a listing indexed a moment ago can never sell on
          stale terms. With no ask, the best standing bid is the headline instead — which is what a
          reader is deciding against. */}
      <div className={styles.token__trade}>
        {listing ? (
          <>
            <TradeCard
              listing={{
                listingId: String(listing.listing_id),
                chainId: chain,
                collection,
                tokenId,
                isLsp8,
              }}
              compact
              showDetailsLink={showListingLink}
            />

            {/* TradeCard prints the ask in its own currency; these are the two comparisons a
                reader makes against it, and neither belongs inside a component that also
                signs transactions */}
            {(listingUsd || listingFloor.delta !== null) && (
              <p className={styles.token__askMeta}>
                {listingUsd && <span className={styles.token__usd}>{listingUsd}</span>}
                {listingFloor.delta !== null &&
                  (listingFloor.atFloor ? (
                    <span>At floor</span>
                  ) : (
                    <span
                      className={clsx(styles.token__delta, listingFloor.delta < 0 && styles['token__delta--under'])}
                      title={`${listingFloor.delta < 0 ? 'Below' : 'Above'} the ${formatStake(floor.floor, floor.decimals)} ${
                        floor.symbol
                      } collection floor`}
                    >
                      {PERCENT_FORMAT.format(listingFloor.delta)} vs floor
                    </span>
                  ))}
              </p>
            )}
          </>
        ) : (
          <div className={styles.token__headline}>
            <small className={styles.token__headlineLabel}>{topOffer ? 'Best offer' : 'Status'}</small>

            {topOffer ? (
              <p className={styles.token__headlinePrice}>
                <strong>
                  {topOfferPrice ?? '…'} {topOffer.symbol}
                </strong>
                {topOfferUsd && <span className={styles.token__usd}>{topOfferUsd}</span>}
              </p>
            ) : (
              <p className={styles.token__status}>{market.isLoading ? 'Loading…' : 'Not listed'}</p>
            )}
          </div>
        )}

        <div className={styles.token__actions}>
          {isOwner && !listing && (
            <button type="button" className={clsx(styles.token__action, styles['token__action--primary'])} onClick={() => setSellOpen(true)}>
              <TagIcon size={16} />
              List for sale
            </button>
          )}

          {!isOwner && offersAddress && (
            <button
              type="button"
              className={clsx(styles.token__action, !listing && styles['token__action--primary'])}
              onClick={() => setOfferOpen(true)}
            >
              <HandCoinsIcon size={16} />
              Make offer
            </button>
          )}

          {/* The offer itself is accepted from the Offers section, where the terms and the expiry
              are in view — this opens it and scrolls no further, rather than accepting in one tap */}
          {topOffer && (
            <button type="button" className={styles.token__action} onClick={() => setOffersOpen(true)}>
              {isOwner ? 'Review top offer' : 'Top offer'} for {topOfferPrice ?? '…'} {topOffer.symbol}
            </button>
          )}

          {isOwner && (
            <button
              type="button"
              className={styles.token__action}
              onClick={() => setSendOpen(true)}
              // A non-custodial listing leaves the NFT in its owner's wallet, so this stays
              // possible while listed — and stranding the ask is the reader's call to make knowingly
              title={listing ? 'Transferring while listed leaves an ask nobody can fill — cancel the listing first' : undefined}
            >
              <PaperPlaneTiltIcon size={16} />
              Transfer
            </button>
          )}

          {/* The dialog is the one surface with no URL of its own — a reader who wants to send
              this to somebody needs the token's page */}
          {tokenHref && (
            <Link href={tokenHref} className={styles.token__action}>
              <ArrowSquareOutIcon size={16} />
              Open full page
            </Link>
          )}
        </div>
      </div>

      <div className={styles.token__sections}>
        <DetailSection
          title="Price History"
          icon={<ChartLineUpIcon size={16} />}
          defaultOpen
          aside={priceSeries?.points.length ? `${priceSeries.points.length} ${priceSeries.points.length === 1 ? 'sale' : 'sales'}` : null}
        >
          {!priceSeries || priceSeries.points.length === 0 ? (
            <p className={styles.token__empty}>{market.isLoading ? 'Loading…' : 'This token has never sold on Hup.'}</p>
          ) : priceSeries.points.length === 1 ? (
            // One point is not a trend, and a line chart drawn through it would imply one
            <p className={styles.token__single}>
              Sold once, for{' '}
              <strong>
                {chartPrice.format(priceSeries.points[0].price)} {priceSeries.symbol}
              </strong>{' '}
              {toRelative(priceSeries.points[0].at)}.
            </p>
          ) : (
            <>
              <div className={styles.token__chart}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={priceSeries.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="at"
                      type="number"
                      scale="time"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={(at) => chartDate.format(new Date(at * 1000))}
                      tick={{ fontSize: 11, fill: 'var(--gray-400)' }}
                      stroke="var(--border)"
                      minTickGap={24}
                    />
                    <YAxis
                      width={48}
                      tickFormatter={(value) => chartPrice.format(value)}
                      tick={{ fontSize: 11, fill: 'var(--gray-400)' }}
                      stroke="var(--border)"
                    />
                    <Tooltip content={<PriceTooltip symbol={priceSeries.symbol} />} cursor={{ stroke: 'var(--border-strong)' }} />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke="var(--chart-line)"
                      strokeWidth={2}
                      dot={{ r: 3, fill: 'var(--chart-line)', strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {priceSeries.omitted > 0 && (
                <p className={styles.token__note}>
                  {priceSeries.omitted} {priceSeries.omitted === 1 ? 'sale is' : 'sales are'} not plotted —{' '}
                  {priceSeries.omitted === 1 ? 'it' : 'they'} settled in another currency, which this axis can&apos;t hold.
                </p>
              )}
            </>
          )}
        </DetailSection>

        {/* One row at most: an ERC721 or LSP8 token is indivisible, so it carries a single ask.
            Its own section anyway, because "is it for sale, and on what terms" is a different
            question from "what has anyone bid" — and the two answers move independently. */}
        <DetailSection title="Listings" icon={<ListBulletsIcon size={16} />} count={listing ? 1 : 0} defaultOpen={Boolean(listing)}>
          {!listing ? (
            <p className={styles.token__empty}>
              {market.isLoading ? 'Loading…' : 'Not listed for sale. Any past listings are in Activity below.'}
            </p>
          ) : (
            <div className={styles.token__scroller}>
              <table className={styles.token__table}>
                <thead>
                  <tr>
                    <th scope="col">Price</th>
                    <th scope="col">USD Price</th>
                    {floor?.floor && <th scope="col">Floor Difference</th>}
                    <th scope="col">Listed</th>
                    <th scope="col">From</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td data-label="Price" className={styles.token__cellPrice}>
                      {formatStake(listing.price, listing.decimals) ?? '…'} {listing.symbol}
                    </td>
                    <td data-label="USD Price" className={styles.token__cellMuted}>
                      {listingUsd ?? '—'}
                    </td>
                    {floor?.floor && (
                      <td data-label="Floor Difference">
                        {listingFloor.delta === null ? (
                          <span className={styles.token__cellMuted}>—</span>
                        ) : listingFloor.atFloor ? (
                          <span className={styles.token__cellMuted}>At floor</span>
                        ) : (
                          <span className={clsx(styles.token__delta, listingFloor.delta < 0 && styles['token__delta--under'])}>
                            {PERCENT_FORMAT.format(listingFloor.delta)}
                          </span>
                        )}
                      </td>
                    )}
                    <td data-label="Listed" className={styles.token__cellMuted}>
                      {toRelative(listing.listed_at)}
                    </td>
                    <td data-label="From">
                      <Profile variant="fullWithoutTime" creator={listing.seller} networkId={chain} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </DetailSection>

        {offersAddress && (
          <DetailSection
            title="Offers"
            icon={<HandCoinsIcon size={16} />}
            open={offersOpen}
            onToggle={setOffersOpen}
            aside={floor?.floor ? `Floor ${formatStake(floor.floor, floor.decimals)} ${floor.symbol}` : null}
          >
            <OfferList
              variant="table"
              chainId={chain}
              collection={collection}
              tokenId={tokenId}
              isLsp8={isLsp8}
              ownerAddress={owner.owner}
              floor={floor}
            />

            {!isOwner && (
              <button type="button" className={styles.token__action} onClick={() => setOfferOpen(true)}>
                <HandCoinsIcon size={16} />
                Make offer
              </button>
            )}
          </DetailSection>
        )}

        <DetailSection
          title="Traits"
          icon={<SquaresFourIcon size={16} />}
          count={metadata.attributes.length}
          defaultOpen={metadata.attributes.length > 0}
        >
          {metadata.attributes.length === 0 ? (
            <p className={styles.token__empty}>This token publishes no traits.</p>
          ) : (
            <>
              <ul className={styles.token__traits}>
                {metadata.attributes.map((attr) => {
                  const stats = traits.statsFor(attr.label, attr.value)
                  const share = traits.isShareTrustworthy ? (stats?.share ?? null) : null
                  const traitFloor = stats?.floor ? formatStake(stats.floor, traits.floorCurrency?.decimals) : null
                  const floorSymbol = traits.floorCurrency?.symbol || chainInfo?.nativeCurrency?.symbol || ''

                  return (
                    <li key={`${attr.label}:${attr.value}`} className={styles.token__trait}>
                      <small className={styles.token__traitLabel}>{attr.label}</small>
                      <strong className={styles.token__traitValue} title={attr.value}>
                        {attr.value}
                      </strong>

                      <div className={styles.token__traitFooter}>
                        {share !== null ? (
                          <span
                            className={clsx(styles.token__share, styles[`token__share--${rarityTier(share)}`])}
                            title={`${countFormatter.format(stats.count)} of ${countFormatter.format(traits.scanned)} tokens carry this trait`}
                          >
                            {sharePercent(share)}
                          </span>
                        ) : (
                          <span className={styles.token__shareUnknown} />
                        )}

                        {/* The cheapest token carrying this trait, which is what "is this trait
                            worth paying for?" actually asks */}
                        {traitFloor && (
                          <span
                            className={styles.token__traitFloor}
                            title={`Cheapest token with this trait: ${traitFloor} ${floorSymbol}`}
                          >
                            {traitFloor} <small>{floorSymbol}</small>
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>

              {!traits.isShareTrustworthy && (
                <p className={styles.token__note}>
                  Trait rarity is hidden until enough of this collection has been viewed on Hup — the percentages would move every time
                  somebody opened a new token.
                </p>
              )}
            </>
          )}
        </DetailSection>

        <DetailSection title="Activity" icon={<ClockCounterClockwiseIcon size={16} />} count={market.activity.length}>
          {market.activity.length === 0 ? (
            <p className={styles.token__empty}>
              {market.isLoading ? 'Loading…' : 'Nothing has happened to this token on Hup yet — no listings, offers or sales.'}
            </p>
          ) : (
            <ul className={styles.token__activity}>
              {market.activity.map((entry) => {
                // Falls back rather than throwing: a type this build doesn't know about is a
                // row the route learned to emit, not a reason to blank the whole timeline
                const meta = ACTIVITY_META[entry.type] || { label: entry.type, Icon: ReceiptIcon }
                const price = formatStake(entry.price, entry.decimals)
                // Settled server-side against chain time — an offer's liveness is not something
                // the reader's clock gets a vote in
                const isLiveOffer = entry.type === 'offer' && entry.is_live

                return (
                  <li key={`${entry.type}:${entry.listing_id ?? entry.offer_id}:${entry.at}`} className={styles.token__event}>
                    <span className={clsx(styles.token__eventIcon, styles[`token__eventIcon--${entry.type}`])}>
                      <meta.Icon size={14} weight="bold" />
                    </span>

                    <div className={styles.token__eventBody}>
                      <span className={styles.token__eventTitle}>
                        {meta.label}
                        {isLiveOffer && <em className={styles.token__eventFlag}>Live</em>}
                      </span>
                      <Profile variant="fullWithoutTime" creator={entry.wallet_address} networkId={chain} />
                    </div>

                    <div className={styles.token__eventMeta}>
                      {price && (
                        <strong>
                          {price} {entry.symbol}
                        </strong>
                      )}
                      <span
                        // cidex stores no chain timestamp for a cancellation, so this is when the
                        // row was replayed — close to the moment, but not the moment itself
                        title={entry.at_source === 'indexed' ? 'When Hup recorded this — the chain event carries no timestamp' : undefined}
                      >
                        {entry.at_source === 'indexed' && '~'}
                        {toRelative(entry.at)}
                        {explorerUrl && entry.tx_hash && (
                          <a href={`${explorerUrl}/tx/${entry.tx_hash}`} target="_blank" rel="noopener noreferrer" aria-label="Transaction">
                            <ArrowSquareOutIcon size={12} />
                          </a>
                        )}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </DetailSection>

        {(metadata.description || collectionAbout) && (
          <DetailSection title="Description" icon={<TextAlignLeftIcon size={16} />} defaultOpen>
            {/* Attribution first, the way a marketplace credits a work — LSP4Creators[] through
                the same Profile component every other wallet on this page goes through */}
            {collectionInfo.creators.length > 0 && (
              <div className={styles.token__by}>
                <small>By</small>
                {collectionInfo.creators.map((creator) => (
                  <Profile key={creator} variant="fullWithoutTime" creator={creator} networkId={chain} />
                ))}
              </div>
            )}

            {metadata.description && <p className={styles.token__description}>{metadata.description}</p>}

            {/* The collection's blurb under the token's own, attributed — the sentence "this is a
                Hup Pass" belongs to every token of the contract, not to this one, and a reader who
                opened one NFT shouldn't have to walk back to the collection page to read it */}
            {collectionAbout && (
              <section className={styles.token__about}>
                <small className={styles.token__aboutLabel}>About {collectionLabel || 'the collection'}</small>

                <p className={clsx(styles.token__description, isLongAbout && !aboutExpanded && styles['token__description--clamped'])}>
                  {collectionAbout}
                </p>

                {/* Outside the clamped paragraph, not inline at the end of it: a line-clamp cuts
                    everything past its last line, and a toggle a reader can't see can't be pressed */}
                {isLongAbout && (
                  <button
                    type="button"
                    className={styles.token__readMore}
                    aria-expanded={aboutExpanded}
                    onClick={() => setAboutExpanded((current) => !current)}
                  >
                    {aboutExpanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </section>
            )}
          </DetailSection>
        )}

        <DetailSection title="Details" icon={<InfoIcon size={16} />}>
          <dl className={styles.token__details}>
            <div>
              <dt>Blockchain</dt>
              <dd>{chainInfo?.name || `Network #${chain}`}</dd>
            </div>
            <div>
              <dt>Collection address</dt>
              <dd>
                {collectionUrl ? (
                  <a href={collectionUrl} target="_blank" rel="noopener noreferrer">
                    {shortAddress(collection)}
                    <ArrowSquareOutIcon size={12} />
                  </a>
                ) : (
                  shortAddress(collection)
                )}
              </dd>
            </div>
            <div>
              <dt>Token id</dt>
              <dd title={String(tokenId)}>
                {tokenUrl ? (
                  <a href={tokenUrl} target="_blank" rel="noopener noreferrer">
                    {label}
                    <ArrowSquareOutIcon size={12} />
                  </a>
                ) : (
                  label
                )}
              </dd>
            </div>
            <div>
              <dt>NFT standard</dt>
              <dd title={standardTitle}>{standard}</dd>
            </div>
            {owner.owner && (
              <div>
                <dt>Owner</dt>
                <dd>{isOwner ? 'You' : <WalletName address={owner.owner} />}</dd>
              </div>
            )}
            {listing && (
              <div>
                <dt>Listing id</dt>
                <dd>#{listing.listing_id}</dd>
              </div>
            )}
            {collectionInfo.totalSupply !== null && (
              <div>
                <dt>Collection size</dt>
                <dd>{countFormatter.format(collectionInfo.totalSupply)} items</dd>
              </div>
            )}
          </dl>

          {/* Metadata a collection publishes once for the whole drop — say so, rather than
              letting a collection banner pass for this token's artwork */}
          {metadata.source === 'collection' && (
            <p className={styles.token__note}>
              This collection publishes one set of metadata for all of its tokens, so the artwork and name above describe the collection
              rather than this token.
            </p>
          )}

          {/* Collections that change their onchain metadata give the app no signal, so a cached
              token keeps its old name and artwork until the TTL lapses. These are the escape
              hatches — one token, or the whole drop. */}
          <div className={styles.token__refreshRow}>
            <button
              type="button"
              className={styles.token__action}
              onClick={handleRefreshMetadata}
              disabled={metadata.isRefreshing}
              title="Re-read this NFT's name, traits and artwork from the blockchain"
            >
              <ArrowsClockwiseIcon size={14} className={clsx(metadata.isRefreshing && styles['token__action--spinning'])} />
              {metadata.isRefreshing ? 'Refreshing…' : 'Refresh metadata'}
            </button>

            <button
              type="button"
              className={styles.token__action}
              onClick={handleRefreshCollection}
              disabled={collectionRefresh.isRefreshing}
              title="Re-read every NFT in this collection from the blockchain"
            >
              {collectionRefresh.isRefreshing ? (
                <ArrowsClockwiseIcon size={14} className={styles['token__action--spinning']} />
              ) : (
                <StackIcon size={14} />
              )}
              {collectionRefresh.isRefreshing ? collectionRefreshLabel(collectionRefresh.progress) : 'Refresh collection'}
            </button>
          </div>
        </DetailSection>
      </div>

      {sellOpen && (
        <SellNftModal
          chainId={chain}
          token={{ collection, tokenId, isLsp8 }}
          onListed={() => {
            setSellOpen(false)
            handleTraded()
          }}
          onClose={() => setSellOpen(false)}
        />
      )}

      {sendOpen && (
        <SendNftModal
          nft={{
            id: `${chain}:${collection.toLowerCase()}:${tokenId}`,
            chainId: chain,
            address: collection,
            // The transfer takes the padded form for both standards — LSP8 sends it as bytes32,
            // ERC721 widens the same value back to uint256
            tokenId: normalizeTokenId(tokenId),
            name,
            collection: collectionLabel,
            label,
            image: metadata.image || null,
            isLsp8,
          }}
          owner={owner.owner}
          onSent={() => {
            setSendOpen(false)
            handleTraded()
          }}
          onClose={() => setSendOpen(false)}
        />
      )}

      {offerOpen && (
        <OfferModal
          chainId={chain}
          collection={collection}
          tokenId={tokenId}
          isLsp8={isLsp8}
          assetName={name}
          ownerAddress={owner.owner}
          onClose={() => {
            setOfferOpen(false)
            market.refresh()
          }}
        />
      )}
    </section>
  )
}
