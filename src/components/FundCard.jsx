'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { appChains } from '@/config/contracts'
import {
  formatBackers,
  formatCompactAmount,
  formatPercent,
  formatUsd,
  fundProgress,
  fundStatus,
  isFunded,
  progressTone,
  refundableFor,
} from '@/lib/fund'
import { usePendingBacking, withPendingBacking } from '@/lib/fundTracking'
import { networkColorStyle } from '@/lib/networkColors'
import BackFundModal from '@/components/BackFundModal'
import FundCountdown from '@/components/FundCountdown'
import Profile from '@/components/Profile'
import ProgressBar from '@/components/ui/ProgressBar'
import { ArrowUUpLeftIcon, CheckCircleIcon, BagIcon } from '@phosphor-icons/react'
import styles from './FundCard.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

/**
 * Fund Card
 * Compact fundraising campaign rendered inside posts. The content JSON only carries a
 * reference ({ campaignId, chainId }); the campaign itself is resolved live from the indexed
 * API so the raised figure, the clock and the backer count stay current wherever the post is
 * shown. Backing happens here; withdrawing, refunding and claiming belong to the campaign
 * page, which the card links to when they apply.
 * @param {Object} props
 * @param {Object} props.fundRef Reference payload from the post's content JSON.
 */
export default function FundCard({ fundRef }) {
  const chainId = Number(fundRef?.chainId)
  const campaignId = fundRef?.campaignId

  const { address } = useConnection()
  const [showBackModal, setShowBackModal] = useState(false)
  // The card's status is derived from the clock at render time, so a window that ends on
  // screen needs a re-render as well as fresh data
  const [, setPhaseTick] = useState(0)

  const key =
    chainId && campaignId ? `/api/v1/fund/${campaignId}?networkId=${chainId}${address ? `&backer=${address.toLowerCase()}` : ''}` : null
  const { data: detail, mutate } = useSWR(key, fetcher)

  const held = usePendingBacking(chainId, campaignId)
  const indexed = detail?.data?.campaign
  // The backing the viewer just sent is added on top until the indexer publishes it, so the
  // figure never blinks back to what it said before they pressed the button
  const campaign = useMemo(() => withPendingBacking(indexed, held), [indexed, held])
  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === chainId), [chainId])

  if (!campaign) return null

  // A moderator's `hidden` flag is a display decision, never a change to the money — the
  // contract keeps holding and returning it. Say so plainly rather than rendering nothing.
  if (Number(campaign.hidden) === 1) {
    return <p className={styles.fundCard__hidden}>This campaign was hidden by a moderator. Its money is still onchain.</p>
  }

  const status = fundStatus(campaign)
  const percent = fundProgress(campaign)
  const funded = isFunded(campaign)
  const symbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'
  const price = Number(campaign.native_usd) || null
  const raisedUsd = formatUsd(campaign.raised, price)
  const goalUsd = formatUsd(campaign.goal, price)
  const backers = Number(campaign.backer_count) || 0
  const viewerBacked = detail?.data?.viewerBacked ?? campaign.viewer_backed
  const viewerRefundable = refundableFor(viewerBacked, detail?.data?.viewerRefunded ?? campaign.viewer_refunded)
  const href = `/fund/${chainId}/${campaignId}`
  // "Funded" only decorates a campaign whose money is still in play — a refunding one is
  // refunding, whatever its number reached
  const badgeLabel = status.key === 'refunding' || status.key === 'withdrawn' ? status.label : funded ? 'Funded' : status.label
  const badgeKey = status.key === 'refunding' || status.key === 'withdrawn' ? status.key : funded ? 'funded' : status.key

  const refreshPhase = () => {
    setPhaseTick((tick) => tick + 1)
    mutate()
  }

  return (
    <section className={styles.fundCard} style={networkColorStyle(chainInfo)} onClick={(e) => e.stopPropagation()}>
      <div className={styles.fundCard__head}>
        <h3 className={styles.fundCard__title}>
          <Link href={href}>{campaign.title || `Campaign #${campaignId}`}</Link>
        </h3>
        <span className={clsx(styles.fundCard__badge, styles[`fundCard__badge--${badgeKey}`])}>{badgeLabel}</span>
      </div>

      {campaign.description && <p className={styles.fundCard__description}>{campaign.description}</p>}

      {/* The money line leads: what has been raised, against what was asked for. Dollars when
          the chain has a price, the coin figure underneath either way — a backer sends coin. */}
      <div className={styles.fundCard__amounts}>
        <span className={styles.fundCard__raised}>{raisedUsd ?? formatCompactAmount(campaign.raised, symbol)}</span>
        <span className={styles.fundCard__goal}>
          of {goalUsd ?? formatCompactAmount(campaign.goal, symbol)} goal
          {raisedUsd && ` · ${formatCompactAmount(campaign.raised, symbol)}`}
        </span>
      </div>

      <ProgressBar
        className={styles.fundCard__bar}
        percent={Math.min(percent, 100)}
        height={8}
        gradient={false}
        color={status.key === 'refunding' ? 'var(--text-muted, #888)' : `var(--fund-${progressTone(percent)})`}
        animated={status.key === 'open' && !funded}
        ariaLabel={`${formatPercent(percent)} of the goal raised`}
        label={<span className={styles.fundCard__percent}>{formatPercent(percent)}</span>}
        hint={
          <span className={styles.fundCard__meta}>
            {status.key === 'open' ? <FundCountdown closesAt={campaign.closes_at} onClose={refreshPhase} /> : status.label}
          </span>
        }
      />

      <div className={styles.fundCard__foot}>
        {backers > 0 ? (
          <div className={styles.fundCard__backers}>
            {Array.isArray(campaign.recent_backers) && campaign.recent_backers.length > 0 && (
              <div className={styles.fundCard__faces}>
                {campaign.recent_backers.map((backer) => (
                  <Profile key={backer} variant="imageOnly" size={24} creator={backer} networkId={chainId} className={styles.fundCard__face} />
                ))}
              </div>
            )}
            <span>
              <strong>{formatBackers(backers)}</strong> {backers === 1 ? 'backer' : 'backers'}
            </span>
          </div>
        ) : (
          <span className={styles.fundCard__meta}>No backers yet</span>
        )}

        {status.key === 'open' && (
          <button type="button" className={styles.fundCard__back} onClick={() => setShowBackModal(true)}>
            <BagIcon size={15} weight="fill" />
            Back this
          </button>
        )}

        {/* The claim itself lives on the campaign page, where the amount and the reason have
            room — the card only says the money is waiting */}
        {status.key === 'refunding' && viewerRefundable > 0n && (
          <Link href={href} className={styles.fundCard__back}>
            <ArrowUUpLeftIcon size={15} weight="bold" />
            Claim your refund
          </Link>
        )}
      </div>

      {viewerBacked && status.key !== 'refunding' && (
        <p className={styles.fundCard__yours}>
          <CheckCircleIcon size={13} weight="fill" />
          You backed {formatUsd(viewerBacked, price) ?? formatCompactAmount(viewerBacked, symbol)}
        </p>
      )}

      {showBackModal && <BackFundModal campaign={campaign} firstTime={!viewerBacked} onClose={() => setShowBackModal(false)} />}
    </section>
  )
}
