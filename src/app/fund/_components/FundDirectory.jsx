'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWRInfinite from 'swr/infinite'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { CONTRACTS, appChains } from '@/config/contracts'
import CreateFundDialog from '@/components/CreateFundDialog'
import FundCountdown from '@/components/FundCountdown'
import Profile from '@/components/Profile'
import CopyButton from '@/components/ui/CopyButton'
import EmptyState from '@/components/ui/EmptyState'
import ProgressBar from '@/components/ui/ProgressBar'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { formatBackers, formatCompactAmount, formatPercent, formatUsd, fundProgress, fundStatus, isFunded, progressTone, toRelative } from '@/lib/fund'
import { networkColorStyle } from '@/lib/networkColors'
import { CheckCircleIcon, BagIcon, MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react'
import styles from './FundDirectory.module.scss'

const PAGE_SIZE = 25

const fetcher = (url) => fetch(url).then((res) => res.json())

// Enough rows to fill the fold, so the first page arriving reflows the list rather than
// replacing an empty page with a full one
const SkeletonCard = () => (
  <li className={styles.directory__item} aria-hidden="true">
    <div className={clsx(styles.directory__card, styles.directory__skeleton)}>
      <div className={styles.directory__skeletonTop}>
        <div className="shimmer rounded-full" style={{ width: '32px', height: '32px' }} />
        <div className="shimmer rounded" style={{ width: '7rem', height: '14px' }} />
      </div>
      <div className="shimmer rounded" style={{ width: '75%', height: '18px' }} />
      <div className="shimmer rounded" style={{ width: '45%', height: '22px' }} />
      <div className="shimmer rounded" style={{ width: '100%', height: '8px' }} />
      <div className="shimmer rounded" style={{ width: '55%', height: '12px' }} />
    </div>
  </li>
)

/**
 * Fund Directory
 * The /fund index: every indexed campaign across the chains HupFund is deployed on, filtered
 * by lifecycle scope. Cards link through to the campaign page rather than taking money inline
 * — a list is for finding a campaign, and backing belongs where the ask has room to be read.
 */
export default function FundDirectory() {
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

  // Chains where the fund contract is live — drives the network filter options
  const fundChains = useMemo(() => appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.fund), [])
  const chainFor = (id) => appChains.find((chain) => chain.id === Number(id))

  const getKey = (pageIndex, previousPage) => {
    if (previousPage && !previousPage.nextPage) return null
    if ((scope === 'mine' || scope === 'created') && !address) return null
    const params = new URLSearchParams({ scope, page: String(pageIndex + 1), limit: String(PAGE_SIZE) })
    if (networkId) params.set('networkId', networkId)
    if (sort) params.set('sort', sort)
    if (address) params.set('participant', address)
    if (search) params.set('q', search)
    return `/api/v1/fund?${params}`
  }

  const { data: pages, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite(getKey, fetcher, { revalidateFirstPage: false })

  const campaigns = useMemo(() => (pages ?? []).flatMap((page) => page?.data ?? []), [pages])
  const hasMore = Boolean(pages?.[pages.length - 1]?.nextPage)

  const scopes = [
    { value: 'open', label: 'Open' },
    { value: 'funded', label: 'Funded' },
    { value: 'closed', label: 'Ended' },
    ...(address ? [{ value: 'mine', label: 'Mine' }] : []),
  ]

  const emptyCopy = {
    open: 'No campaigns are running yet — start the first one.',
    funded: 'No campaign has reached its goal yet.',
    closed: 'No campaigns have ended yet.',
    mine: "You haven't started or backed a campaign yet.",
  }

  const renderCard = (campaign) => {
    const chainInfo = chainFor(campaign.network_id)
    const status = fundStatus(campaign)
    const funded = isFunded(campaign)
    const percent = fundProgress(campaign)
    const symbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'
    const price = Number(campaign.native_usd) || null
    const backers = Number(campaign.backer_count) || 0
    const href = `/fund/${campaign.network_id}/${campaign.campaign_id}`
    const supporters = Array.isArray(campaign.recent_backers) ? campaign.recent_backers : []
    // Once the money has settled one way or the other, that is the status — a refunding
    // campaign is not "funded" whatever its number reached
    const settled = status.key === 'refunding' || status.key === 'withdrawn'

    return (
      <li key={`${campaign.network_id}-${campaign.campaign_id}`} className={styles.directory__item}>
        {/* An article with one stretched link rather than a card-shaped anchor: the copy button
            is a button, and a button nested inside a link is neither valid nor reliably
            operable by keyboard */}
        <article className={styles.directory__card} style={networkColorStyle(chainInfo)}>
          <div className={styles.directory__cardTop}>
            <Profile variant="fullWithoutTime" creator={campaign.wallet_address} networkId={campaign.network_id} className={styles.directory__creator} />

            <div className={styles.directory__cardTopRight}>
              {campaign.viewer_backed && (
                <span className={styles.directory__backed}>
                  <CheckCircleIcon size={12} weight="fill" aria-hidden="true" />
                  You backed
                </span>
              )}
              <span className={clsx(styles.directory__badge, styles[`directory__badge--${settled ? status.key : funded ? 'funded' : status.key}`])}>
                {settled ? status.label : funded ? 'Funded' : status.label}
              </span>
              <span className={styles.directory__network}>{chainInfo?.name || `#${campaign.network_id}`}</span>
            </div>
          </div>

          <h3 className={styles.directory__title}>
            <Link href={href} className={styles.directory__titleLink}>
              {campaign.title || `Campaign #${campaign.campaign_id}`}
            </Link>
          </h3>

          {campaign.description && <p className={styles.directory__description}>{campaign.description}</p>}

          <div className={styles.directory__amounts}>
            <span className={styles.directory__raised}>{formatUsd(campaign.raised, price) ?? formatCompactAmount(campaign.raised, symbol)}</span>
            <span className={styles.directory__goal}>of {formatUsd(campaign.goal, price) ?? formatCompactAmount(campaign.goal, symbol)}</span>
          </div>

          <ProgressBar
            className={styles.directory__bar}
            percent={Math.min(percent, 100)}
            height={6}
            gradient={false}
            color={status.key === 'refunding' ? 'var(--text-muted, #888)' : `var(--fund-${progressTone(percent)})`}
            animated={status.key === 'open' && !funded}
            ariaLabel={`${formatPercent(percent)} of the goal raised`}
            label={<span className={styles.directory__percent}>{formatPercent(percent)}</span>}
            hint={
              <span className={styles.directory__meta}>
                {status.key === 'open' ? <FundCountdown closesAt={campaign.closes_at} /> : status.key === 'closed' ? `Ended ${toRelative(Number(campaign.closed_at) > 0 ? campaign.closed_at : campaign.closes_at)}` : status.label}
              </span>
            }
          />

          <div className={styles.directory__foot}>
            {backers > 0 ? (
              <div className={styles.directory__backers}>
                {supporters.length > 0 && (
                  <div className={styles.directory__faces}>
                    {supporters.map((backer) => (
                      <Profile key={backer} variant="imageOnly" size={26} creator={backer} networkId={campaign.network_id} className={styles.directory__face} />
                    ))}
                  </div>
                )}
                <span className={styles.directory__backersText}>
                  <strong>{formatBackers(backers)}</strong> {backers === 1 ? 'backer' : 'backers'}
                </span>
              </div>
            ) : (
              <span className={styles.directory__meta}>No backers yet</span>
            )}

            <CopyButton
              className={styles.directory__copy}
              value={href}
              title="Copy campaign link"
              copiedTitle="Link copied"
              toastMessage="Campaign link copied"
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
          <SegmentedControl options={scopes} value={scope} onChange={setScope} label="Campaign scope" as="tabs" size="sm" />

          <button type="button" className={styles.directory__createButton} onClick={() => dialogRef.current?.open()}>
            <PlusIcon size={14} weight="bold" />
            New fundraise
          </button>
        </div>

        <div className={styles.directory__toolbarRow}>
          <div className={styles.directory__search}>
            <MagnifyingGlassIcon size={14} />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search fundraisers"
              aria-label="Search fundraisers"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {fundChains.length > 1 && (
            <select className={styles.directory__select} value={networkId} onChange={(e) => setNetworkId(e.target.value)} aria-label="Filter by network">
              <option value="">All networks</option>
              {fundChains.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
          )}

          <select className={styles.directory__select} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort fundraisers">
            <option value="">Default</option>
            <option value="closing">Ending soonest</option>
            <option value="raised">Most raised</option>
            <option value="backers">Most backers</option>
            <option value="recent">Newest</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <ul className={styles.directory__list}>
          {Array.from({ length: 3 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </ul>
      )}

      {!isLoading && campaigns.length === 0 && (
        <EmptyState
          icon={BagIcon}
          align="center"
          size="lg"
          className={styles.directory__empty}
          action={
            !search && scope !== 'closed' ? (
              <button type="button" className={styles.directory__createButton} onClick={() => dialogRef.current?.open()}>
                <PlusIcon size={14} weight="bold" />
                Start a fundraise
              </button>
            ) : undefined
          }
        >
          {search ? `No fundraisers match “${search}”.` : emptyCopy[scope]}
        </EmptyState>
      )}

      {campaigns.length > 0 && <ul className={styles.directory__list}>{campaigns.map((campaign) => renderCard(campaign))}</ul>}

      {hasMore && (
        <button type="button" className={styles.directory__loadMore} onClick={() => setSize(size + 1)} disabled={isValidating}>
          {isValidating ? 'Loading...' : 'Load more'}
        </button>
      )}

      <CreateFundDialog ref={dialogRef} onCreated={() => mutate()} />
    </div>
  )
}
