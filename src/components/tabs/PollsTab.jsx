'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import useSWRInfinite from 'swr/infinite'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { appChains } from '@/config/contracts'
import { formatVotes, pollOptions, pollStatus, toRelative } from '@/lib/polls'
import NoData from '../NoData'
import { ArrowRightIcon } from '@phosphor-icons/react'
import styles from './PollsTab.module.scss'

const PAGE_SIZE = 20

const fetcher = (url) => fetch(url).then((res) => res.json())

const shortWallet = (wallet) => (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : '')

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
                <Link href={`/polls/${poll.network_id}/${poll.poll_id}`} className={styles.pollsTab__card}>
                  <div className={styles.pollsTab__top}>
                    <span className={styles.pollsTab__author}>{poll.display_name || shortWallet(poll.wallet_address)}</span>
                    {hasVoted && <span className={styles.pollsTab__voted}>You voted</span>}
                    <span className={styles.pollsTab__network}>{chainName(poll.network_id)}</span>
                  </div>

                  <h3 className={styles.pollsTab__question}>{poll.question || `Poll #${poll.poll_id}`}</h3>

                  <p className={styles.pollsTab__meta}>
                    <span>
                      {formatVotes(poll.total_votes)} {Number(poll.total_votes) === 1 ? 'vote' : 'votes'}
                    </span>
                    <span>{options.length} options</span>
                    {status.key === 'open' && <span>closes {toRelative(poll.closes_at)}</span>}
                  </p>
                </Link>
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
