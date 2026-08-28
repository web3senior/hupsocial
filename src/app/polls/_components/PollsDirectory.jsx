'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWRInfinite from 'swr/infinite'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { CONTRACTS, appChains } from '@/config/contracts'
import CreatePollDialog from '@/components/CreatePollDialog'
import { formatShare, formatVotes, pollOptions, pollStatus, requirementChips, toRelative } from '@/lib/polls'
import PollTimer from '@/components/PollTimer'
import Profile from '@/components/Profile'
import CopyButton from '@/components/ui/CopyButton'
import ProgressBar from '@/components/ui/ProgressBar'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { CheckCircleIcon, ListChecksIcon, MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react'
import styles from './PollsDirectory.module.scss'

const PAGE_SIZE = 25

const fetcher = (url) => fetch(url).then((res) => res.json())

// Enough rows to fill the fold, so the first page arriving reflows the list rather than
// replacing an empty page with a full one
const SkeletonCard = () => (
  <li className={styles.directory__item} aria-hidden="true">
    <div className={clsx(styles.directory__card, styles.directory__skeleton)}>
      {/* Same shape a loaded card holds — a 36px creator avatar, the question, its window bar,
          the voter faces and the meta line — so the first page lands without the list jumping */}
      <div className={styles.directory__skeletonTop}>
        <div className="shimmer rounded-full" style={{ width: '36px', height: '36px' }} />
        <div className="shimmer rounded" style={{ width: '7rem', height: '14px' }} />
      </div>
      <div className="shimmer rounded" style={{ width: '80%', height: '16px' }} />
      <div className="shimmer rounded" style={{ width: '100%', height: '4px' }} />
      <div className={styles.directory__voters}>
        <div className={styles.directory__faces}>
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className={clsx('shimmer rounded-full', styles.directory__face)} style={{ width: '26px', height: '26px' }} />
          ))}
        </div>
        <div className="shimmer rounded" style={{ width: '4rem', height: '12px' }} />
      </div>
      <div className="shimmer rounded" style={{ width: '55%', height: '12px' }} />
    </div>
  </li>
)

/**
 * Polls Directory
 * The /polls index: every indexed poll across the chains HupPolls is deployed on, filtered by
 * lifecycle scope. Cards link through to the poll page rather than accepting a ballot inline —
 * a list is for finding a poll, and voting belongs where the question has room to be read.
 */
export default function PollsDirectory() {
  const dialogRef = useRef(null)
  const { address } = useConnection()
  const [scope, setScope] = useState('open')
  const [networkId, setNetworkId] = useState('')
  const [sort, setSort] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  // Debounce the query so SWR refetches settle instead of firing per keystroke
  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(timeout)
  }, [searchInput])

  // Chains where the polls contract is live — drives the network filter options
  const pollChains = useMemo(() => appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.polls), [])
  const chainName = (id) => appChains.find((chain) => chain.id === Number(id))?.name || `#${id}`

  const getKey = (pageIndex, previousPage) => {
    if (previousPage && !previousPage.nextPage) return null
    if (scope === 'mine' && !address) return null
    const params = new URLSearchParams({ scope, page: String(pageIndex + 1), limit: String(PAGE_SIZE) })
    if (networkId) params.set('networkId', networkId)
    if (sort) params.set('sort', sort)
    if (address) params.set('participant', address)
    if (search) params.set('q', search)
    return `/api/v1/polls?${params}`
  }

  const {
    data: pages,
    isLoading,
    isValidating,
    size,
    setSize,
    mutate,
  } = useSWRInfinite(getKey, fetcher, { revalidateFirstPage: false })

  const polls = useMemo(() => (pages ?? []).flatMap((page) => page?.data ?? []), [pages])
  const hasMore = Boolean(pages?.[pages.length - 1]?.nextPage)

  const scopes = [
    { value: 'open', label: 'Open' },
    { value: 'upcoming', label: 'Upcoming' },
    { value: 'closed', label: 'Closed' },
    ...(address ? [{ value: 'mine', label: 'Mine' }] : []),
  ]

  const emptyCopy = {
    open: 'No open polls yet — be the first to ask something.',
    upcoming: 'No upcoming polls scheduled.',
    closed: 'No polls have closed yet.',
    mine: "You haven't created or voted on any polls yet.",
  }

  const renderCard = (poll) => {
    const status = pollStatus(poll)
    const options = pollOptions(poll)
    // The leader is only shown once a poll is closed: revealing it on a live poll would
    // steer the very votes the card is reporting
    const leader = status.key === 'closed' ? options.find((option) => option.isLeader) : null
    const hasVoted = poll.viewer_option !== null && poll.viewer_option !== undefined
    const chips = requirementChips(poll, appChains.find((chain) => chain.id === Number(poll.network_id))?.nativeCurrency?.symbol)
    const href = `/polls/${poll.network_id}/${poll.poll_id}`
    const votes = Number(poll.total_votes) || 0
    // The last few wallets to answer. Who voted is not the same fact as what they voted for —
    // the choice stays behind the same gate the tallies do, and never reaches this list.
    const voters = Array.isArray(poll.recent_voters) ? poll.recent_voters : []

    return (
      <li key={`${poll.network_id}-${poll.poll_id}`} className={styles.directory__item}>
        {/* An article with one stretched link rather than a card-shaped anchor: the copy
            button is a button, and a button nested inside a link is neither valid nor
            reliably operable by keyboard */}
        <article className={styles.directory__card}>
          <div className={styles.directory__cardTop}>
            {/* The one way a wallet is rendered anywhere in the app — avatar, name, chain badge
                and hover card included, so a poll's creator reads exactly like the same person
                under a post. Raised above the stretched link so their name stays clickable. */}
            <Profile variant="fullWithoutTime" creator={poll.wallet_address} networkId={poll.network_id} className={styles.directory__creator} />

            <div className={styles.directory__cardTopRight}>
              {hasVoted && (
                <span className={styles.directory__voted}>
                  <CheckCircleIcon size={12} weight="fill" aria-hidden="true" />
                  You voted
                </span>
              )}
              <span className={clsx(styles.directory__badge, styles[`directory__badge--${status.key}`])}>{status.label}</span>
              <span className={styles.directory__network}>{chainName(poll.network_id)}</span>
            </div>
          </div>

          <h3 className={styles.directory__title}>
            <Link href={href} className={styles.directory__titleLink}>
              {poll.question || `Poll #${poll.poll_id}`}
            </Link>
          </h3>

          {/* Same chips the in-post card shows — who is shut out belongs next to the question
              wherever it is read, not only where it can be voted on */}
          {chips.length > 0 && (
            <div className={styles.directory__chips}>
              {chips.map((chip, index) => (
                <span key={index} className={clsx(styles.directory__chip, styles[`directory__chip--${chip.tone}`])}>
                  {chip.label}
                </span>
              ))}
            </div>
          )}

          {/* How much of the window is already spent, which is the thing a countdown alone
              never says: "ends in 2h" reads urgent on a poll that ran for a month and on one
              that opened this morning */}
          {status.key !== 'closed' && (
            <ProgressBar
              className={styles.directory__window}
              startsAt={status.key === 'upcoming' ? poll.opened_at : poll.opens_at}
              endsAt={status.key === 'upcoming' ? poll.opens_at : poll.closes_at}
              height={4}
              color={status.key === 'upcoming' ? 'var(--poll-upcoming)' : 'var(--poll-open)'}
              animated={status.key === 'open'}
              hint={<PollTimer opensAt={poll.opens_at} closesAt={poll.closes_at} />}
              ariaLabel="Voting window"
            />
          )}

          {/* A settled poll has a result, so the row shows it rather than a clock that stopped */}
          {leader && (
            <ProgressBar
              className={styles.directory__window}
              percent={leader.share}
              height={4}
              color="var(--poll-win)"
              gradient={false}
              label={<span className={styles.directory__winner}>Leading: {leader.label}</span>}
              hint={<span className={styles.directory__winner}>{formatShare(leader.share)}</span>}
              ariaLabel={`Leading option: ${leader.label}, ${formatShare(leader.share)}`}
            />
          )}

          {/* Who is already in, the way the connect popup shows who is already here: the last
              faces to arrive, then the count. Each face is a Profile — hover card, chain badge
              and all — so a voter reads as the same person they are under a post. */}
          {votes > 0 && (
            <div className={styles.directory__voters}>
              {voters.length > 0 && (
                <div className={styles.directory__faces}>
                  {voters.map((voter) => (
                    <Profile
                      key={voter}
                      variant="imageOnly"
                      size={26}
                      creator={voter}
                      networkId={poll.network_id}
                      className={styles.directory__face}
                    />
                  ))}
                </div>
              )}
              <span className={styles.directory__votersText}>
                <strong>{formatVotes(votes)}</strong> {votes === 1 ? 'person' : 'people'} voted
              </span>
            </div>
          )}

          <div className={styles.directory__foot}>
            <span className={styles.directory__meta}>
              {/* The count lives in the strip above once there is one, so the meta line carries
                  it only in the state the strip cannot show */}
              Asked {toRelative(poll.opened_at)}
              {votes === 0 && ' · No votes yet'} · {options.length} options
            </span>

            <CopyButton
              className={styles.directory__copy}
              value={href}
              title="Copy poll link"
              copiedTitle="Link copied"
              toastMessage="Poll link copied"
              size={13}
            />
          </div>
        </article>
      </li>
    )
  }

  return (
    <div className={styles.directory}>
      <div className={styles.directory__toolbar}>
        <div className={styles.directory__toolbarRow}>
          <SegmentedControl options={scopes} value={scope} onChange={setScope} label="Poll scope" as="tabs" size="sm" />

          <button type="button" className={styles.directory__createButton} onClick={() => dialogRef.current?.open()}>
            <PlusIcon size={14} weight="bold" />
            New poll
          </button>
        </div>

        <div className={styles.directory__toolbarRow}>
          <div className={styles.directory__search}>
            <MagnifyingGlassIcon size={14} />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search polls"
              aria-label="Search polls"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {pollChains.length > 1 && (
            <select
              className={styles.directory__select}
              value={networkId}
              onChange={(e) => setNetworkId(e.target.value)}
              aria-label="Filter by network"
            >
              <option value="">All networks</option>
              {pollChains.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
          )}

          <select className={styles.directory__select} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort polls">
            <option value="">Default</option>
            <option value="closing">Closing soonest</option>
            <option value="votes">Most votes</option>
            <option value="recent">Newest</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <ul className={styles.directory__list}>
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </ul>
      )}

      {!isLoading && polls.length === 0 && (
        <div className={styles.directory__empty}>
          <ListChecksIcon size={32} />
          <p>{search ? `No polls match “${search}”.` : emptyCopy[scope]}</p>
          {!search && scope !== 'closed' && (
            <button type="button" className={styles.directory__createButton} onClick={() => dialogRef.current?.open()}>
              <PlusIcon size={14} weight="bold" />
              Ask something
            </button>
          )}
        </div>
      )}

      {polls.length > 0 && <ul className={styles.directory__list}>{polls.map((poll) => renderCard(poll))}</ul>}

      {hasMore && (
        <button type="button" className={styles.directory__loadMore} onClick={() => setSize(size + 1)} disabled={isValidating}>
          {isValidating ? 'Loading...' : 'Load more'}
        </button>
      )}

      <CreatePollDialog ref={dialogRef} onCreated={() => mutate()} />
    </div>
  )
}
