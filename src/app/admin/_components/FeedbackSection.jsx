'use client'

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import Profile from '@/components/Profile'
import { PageLoader, Spinner } from '@/components/Loading'
import { isWalletAddress } from '@/lib/address'
import { formatRelativeTime } from '@/lib/collectionAuditFormat'
import styles from '../page.module.scss'

const countFormat = new Intl.NumberFormat('en')

// The inquiry types the /help form offers; anything else falls back to its raw slug
const CATEGORY_LABELS = {
  feedback: 'Feedback',
  bug: 'Bug',
  general: 'General',
  indexing: 'Indexing',
  transaction: 'Transaction',
  app_listing: 'App listing',
}

const categoryLabel = (category) => CATEGORY_LABELS[category] ?? category

/**
 * What people sent through /help — feedback first among them. Tickets hold emails and private
 * messages, so every read carries the admin pass.
 * @param {{ adminFetch: (url: string) => Promise<any> }} props
 */
export default function FeedbackSection({ adminFetch }) {
  const [category, setCategory] = useState('all')
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const read = useCallback(
    (page = 1) =>
      adminFetch(`/api/v1/admin/feedback?category=${encodeURIComponent(category)}&page=${page}`)
        .then((data) => {
          setState((prev) => (page === 1 ? data : { ...data, tickets: [...(prev?.tickets ?? []), ...data.tickets] }))
          setError(null)
        })
        .catch((err) => setError(err.message)),
    [adminFetch, category],
  )

  useEffect(() => {
    read().finally(() => setLoading(false))
  }, [read])

  const pick = (value) => {
    if (value === category) return
    setLoading(true)
    setCategory(value)
  }

  const loadMore = () => {
    setLoadingMore(true)
    read(state.nextPage).finally(() => setLoadingMore(false))
  }

  const total = state?.categories.reduce((sum, row) => sum + row.total, 0) ?? 0
  const open = state?.categories.reduce((sum, row) => sum + row.open, 0) ?? 0
  const feedback = state?.categories.find((row) => row.category === 'feedback')

  const tiles = [
    { label: 'Tickets', value: total, hint: 'Everything sent through /help' },
    { label: 'Open', value: open, hint: 'Not yet closed' },
    { label: 'Feedback', value: feedback?.total ?? 0, hint: 'Feedback / Suggestion' },
  ]

  return (
    <section className={styles['admin-contracts__section']}>
      <header className={styles['admin-contracts__header']}>
        <h2 className={styles['admin-contracts__title']}>Feedback</h2>
        <p className={styles['admin-contracts__subtitle']}>
          What people sent from the help page: feedback, bug reports, app listing requests and support questions. These rows
          can include emails, so only the admin pass can read them.
        </p>
        {error && (
          <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>{error}</div>
        )}
      </header>

      {loading && !state ? (
        <PageLoader />
      ) : state ? (
        <>
          <div className={styles['admin-contracts__stats']}>
            {tiles.map((tile) => (
              <div key={tile.label} className={styles['admin-contracts__stat']}>
                <span className={styles['admin-contracts__stat-value']}>{countFormat.format(tile.value)}</span>
                <span className={styles['admin-contracts__stat-label']}>{tile.label}</span>
                <span className={styles['admin-contracts__stat-hint']}>{tile.hint}</span>
              </div>
            ))}
          </div>

          <div className={styles['admin-contracts__filters']}>
            {[{ category: 'all', total }, ...state.categories].map((row) => (
              <button
                key={row.category}
                type="button"
                onClick={() => pick(row.category)}
                className={clsx(styles['admin-contracts__chip'], {
                  [styles['admin-contracts__chip--active']]: category === row.category,
                })}
              >
                {row.category === 'all' ? 'All' : categoryLabel(row.category)} · {countFormat.format(row.total)}
              </button>
            ))}
          </div>

          <div className={styles['admin-contracts__card']}>
            <div className={styles['admin-contracts__card-header']}>
              <h3 className={styles['admin-contracts__card-title']}>Latest</h3>
              {loading && <Spinner />}
            </div>

            {state.tickets.length === 0 ? (
              <p className={styles['admin-contracts__empty']}>Nothing here yet.</p>
            ) : (
              <ul className={styles['admin-contracts__list']}>
                {state.tickets.map((ticket) => (
                  <li key={ticket.id} className={clsx(styles['admin-contracts__list-row'], styles['admin-contracts__list-row--stacked'])}>
                    <div className={styles['admin-contracts__entry-head']}>
                      {isWalletAddress(ticket.wallet_address) ? (
                        <Profile creator={ticket.wallet_address} variant="fullWithoutTime" size={32} hoverCard={false} />
                      ) : (
                        <span className={styles['admin-contracts__detail-label']}>Guest</span>
                      )}
                      <span className={styles['admin-contracts__badge']}>{categoryLabel(ticket.category)}</span>
                      <span
                        className={clsx(styles['admin-contracts__badge'], {
                          [styles['admin-contracts__badge--override']]: ticket.status !== 'open',
                        })}
                      >
                        {ticket.status}
                      </span>
                      <span className={styles['admin-contracts__detail-label']} title={ticket.created_at ?? undefined}>
                        #{ticket.id} · {formatRelativeTime(ticket.created_at) ?? '—'}
                      </span>
                    </div>
                    <strong className={styles['admin-contracts__entry-title']}>{ticket.subject}</strong>
                    <p className={styles['admin-contracts__entry-body']}>{ticket.message}</p>
                    {ticket.email && (
                      <a className={styles['admin-contracts__detail-label']} href={`mailto:${ticket.email}`}>
                        {ticket.email}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {state.nextPage && (
            <div className={styles['admin-contracts__actions']}>
              <button
                type="button"
                className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      ) : null}
    </section>
  )
}
