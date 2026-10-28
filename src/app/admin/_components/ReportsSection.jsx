'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { useConnection, useSignMessage } from 'wagmi'
import Profile from '@/components/Profile'
import { PageLoader, Spinner } from '@/components/Loading'
import { formatRelativeTime } from '@/lib/collectionAuditFormat'
import { reportDecisionMessage } from '@/lib/reports'
import styles from '../page.module.scss'

const countFormat = new Intl.NumberFormat('en')

const STATUSES = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'actioned', label: 'Accepted' },
  { id: 'dismissed', label: 'Dismissed' },
]

/**
 * Posts people have reported, and the admin's call on each. Who reported what is not public, so
 * every read carries the admin pass; accepting or dismissing is a write, so each one is its own
 * signature.
 * @param {{ adminFetch: (url: string) => Promise<any> }} props
 */
export default function ReportsSection({ adminFetch }) {
  const { address, chainId } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const [status, setStatus] = useState('all')
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)

  const read = useCallback(
    (page = 1) =>
      adminFetch(`/api/v1/admin/reports?status=${status}&page=${page}`)
        .then((data) => {
          setState((prev) => (page === 1 ? data : { ...data, reports: [...(prev?.reports ?? []), ...data.reports] }))
          setError(null)
        })
        .catch((err) => setError(err.message)),
    [adminFetch, status],
  )

  useEffect(() => {
    read().finally(() => setLoading(false))
  }, [read])

  const pick = (value) => {
    if (value === status) return
    setLoading(true)
    setStatus(value)
  }

  /** Signs and sends one decision for every report on the post. */
  const decide = async (decision, report) => {
    setBusy(`${decision}:${report.network_id}/${report.post_id}`)
    setResult(null)

    try {
      const nonceRes = await fetch('/api/v1/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: address }),
      })
      const { nonce } = await nonceRes.json()
      if (!nonce) throw new Error('Could not get a nonce')

      const networkId = Number(report.network_id)
      const postId = Number(report.post_id)
      const signature = await signMessageAsync({ message: reportDecisionMessage({ decision, networkId, postId, nonce }) })

      const res = await fetch('/api/v1/admin/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, networkId, postId, signature, nonce, chainId }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not update the reports')

      const done = decision === 'accept' ? 'Accepted, post veiled' : 'Dismissed, veil lifted'
      setResult({ ok: true, text: `${done}: post #${postId} (${countFormat.format(json.data.updated)} reports).` })
      read()
    } catch (err) {
      setResult({ ok: false, text: err.shortMessage || err.message || 'Could not update the reports' })
    } finally {
      setBusy(null)
    }
  }

  const loadMore = () => {
    setLoadingMore(true)
    read(state.nextPage).finally(() => setLoadingMore(false))
  }

  const total = state ? Object.values(state.counts).reduce((sum, value) => sum + value, 0) : 0
  const countFor = (id) => (id === 'all' ? total : (state?.counts[id] ?? 0))

  return (
    <section className={styles['admin-contracts__section']}>
      <header className={styles['admin-contracts__header']}>
        <h2 className={styles['admin-contracts__title']}>Reports</h2>
        <p className={styles['admin-contracts__subtitle']}>
          Posts people have flagged from the post menu, newest first. A report does nothing until you decide: accepting veils the
          post across the app, dismissing lifts the veil. Either one applies to every report on that post and takes one
          signature.
        </p>
        {error && (
          <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>{error}</div>
        )}
        {result && (
          <div
            className={clsx(
              styles['admin-contracts__validation'],
              result.ok ? styles['admin-contracts__validation--success'] : styles['admin-contracts__validation--error'],
            )}
          >
            {result.text}
          </div>
        )}
      </header>

      {loading && !state ? (
        <PageLoader />
      ) : state ? (
        <>
          <div className={styles['admin-contracts__stats']}>
            {STATUSES.map((entry) => (
              <div key={entry.id} className={styles['admin-contracts__stat']}>
                <span className={styles['admin-contracts__stat-value']}>{countFormat.format(countFor(entry.id))}</span>
                <span className={styles['admin-contracts__stat-label']}>{entry.id === 'all' ? 'Reports' : entry.label}</span>
              </div>
            ))}
          </div>

          <div className={styles['admin-contracts__filters']}>
            {STATUSES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => pick(entry.id)}
                className={clsx(styles['admin-contracts__chip'], {
                  [styles['admin-contracts__chip--active']]: status === entry.id,
                })}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className={styles['admin-contracts__card']}>
            <div className={styles['admin-contracts__card-header']}>
              <h3 className={styles['admin-contracts__card-title']}>Latest</h3>
              {loading && <Spinner />}
            </div>

            {state.reports.length === 0 ? (
              <p className={styles['admin-contracts__empty']}>No reports here.</p>
            ) : (
              <ul className={styles['admin-contracts__list']}>
                {state.reports.map((report) => (
                  <li key={report.id} className={clsx(styles['admin-contracts__list-row'], styles['admin-contracts__list-row--stacked'])}>
                    <div className={styles['admin-contracts__entry-head']}>
                      <span className={styles['admin-contracts__badge']}>{report.category_name ?? 'Uncategorized'}</span>
                      <span
                        className={clsx(styles['admin-contracts__badge'], {
                          [styles['admin-contracts__badge--override']]: report.status !== 'pending',
                        })}
                      >
                        {report.status === 'actioned' ? 'accepted' : report.status}
                      </span>
                      {report.post_reports > 1 && (
                        <span className={styles['admin-contracts__detail-label']}>
                          {countFormat.format(report.post_reports)} reports on this post
                        </span>
                      )}
                      <span className={styles['admin-contracts__detail-label']} title={report.created_at ?? undefined}>
                        {formatRelativeTime(report.created_at) ?? '—'}
                      </span>
                    </div>

                    {report.reason && <p className={styles['admin-contracts__entry-body']}>“{report.reason}”</p>}

                    <blockquote className={styles['admin-contracts__entry-quote']}>
                      {report.author_address && (
                        <Profile creator={report.author_address} variant="fullWithoutTime" size={24} hoverCard={false} />
                      )}
                      <p className={styles['admin-contracts__entry-body']}>
                        {report.is_deleted ? 'This post was deleted.' : report.excerpt || 'No text in this post.'}
                      </p>
                      <Link className={styles['admin-contracts__detail-label']} href={`/networks/${report.network_id}/${report.post_id}`}>
                        Open post #{report.post_id}
                      </Link>
                    </blockquote>

                    <div className={styles['admin-contracts__entry-head']}>
                      <span className={styles['admin-contracts__detail-label']}>Reported by</span>
                      <Profile creator={report.reporter_address} variant="fullWithoutTime" size={24} hoverCard={false} />
                    </div>

                    <div className={styles['admin-contracts__entry-head']}>
                      <button
                        type="button"
                        className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                        onClick={() => decide('accept', report)}
                        disabled={!address || busy !== null || report.status === 'actioned'}
                      >
                        {busy === `accept:${report.network_id}/${report.post_id}` ? 'Signing…' : 'Accept'}
                      </button>
                      <button
                        type="button"
                        className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                        onClick={() => decide('dismiss', report)}
                        disabled={!address || busy !== null || report.status === 'dismissed'}
                      >
                        {busy === `dismiss:${report.network_id}/${report.post_id}` ? 'Signing…' : 'Dismiss'}
                      </button>
                    </div>
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
