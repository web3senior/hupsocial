'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection, usePublicClient, useWriteContract } from 'wagmi'
import { CONTRACTS, appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { formatVotes, pollOptions, pollStatus, toRelative } from '@/lib/polls'
import { shortTxError } from '@/lib/utils'
import pollsAbi from '@/abis/HupPolls.json'
import { toast } from '@/components/NextToast'
import Profile from '@/components/Profile'
import PollCard from '@/components/PollCard'
import CopyButton from '@/components/ui/CopyButton'
import { CaretLeftIcon, ListChecksIcon } from '@phosphor-icons/react'
import styles from './PollDetail.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

// The ballot card above already ticks the countdown, so the facts row carries the thing a
// countdown can't say: the wall-clock moment voting ends, in the reader's own zone
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const formatWhen = (unixSeconds) => (Number(unixSeconds) > 0 ? dateTimeFormat.format(new Date(Number(unixSeconds) * 1000)) : '—')

// A plain link rather than history.back(): a shared poll URL is usually the first page of the
// visit, and "back" from there would leave the site
const BackToPolls = () => (
  <Link href="/polls" className={styles.detail__back}>
    <CaretLeftIcon size={14} weight="bold" aria-hidden="true" />
    Back to polls
  </Link>
)

/**
 * Poll Detail
 * The /polls/[networkId]/[pollId] page. The ballot itself is the same PollCard the feed
 * renders — one voting surface, so the two can never disagree about what a poll allows —
 * and this page adds what a card has no room for: who asked, who voted, and the creator's
 * own control to end it early.
 * @param {Object} props
 * @param {string|number} props.networkId Chain the poll lives on.
 * @param {string|number} props.pollId Onchain poll id.
 */
export default function PollDetail({ networkId, pollId }) {
  const chainId = Number(networkId)
  const { address } = useConnection()
  const publicClient = usePublicClient({ chainId })
  const { writeContractAsync } = useWriteContract()
  const [isClosing, setIsClosing] = useState(false)

  const { data: detail, mutate } = useSWR(
    `/api/v1/polls/${pollId}?networkId=${chainId}${address ? `&voter=${address.toLowerCase()}` : ''}`,
    fetcher,
  )

  const poll = detail?.data?.poll
  const recentVotes = detail?.data?.recentVotes ?? []

  // The status badge and the close-early control are derived from the clock at render time,
  // so a window that ends on screen needs a re-render as well as fresh data — the refetch
  // alone would not re-render if nothing in the payload changed. One alarm at the edge rather
  // than a per-second tick: the countdown itself lives on the ballot card, and this page only
  // has to notice the single moment it runs out.
  const [, setPhaseTick] = useState(0)
  const closesAt = Number(poll?.closed_at) > 0 ? Number(poll.closed_at) : Number(poll?.closes_at) || 0

  useEffect(() => {
    const msUntilClose = closesAt * 1000 - Date.now()
    // Nothing to schedule for a poll already settled, and a window further out than a day will
    // have been refetched long before a timer that long could fire
    if (msUntilClose <= 0 || msUntilClose > 86400 * 1000) return

    const timer = setTimeout(() => {
      setPhaseTick((tick) => tick + 1)
      mutate()
    }, msUntilClose + 1000)

    return () => clearTimeout(timer)
  }, [closesAt, mutate])

  if (detail && !poll) {
    return (
      <div className={styles.detail}>
        <BackToPolls />
        <div className={styles.detail__empty}>
          <ListChecksIcon size={32} />
          <p>This poll doesn&apos;t exist on this network.</p>
        </div>
      </div>
    )
  }

  if (!poll) return <p className={styles.detail__empty}>Loading poll...</p>

  const status = pollStatus(poll)
  const options = pollOptions(poll)
  const chain = appChains.find((entry) => entry.id === chainId)
  const explorer = chain?.blockExplorers?.default?.url
  const isCreator = address && poll.wallet_address && address.toLowerCase() === poll.wallet_address.toLowerCase()
  const canCloseEarly = isCreator && status.key === 'open'
  // Mirrors the API's own gate; the client only decides what to say about it, never whether
  // the data arrives
  const canSeeResults = status.key === 'closed' || Boolean(detail?.data?.ballot)

  const closePoll = async () => {
    const pollsAddress = CONTRACTS[`chain${chainId}`]?.polls
    if (!pollsAddress || !chain) return

    setIsClosing(true)
    try {
      const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

      if (session.active) {
        const tx = await writeWithBurnerSession({
          chain,
          contractAddress: pollsAddress,
          abi: pollsAbi,
          functionName: 'closePoll',
          args: [address, BigInt(pollId)],
        })
        await tx.wait().catch(() => null)
      } else {
        await writeContractAsync({ abi: pollsAbi, address: pollsAddress, functionName: 'closePoll', args: [address, BigInt(pollId)], chainId })
      }

      toast('Voting closed — the result is final', 'success')
      mutate()
    } catch (err) {
      toast(shortTxError(err, 'Could not close the poll'), 'error')
    } finally {
      setIsClosing(false)
    }
  }

  return (
    <div className={styles.detail}>
      <BackToPolls />

      <header className={styles.detail__header}>
        {/* The creator reads exactly like the voters below — one Profile component for every
            wallet on the page, avatar hover card and chain badge included */}
        <div className={styles.detail__creator}>
          <Profile variant="fullWithoutTime" creator={poll.wallet_address} networkId={chainId} className={styles.detail__creatorProfile} />
          <small className={styles.detail__asked}>asked {toRelative(poll.opened_at)}</small>
        </div>

        <div className={styles.detail__headerActions}>
          <span className={clsx(styles.detail__badge, styles[`detail__badge--${status.key}`])}>{status.label}</span>
          {/* A poll is something people are sent, so the link to it belongs beside the status
              rather than three menus deep */}
          <CopyButton
            value={`/polls/${chainId}/${pollId}`}
            label="Copy link"
            title="Copy poll link"
            copiedTitle="Copied"
            variant="chip"
            size={13}
          />
        </div>
      </header>

      {/* The card is the ballot — the page never renders a second voting path */}
      <PollCard pollRef={{ pollId: String(pollId), chainId }} />

      {canCloseEarly && (
        <button type="button" className={styles.detail__close} onClick={closePoll} disabled={isClosing}>
          {isClosing ? 'Closing...' : 'End voting now'}
        </button>
      )}

      <dl className={styles.detail__facts}>
        <div>
          <dt>Votes</dt>
          <dd>{formatVotes(poll.total_votes)}</dd>
        </div>
        <div>
          <dt>Options</dt>
          <dd>{options.length}</dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>{chain?.name || `#${chainId}`}</dd>
        </div>
        <div>
          <dt>{status.key === 'closed' ? 'Closed' : status.key === 'upcoming' ? 'Opens' : 'Closes'}</dt>
          <dd className={styles.detail__when}>
            {formatWhen(status.key === 'upcoming' ? poll.opens_at : Number(poll.closed_at) > 0 ? poll.closed_at : poll.closes_at)}
          </dd>
        </div>
      </dl>

      <section className={styles.detail__voters}>
        <h2>Who voted</h2>
        {recentVotes.length === 0 && <p className={styles.detail__empty}>No votes yet.</p>}
        <ul>
          {recentVotes.map((vote) => (
            /* One card per voter: who on top, what beneath. An option label is user-authored
               prose, and a card gives it a full line to wrap on instead of a sliver of a row */
            <li key={`${vote.wallet_address}-${vote.voted_at}`}>
              <div className={styles.detail__voterTop}>
                {/* The same Profile every other wallet list renders — avatar, chain badge, hover
                    card and all — so a voter reads the way they do under a post or a listing */}
                <Profile variant="fullWithoutTime" creator={vote.wallet_address} networkId={chainId} className={styles.detail__voter} />
                <span className={styles.detail__voterTime}>{toRelative(vote.voted_at)}</span>
              </div>
              {/* Absent until the viewer has voted or the poll has closed — the API withholds
                  the column rather than the client hiding it */}
              {vote.option_index !== undefined && (
                <span className={styles.detail__voterChoice}>
                  {options[Number(vote.option_index)]?.label || `Option #${Number(vote.option_index) + 1}`}
                </span>
              )}
            </li>
          ))}
        </ul>

        <p className={styles.detail__note}>
          {canSeeResults
            ? 'Every ballot is public onchain — this list is what the chain already says.'
            : 'Vote to see what everyone picked.'}
        </p>
      </section>

      {explorer && (
        <a className={styles.detail__tx} href={`${explorer}/tx/${poll.tx_hash}`} target="_blank" rel="noreferrer">
          View the poll onchain
        </a>
      )}
    </div>
  )
}
