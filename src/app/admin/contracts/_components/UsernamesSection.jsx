'use client'

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import Profile from '@/components/Profile'
import { ContentSpinner } from '@/components/Loading'
import { profileFallbackFromRow } from '@/hooks/useProfile'
import { formatRelativeTime } from '@/lib/collectionAuditFormat'
import styles from '../page.module.scss'

const countFormat = new Intl.NumberFormat('en')
const percentFormat = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 })

/**
 * How many wallets have taken a handle. Handles are offchain, so this is one count across every
 * chain rather than a card per network.
 */
export default function UsernamesSection() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const read = useCallback(
    () =>
      fetch('/api/v1/admin/usernames', { cache: 'no-store' })
        .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
        .then(({ ok, json }) => {
          if (!ok || !json.success) throw new Error(json.error || 'Could not read username stats')
          setStats(json.data)
          setError(null)
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false)),
    [],
  )

  const refresh = () => {
    setLoading(true)
    setError(null)
    read()
  }

  // The first read rides the initial loading state; a focus re-read is silent
  useEffect(() => {
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [read])

  const share = stats?.users ? stats.claimed / stats.users : 0
  const tiles = stats?.migrated
    ? [
        {
          label: 'Handles claimed',
          value: stats.claimed,
          hint: `${percentFormat.format(share)} of ${countFormat.format(stats.users)} users`,
        },
        { label: 'Last 24 hours', value: stats.recent.day, hint: 'Claims and changes' },
        { label: 'Last 7 days', value: stats.recent.week, hint: 'Claims and changes' },
        { label: 'Last 30 days', value: stats.recent.month, hint: 'Claims and changes' },
        { label: 'Released, still locked', value: stats.locked, hint: `Held back for ${stats.lockDays} days` },
      ]
    : []

  return (
    <section className={styles['admin-contracts__section']}>
      <header className={styles['admin-contracts__header']}>
        <h2 className={styles['admin-contracts__title']}>Usernames</h2>
        <p className={styles['admin-contracts__subtitle']}>
          Wallets that have claimed a Hup handle. Handles live in the database, not onchain, so this is one tally across every
          chain. A change re-stamps the same clock as a claim, so the recent figures count both.
        </p>
        {error && (
          <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>{error}</div>
        )}
      </header>

      {loading && !stats ? (
        <ContentSpinner />
      ) : stats && !stats.migrated ? (
        <p className={styles['admin-contracts__empty']}>
          This database has no username columns yet. Run <code>cidex/scripts/add-usernames.sql</code> first.
        </p>
      ) : stats ? (
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

          <div className={styles['admin-contracts__card']}>
            <div className={styles['admin-contracts__card-header']}>
              <h3 className={styles['admin-contracts__card-title']}>Latest claims</h3>
              <span className={styles['admin-contracts__badge']}>{stats.latest.length}</span>
            </div>

            {stats.latest.length === 0 ? (
              <p className={styles['admin-contracts__empty']}>Nobody has claimed a handle yet.</p>
            ) : (
              <ul className={styles['admin-contracts__list']}>
                {stats.latest.map((row) => (
                  <li key={row.wallet_address} className={styles['admin-contracts__list-row']}>
                    <Profile creator={row.wallet_address} variant="fullWithoutTime" size={32} hoverCard={false} fallback={profileFallbackFromRow(row)} />
                    <span className={styles['admin-contracts__detail-label']} title={row.at ?? undefined}>
                      {formatRelativeTime(row.at) ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}

      <div className={styles['admin-contracts__actions']}>
        <button
          type="button"
          className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
          onClick={refresh}
          disabled={loading}
        >
          {loading ? 'Reading…' : 'Refresh'}
        </button>
      </div>
    </section>
  )
}
