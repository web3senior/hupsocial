'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import useSWRInfinite from 'swr/infinite'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { appChains } from '@/config/contracts'
import { formatVotes, pollOptions, pollStatus } from '@/lib/polls'
import PollTimer from '@/components/PollTimer'
import Profile from '@/components/Profile'
import ProgressBar from '@/components/ui/ProgressBar'
import NoData from '../NoData'
import { ArrowRightIcon } from '@phosphor-icons/react'
import styles from './PollsTab.module.scss'

const PAGE_SIZE = 20

const fetcher = (url) => fetch(url).then((res) => res.json())

/**
 * Home feed tab for open polls across every chain HupPolls runs on, newest-closing first —
 * the ones still worth answering. Cards link into the poll page, where the ballot lives;
 * this list exists to surface polls that aren't in the viewer's timeline.
 */
export default function PollsTab() {
  const { address } = useConnection()

  const getKey = (pageIndex, previousPage) => {
    if (previousPage && !previousPage.nextPage) return null
    const params = new URLSearchParams({ scope: 'open', page: String(pageIndex + 1), limit: String(PAGE_SIZE) })
    if (address) params.set('participant', address)
    return `/api/v1/polls?${params}`
  }

  const { data: pages, isLoading, isValidating, size, setSize } = useSWRInfinite(getKey, fetcher, { revalidateFirstPage: false })

  const polls = useMemo(() => (pages ?? []).flatMap((page) => page?.data ?? []), [pages])
  const hasMore = Boolean(pages?.[pages.length - 1]?.nextPage)
  const chainName = (id) => appChains.find((chain) => chain.id === Number(id))?.name || `#${id}`

  return (
    <div className={clsx(styles.tabContent, 'relative')}>
      <div className="__container" data-width="medium">
        {isLoading && <p className={styles.pollsTab__status}>Loading polls...</p>}

        {!isLoading && polls.length === 0 && <NoData name="polls" />}

        <ul className={styles.pollsTab__list}>
          {polls.map((poll) => {
            const status = pollStatus(poll)
            const options = pollOptions(poll)
            const hasVoted = poll.viewer_option !== null && poll.viewer_option !== undefined

            return (
              <li key={`${poll.network_id}-${poll.poll_id}`}>
                {/* An article with one stretched link on the question, not a card-shaped anchor:
                    the creator's own name is a link too, and links do not nest */}
                <article className={styles.pollsTab__card}>
                  <div className={styles.pollsTab__top}>
                    {/* The same identity block a post carries — avatar, chain badge, hover card */}
                    <Profile
                      variant="fullWithoutTime"
                      creator={poll.wallet_address}
                      networkId={poll.network_id}
                      className={styles.pollsTab__creator}
                    />
                    {hasVoted && <span className={styles.pollsTab__voted}>You voted</span>}
                    <span className={styles.pollsTab__network}>{chainName(poll.network_id)}</span>
                  </div>

                  <h3 className={styles.pollsTab__question}>
                    <Link href={`/polls/${poll.network_id}/${poll.poll_id}`} className={styles.pollsTab__titleLink}>
                      {poll.question || `Poll #${poll.poll_id}`}
                    </Link>
                  </h3>

                  {/* Same window bar the directory and the ballot card show, so a poll reads the
                      same wherever it is met */}
                  {status.key !== 'closed' && (
                    <ProgressBar
                      className={styles.pollsTab__window}
                      startsAt={status.key === 'upcoming' ? poll.opened_at : poll.opens_at}
                      endsAt={status.key === 'upcoming' ? poll.opens_at : poll.closes_at}
                      height={4}
                      color={status.key === 'upcoming' ? 'var(--poll-upcoming)' : 'var(--poll-open)'}
                      animated={status.key === 'open'}
                      hint={<PollTimer opensAt={poll.opens_at} closesAt={poll.closes_at} />}
                      ariaLabel="Voting window"
                    />
                  )}

                  <p className={styles.pollsTab__meta}>
                    <span>
                      {formatVotes(poll.total_votes)} {Number(poll.total_votes) === 1 ? 'vote' : 'votes'}
                    </span>
                    <span>{options.length} options</span>
                  </p>
                </article>
              </li>
            )
          })}
        </ul>

        {hasMore && (
          <button type="button" className={styles.pollsTab__loadMore} onClick={() => setSize(size + 1)} disabled={isValidating}>
            {isValidating ? 'Loading...' : 'Load more'}
          </button>
        )}

        {polls.length > 0 && (
          <Link href="/polls" className={styles.pollsTab__all}>
            Browse every poll
            <ArrowRightIcon size={14} />
          </Link>
        )}
      </div>
    </div>
  )
}
