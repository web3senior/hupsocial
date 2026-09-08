'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection, useSwitchChain, useWriteContract } from 'wagmi'
import { CONTRACTS, appChains } from '@/config/contracts'
import { config } from '@/config/wagmi'
import {
  canForceRefunds,
  canWithdrawFund,
  decodeMemo,
  formatAmount,
  formatBackers,
  formatCompactAmount,
  formatPercent,
  formatUsd,
  fundEndedAt,
  fundFaq,
  fundProgress,
  fundStatus,
  heldAmount,
  isFunded,
  progressTone,
  refundableFor,
  toRelative,
  toWei,
} from '@/lib/fund'
import { trackFundTx, usePendingBacking, withPendingBacking } from '@/lib/fundTracking'
import { networkColorStyle } from '@/lib/networkColors'
import { shortAddress } from '@/lib/address'
import { shortTxError } from '@/lib/utils'
import fundAbi from '@/abis/HupFund.json'
import { toast } from '@/components/NextToast'
import BackFundModal from '@/components/BackFundModal'
import FundCountdown from '@/components/FundCountdown'
import Profile from '@/components/Profile'
import CopyButton from '@/components/ui/CopyButton'
import DetailSection from '@/components/ui/DetailSection'
import EmptyState from '@/components/ui/EmptyState'
import ProgressBar from '@/components/ui/ProgressBar'
import { ArrowUUpLeftIcon, CaretLeftIcon, CheckCircleIcon, BagIcon } from '@phosphor-icons/react'
import styles from './FundDetail.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

// The hero already ticks the countdown, so the facts row carries the thing a countdown can't
// say: the wall-clock moment backing ends, in the reader's own zone
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const formatWhen = (unixSeconds) => (Number(unixSeconds) > 0 ? dateTimeFormat.format(new Date(Number(unixSeconds) * 1000)) : '—')

// A plain link rather than history.back(): a shared campaign URL is usually the first page of
// the visit, and "back" from there would leave the site
const BackToFund = () => (
  <Link href="/fund" className={styles.detail__back}>
    <CaretLeftIcon size={14} weight="bold" aria-hidden="true" />
    All fundraisers
  </Link>
)

/**
 * Fund Detail
 * The /fund/[networkId]/[campaignId] page: the countdown and the goal at the top, then who is
 * backing it and what the creator has answered. Backing goes through the same BackFundModal
 * the in-post card opens — one payment surface, so the two can never disagree about what a
 * campaign accepts. The money's second half lives only here: the creator withdraws the pot or
 * opens refunds, and a backer claims theirs back.
 * @param {Object} props
 * @param {string|number} props.networkId Chain the campaign lives on.
 * @param {string|number} props.campaignId Onchain campaign id.
 */
export default function FundDetail({ networkId, campaignId }) {
  const chainId = Number(networkId)
  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })
  const { writeContractAsync } = useWriteContract()
  const [busyAction, setBusyAction] = useState(null)
  const [confirmRefund, setConfirmRefund] = useState(false)
  const [showBackModal, setShowBackModal] = useState(false)
  const [extraBackings, setExtraBackings] = useState([])
  const [extraHasMore, setExtraHasMore] = useState(null)
  const [isLoadingBackings, setIsLoadingBackings] = useState(false)

  const { data: detail, mutate } = useSWR(
    `/api/v1/fund/${campaignId}?networkId=${chainId}${address ? `&backer=${address.toLowerCase()}` : ''}`,
    fetcher,
  )

  const held = usePendingBacking(chainId, campaignId)
  const indexed = detail?.data?.campaign
  const campaign = useMemo(() => withPendingBacking(indexed, held), [indexed, held])
  const chainInfo = useMemo(() => appChains.find((entry) => entry.id === chainId), [chainId])

  const firstPage = detail?.data?.backings ?? []
  // The first page rides SWR and stays fresh; pages the viewer asked for are appended from
  // state. A transaction log position is unique, so it dedupes the seam between a revalidated
  // first page and older appended ones.
  const seen = new Set()
  const backings = [...firstPage, ...extraBackings].filter((entry) => {
    const key = `${entry.tx_hash}-${entry.backed_at}-${entry.wallet_address}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const hasMoreBackings = extraHasMore ?? Boolean(detail?.data?.hasMoreBackings)

  // The status and the money controls are derived from the clock at render time, so a window
  // that ends on screen needs a re-render as well as fresh data. One alarm at the edge rather
  // than a per-second tick: the countdown itself owns the ticking.
  const [, setPhaseTick] = useState(0)
  const closesAt = Number(campaign?.closed_at) > 0 ? Number(campaign.closed_at) : Number(campaign?.closes_at) || 0

  useEffect(() => {
    const msUntilClose = closesAt * 1000 - Date.now()
    // Nothing to schedule for a campaign already ended, and a window further out than a day
    // will have been refetched long before a timer that long could fire
    if (msUntilClose <= 0 || msUntilClose > 86400 * 1000) return

    const timer = setTimeout(() => {
      setPhaseTick((tick) => tick + 1)
      mutate()
    }, msUntilClose + 1000)

    return () => clearTimeout(timer)
  }, [closesAt, mutate])

  if (detail && !campaign) {
    return (
      <div className={styles.detail}>
        <BackToFund />
        <EmptyState icon={BagIcon} align="center" size="lg">
          This campaign doesn&apos;t exist on this network.
        </EmptyState>
      </div>
    )
  }

  if (!campaign) return <p className={styles.detail__loading}>Loading campaign...</p>

  const status = fundStatus(campaign)
  const percent = fundProgress(campaign)
  const funded = isFunded(campaign)
  const settled = status.key === 'refunding' || status.key === 'withdrawn'
  const symbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'
  const price = Number(campaign.native_usd) || null
  const explorer = chainInfo?.blockExplorers?.default?.url
  const fundAddress = CONTRACTS[`chain${chainId}`]?.fund
  const isCreator = address && campaign.wallet_address && address.toLowerCase() === campaign.wallet_address.toLowerCase()
  const backers = Number(campaign.backer_count) || 0
  const viewerBacked = detail?.data?.viewerBacked
  const viewerRefundable = refundableFor(viewerBacked, detail?.data?.viewerRefunded)
  const faq = fundFaq(campaign)
  const canWithdraw = isCreator && canWithdrawFund(campaign)
  const canSwitchToRefunds = isCreator && !settled
  const canClaim = status.key === 'refunding' && viewerRefundable > 0n
  const canForce = !isCreator && canForceRefunds(campaign)
  const money = (wei) => formatUsd(wei, price) ?? formatAmount(wei, symbol)

  /**
   * Sends one campaign transaction from the connected wallet and hands the wait to the tracker.
   * The button unlocks on the hash; the toast carries the verdict. Every write goes through
   * here so the wrong-chain check and the error copy live in one place.
   */
  const sendTx = async (action, functionName, args, copy) => {
    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (!fundAddress) {
      toast("Fundraising isn't available on this network", 'error')
      return
    }

    setBusyAction(action)
    try {
      if (walletChain && walletChain.id !== chainId) {
        await switchChain.mutateAsync({ chainId })
      }
      const hash = await writeContractAsync({ abi: fundAbi, address: fundAddress, functionName, args, chainId })
      trackFundTx({ chainId, campaignId, hash, ...copy })
      setConfirmRefund(false)
    } catch (err) {
      toast(shortTxError(err, copy.failure), 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const closeCampaign = () =>
    sendTx('close', 'closeCampaign', [BigInt(campaignId)], {
      pending: 'Ending backing…',
      success: 'Backing has ended — the pot is yours to withdraw or refund',
      failure: 'Could not end the campaign',
    })

  const withdraw = () =>
    sendTx('withdraw', 'withdraw', [BigInt(campaignId)], {
      pending: `Withdrawing ${formatAmount(campaign.raised, symbol)}…`,
      success: 'The pot has been paid out to your payout address',
      failure: 'Withdrawal failed — check the payout address can receive',
    })

  const enableRefunds = () =>
    sendTx('refund', 'enableRefunds', [BigInt(campaignId)], {
      pending: 'Opening refunds…',
      success: 'Refunds are open — every backer can now claim theirs back',
      failure: 'Could not open refunds',
    })

  const claimRefund = () =>
    sendTx('claim', 'claimRefund', [BigInt(campaignId)], {
      pending: `Claiming ${formatAmount(viewerRefundable, symbol)}…`,
      success: 'Your backing is back in your wallet',
      failure: 'Refund claim failed',
    })

  const loadMoreBackings = async () => {
    setIsLoadingBackings(true)
    try {
      // Offset by what is on screen, not by pages fetched: a revalidated first page may have
      // shifted the list, and the dedupe above absorbs any overlap this causes
      const res = await fetch(
        `/api/v1/fund/${campaignId}?networkId=${chainId}${address ? `&backer=${address.toLowerCase()}` : ''}&backingsOffset=${backings.length}`,
      )
      const page = await res.json()
      if (!Array.isArray(page?.data?.backings)) throw new Error('Bad response')
      setExtraBackings((prev) => [...prev, ...page.data.backings])
      setExtraHasMore(Boolean(page.data.hasMoreBackings))
    } catch {
      toast('Could not load more backers', 'error')
    } finally {
      setIsLoadingBackings(false)
    }
  }

  const badgeKey = settled ? status.key : funded ? 'funded' : status.key
  const badgeLabel = settled ? status.label : funded ? 'Funded' : status.label

  return (
    <div className={styles.detail} style={networkColorStyle(chainInfo)}>
      <BackToFund />

      <header className={styles.detail__header}>
        <div className={styles.detail__creator}>
          {/* The one way a wallet is rendered anywhere in the app — avatar, name, chain badge
              and hover card included */}
          <Profile variant="fullWithoutTime" creator={campaign.wallet_address} networkId={chainId} className={styles.detail__creatorProfile} />
          <small className={styles.detail__started}>started {toRelative(campaign.opened_at)}</small>
        </div>

        <div className={styles.detail__headerActions}>
          <span className={clsx(styles.detail__badge, styles[`detail__badge--${badgeKey}`])}>{badgeLabel}</span>
          <CopyButton
            value={`/fund/${chainId}/${campaignId}`}
            label="Copy link"
            title="Copy campaign link"
            copiedTitle="Copied"
            variant="chip"
            size={13}
          />
        </div>
      </header>

      <h1 className={styles.detail__title}>{campaign.title || `Campaign #${campaignId}`}</h1>

      {/* The clock is the hero while backing runs. Once the money has settled, the same box
          says how — that is the fact a returning backer came for. */}
      <section className={styles.detail__clock}>
        {status.key === 'open' && (
          <>
            <p className={styles.detail__clockLabel}>Backing closes in</p>
            <FundCountdown closesAt={closesAt} big onClose={() => mutate()} />
          </>
        )}
        {status.key === 'closed' && (
          <>
            <p className={styles.detail__clockLabel}>Backing has ended</p>
            <p className={styles.detail__clockNote}>
              {formatAmount(heldAmount(campaign), symbol)} is held by the contract until the creator withdraws it or opens refunds.
            </p>
          </>
        )}
        {status.key === 'withdrawn' && (
          <>
            <p className={styles.detail__clockLabel}>Paid out</p>
            <p className={styles.detail__clockNote}>
              {money(campaign.withdrawn_amount)} went to the payout address on {formatWhen(campaign.withdrawn_at)}.
            </p>
          </>
        )}
        {status.key === 'refunding' && (
          <>
            <p className={styles.detail__clockLabel}>Refunds are open</p>
            <p className={styles.detail__clockNote}>
              Every backer can take their money back in full. {money(campaign.refunded)} of {money(campaign.raised)} has been claimed so far.
            </p>
          </>
        )}
      </section>

      <section className={styles.detail__money}>
        <div className={styles.detail__amounts}>
          <span className={styles.detail__raised}>{formatUsd(campaign.raised, price) ?? formatCompactAmount(campaign.raised, symbol)}</span>
          <span className={styles.detail__goal}>
            of {formatUsd(campaign.goal, price) ?? formatCompactAmount(campaign.goal, symbol)} goal
            {price && ` · ${formatAmount(campaign.raised, symbol)} raised`}
          </span>
        </div>

        <ProgressBar
          percent={Math.min(percent, 100)}
          height={10}
          gradient={false}
          color={status.key === 'refunding' ? 'var(--text-muted, #888)' : `var(--fund-${progressTone(percent)})`}
          animated={status.key === 'open' && !funded}
          ariaLabel={`${formatPercent(percent)} of the goal raised`}
          label={<span className={styles.detail__percent}>{formatPercent(percent)}</span>}
          hint={
            <span className={styles.detail__meta}>
              {formatBackers(backers)} {backers === 1 ? 'backer' : 'backers'}
            </span>
          }
        />

        <div className={styles.detail__actions}>
          {status.key === 'open' && !isCreator && (
            <button type="button" className={styles.detail__backButton} onClick={() => setShowBackModal(true)}>
              <BagIcon size={17} weight="fill" />
              Back this campaign
            </button>
          )}

          {canClaim && (
            <button type="button" className={styles.detail__backButton} onClick={claimRefund} disabled={busyAction !== null}>
              <ArrowUUpLeftIcon size={17} weight="bold" />
              {busyAction === 'claim' ? 'Claiming…' : `Claim my ${money(viewerRefundable)} back`}
            </button>
          )}

          {viewerBacked && !canClaim && (
            <p className={styles.detail__yours}>
              <CheckCircleIcon size={14} weight="fill" />
              {status.key === 'refunding' && toWei(viewerBacked) > 0n
                ? `You backed ${money(viewerBacked)} and have claimed it back`
                : `You have backed ${money(viewerBacked)}`}
            </p>
          )}

          {canWithdraw && (
            <button type="button" className={styles.detail__backButton} onClick={withdraw} disabled={busyAction !== null}>
              {busyAction === 'withdraw' ? 'Withdrawing…' : `Withdraw ${formatAmount(campaign.raised, symbol)} to ${shortAddress(campaign.payout)}`}
            </button>
          )}

          {isCreator && status.key === 'open' && (
            <button type="button" className={styles.detail__secondary} onClick={closeCampaign} disabled={busyAction !== null}>
              {busyAction === 'close' ? 'Ending…' : 'End backing now'}
            </button>
          )}

          {/* Irreversible, so it never fires on one press: the first shows what it means, the
              second does it */}
          {canSwitchToRefunds && !confirmRefund && (
            <button
              type="button"
              className={clsx(styles.detail__secondary, styles['detail__secondary--danger'])}
              onClick={() => setConfirmRefund(true)}
              disabled={busyAction !== null}
            >
              Refund everyone instead
            </button>
          )}
          {canSwitchToRefunds && confirmRefund && (
            <div className={styles.detail__confirm}>
              <p>
                This ends backing, gives up the pot for good, and lets every backer take their {symbol} back. It cannot be undone.
              </p>
              <div>
                <button type="button" className={styles.detail__secondary} onClick={() => setConfirmRefund(false)} disabled={busyAction !== null}>
                  Keep the campaign
                </button>
                <button
                  type="button"
                  className={clsx(styles.detail__secondary, styles['detail__secondary--danger'])}
                  onClick={enableRefunds}
                  disabled={busyAction !== null}
                >
                  {busyAction === 'refund' ? 'Opening refunds…' : 'Yes, refund everyone'}
                </button>
              </div>
            </div>
          )}

          {/* The safety valve: a pot nobody has claimed long after backing ended can be
              returned by anyone, so a creator who vanished cannot strand the money */}
          {canForce && (
            <>
              <p className={styles.detail__valve}>
                The creator has not withdrawn this pot since backing ended on {formatWhen(fundEndedAt(campaign))}. Anyone may now open
                refunds so backers can take their money back.
              </p>
              <button type="button" className={styles.detail__secondary} onClick={enableRefunds} disabled={busyAction !== null}>
                {busyAction === 'refund' ? 'Opening refunds…' : 'Open refunds for everyone'}
              </button>
            </>
          )}
        </div>
      </section>

      {campaign.description && (
        <section className={styles.detail__about}>
          <h2>About</h2>
          <p>{campaign.description}</p>
        </section>
      )}

      <dl className={styles.detail__facts}>
        <div>
          <dt>Raised</dt>
          <dd>{formatAmount(campaign.raised, symbol)}</dd>
        </div>
        <div>
          <dt>Goal</dt>
          <dd>{formatAmount(campaign.goal, symbol)}</dd>
        </div>
        <div>
          <dt>{status.key === 'withdrawn' ? 'Paid out' : status.key === 'refunding' ? 'Refunded' : 'Held by contract'}</dt>
          <dd>
            {formatAmount(status.key === 'withdrawn' ? campaign.withdrawn_amount : status.key === 'refunding' ? campaign.refunded : heldAmount(campaign), symbol)}
          </dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>{chainInfo?.name || `#${chainId}`}</dd>
        </div>
        <div>
          <dt>{status.key === 'open' ? 'Closes' : 'Ended'}</dt>
          <dd className={styles.detail__when}>{formatWhen(closesAt)}</dd>
        </div>
        <div>
          <dt>Payout address</dt>
          <dd className={styles.detail__when}>
            {explorer ? (
              <a href={`${explorer}/address/${campaign.payout}`} target="_blank" rel="noreferrer">
                {shortAddress(campaign.payout)}
              </a>
            ) : (
              shortAddress(campaign.payout)
            )}
          </dd>
        </div>
      </dl>

      {faq.length > 0 && (
        <section className={styles.detail__faq}>
          <h2>Questions</h2>
          <ul>
            {faq.map((entry, index) => (
              <li key={index}>
                <DetailSection title={entry.question}>
                  <p className={styles.detail__answer}>{entry.answer}</p>
                </DetailSection>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.detail__backers}>
        <h2>Backers</h2>
        {backings.length === 0 && <EmptyState size="sm">No backings yet. Be the first.</EmptyState>}
        <ul>
          {backings.map((entry) => {
            const memo = decodeMemo(entry.memo)
            return (
              <li key={`${entry.tx_hash}-${entry.wallet_address}-${entry.backed_at}`}>
                <div className={styles.detail__backerTop}>
                  <Profile variant="fullWithoutTime" creator={entry.wallet_address} networkId={chainId} className={styles.detail__backer} />
                  <span className={styles.detail__backerAmount}>{money(entry.amount)}</span>
                </div>
                {memo && <p className={styles.detail__memo}>{memo}</p>}
                <span className={styles.detail__backerTime}>{toRelative(entry.backed_at)}</span>
              </li>
            )
          })}
        </ul>

        {hasMoreBackings && (
          <button type="button" className={styles.detail__more} onClick={loadMoreBackings} disabled={isLoadingBackings}>
            {isLoadingBackings ? 'Loading...' : 'Show more backers'}
          </button>
        )}

        <p className={styles.detail__note}>
          Every backing is a public transaction — this list is what the chain already says. The contract holds the money until the
          creator withdraws it or opens refunds, and nobody else can move it.
        </p>
      </section>

      {explorer && (
        <a className={styles.detail__tx} href={`${explorer}/tx/${campaign.tx_hash}`} target="_blank" rel="noreferrer">
          View the campaign onchain
        </a>
      )}

      {showBackModal && <BackFundModal campaign={campaign} firstTime={!viewerBacked} onClose={() => setShowBackModal(false)} />}
    </div>
  )
}
