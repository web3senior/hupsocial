'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWRInfinite from 'swr/infinite'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { CONTRACTS, appChains } from '@/config/contracts'
import Profile from '@/components/Profile'
import EmptyState from '@/components/ui/EmptyState'
import SegmentedControl from '@/components/ui/SegmentedControl'
import StatusBadge from '@/components/ui/StatusBadge'
import { TASK_CATEGORIES, categoryLabel, formatTokenAmount, slotsLeft, taskHref, taskStatus, toRelative } from '@/lib/task'
import { networkColorStyle } from '@/lib/networkColors'
import { LockSimpleIcon, RobotIcon, ToolboxIcon } from '@phosphor-icons/react'
import styles from './TasksDirectory.module.scss'

const PAGE_SIZE = 20

const fetcher = (url) => fetch(url).then((res) => res.json())

/**
 * The /tasks index: funded tasks across every chain HupTasks is live on. Cards link to the post,
 * because the post is the brief and replying to it is how anyone submits.
 */
export default function TasksDirectory() {
  const { address } = useConnection()
  const [scope, setScope] = useState('open')
  const [category, setCategory] = useState('')
  const [networkId, setNetworkId] = useState('')
  const [sort, setSort] = useState('recent')

  const taskChains = useMemo(() => appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.tasks), [])
  const chainFor = (id) => appChains.find((chain) => chain.id === Number(id))

  const getKey = (pageIndex, previousPage) => {
    if (previousPage && !previousPage.hasMore) return null
    if ((scope === 'posted' || scope === 'earned') && !address) return null
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageIndex * PAGE_SIZE), sort })
    params.set('status', scope === 'posted' || scope === 'earned' ? 'all' : scope)
    if (scope === 'posted') params.set('poster', address)
    if (scope === 'earned') params.set('worker', address)
    if (category) params.set('category', category)
    if (networkId) params.set('networkId', networkId)
    return `/api/v1/tasks?${params}`
  }

  const { data: pages, isLoading, size, setSize } = useSWRInfinite(getKey, fetcher, { revalidateFirstPage: false })
  const tasks = useMemo(() => (pages ?? []).flatMap((page) => page?.data ?? []), [pages])
  const hasMore = Boolean(pages?.[pages.length - 1]?.hasMore)

  const scopes = [
    { value: 'open', label: 'Open' },
    { value: 'review', label: 'In review' },
    { value: 'done', label: 'Done' },
    ...(address
      ? [
          { value: 'posted', label: 'Posted' },
          { value: 'earned', label: 'Earned' },
        ]
      : []),
  ]

  return (
    <section className={styles.directory}>
      <header className={styles.directory__header}>
        <div>
          <h2 className={styles.directory__title}>Tasks</h2>
          <p className={styles.directory__lead}>
            Micro bounties on posts. Reply to a task to submit, and get paid onchain when the poster approves it.
          </p>
        </div>
        <Link href="/agents" className={styles.directory__agents}>
          <RobotIcon size={14} weight="fill" /> For agents
        </Link>
      </header>

      <div className={styles.directory__toolbar}>
        <SegmentedControl options={scopes} value={scope} onChange={setScope} label="Task scope" as="tabs" size="sm" />
        <div className={styles.directory__filters}>
          {taskChains.length > 1 && (
            <select value={networkId} onChange={(e) => setNetworkId(e.target.value)} aria-label="Network">
              <option value="">All networks</option>
              {taskChains.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
          )}
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="recent">Newest</option>
            <option value="deadline">Closing soon</option>
            <option value="reward">Most slots left</option>
          </select>
        </div>
      </div>

      <div className={styles.directory__chips}>
        <button type="button" className={clsx(styles.directory__chip, !category && styles['directory__chip--active'])} onClick={() => setCategory('')}>
          All
        </button>
        {TASK_CATEGORIES.map((entry) => (
          <button
            key={entry.slug}
            type="button"
            className={clsx(styles.directory__chip, category === entry.slug && styles['directory__chip--active'])}
            onClick={() => setCategory(entry.slug)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {!isLoading && tasks.length === 0 && (
        <EmptyState icon={ToolboxIcon} align="center" size="lg">
          {scope === 'earned' ? "You haven't been paid for a task yet." : scope === 'posted' ? "You haven't posted a task yet." : 'No tasks here yet. Add one to a post from the composer.'}
        </EmptyState>
      )}

      <ul className={styles.directory__list}>
        {tasks.map((task) => {
          const chainInfo = chainFor(task.network_id)
          const status = taskStatus(task)
          const symbol = task.token_symbol || chainInfo?.nativeCurrency?.symbol || ''
          return (
            <li key={`${task.network_id}-${task.post_id}`} className={styles.directory__item}>
              <article className={styles.directory__card} style={networkColorStyle(chainInfo)}>
                <div className={styles.directory__cardTop}>
                  <Profile variant="fullWithoutTime" creator={task.wallet_address} networkId={task.network_id} />
                  <div className={styles.directory__badges}>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    <span className={styles.directory__network}>{chainInfo?.name || `#${task.network_id}`}</span>
                  </div>
                </div>

                <Link href={taskHref(task.network_id, task.post_id)} className={styles.directory__link}>
                  <span className={styles.directory__kind}>
                    <ToolboxIcon size={14} weight="fill" /> {categoryLabel(task.category)}
                    {Number(task.is_sealed) === 1 && (
                      <>
                        {' '}
                        · <LockSimpleIcon size={12} /> sealed
                      </>
                    )}
                  </span>
                  {task.post_text && <p className={styles.directory__text}>{task.post_text}</p>}
                </Link>

                <div className={styles.directory__money}>
                  <strong>{formatTokenAmount(task.reward_per_slot, task.token_decimals, symbol)}</strong>
                  <span>
                    per reply · {slotsLeft(task)} of {task.slots} left · {Number(task.comment_count) || 0}{' '}
                    {Number(task.comment_count) === 1 ? 'reply' : 'replies'}
                  </span>
                </div>

                <span className={styles.directory__meta}>
                  {status.key === 'open' ? `Closes ${toRelative(task.deadline)}` : status.key === 'reviewing' ? `Closed ${toRelative(task.deadline)}` : status.label}
                </span>
              </article>
            </li>
          )
        })}
      </ul>

      {hasMore && (
        <button type="button" className={styles.directory__more} onClick={() => setSize(size + 1)}>
          Load more
        </button>
      )}
    </section>
  )
}
