'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { Spinner } from '@/components/Loading'
import Tooltip from '@/components/ui/Tooltip'
import styles from './page.module.scss'

const LABELS = { operational: 'Operational', disrupted: 'Service disruption', unmonitored: 'Not monitored', busy: 'Busy', heavy: 'Under heavy load' }
const SUMMARIES = {
  operational: 'Monitored services are responding',
  disrupted: 'Some services are experiencing issues',
  unmonitored: 'Some services could not be checked',
  busy: 'Services are responding with elevated resource use',
  heavy: 'The server is under heavy load',
}

export default function StatusOverview() {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [request, setRequest] = useState(0)

  useEffect(() => {
    let active = true
    let controller
    let running = false
    async function refresh() {
      if (running || document.hidden) return
      running = true
      controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      if (active) setLoading(true)
      try {
        const response = await fetch('/api/status', { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('Status unavailable')
        const data = await response.json()
        if (!SUMMARIES[data.status] || !Array.isArray(data.services) || !Number.isFinite(Date.parse(data.checkedAt))) throw new Error('Invalid status')
        if (active) {
          setReport(data)
          setFailed(false)
        }
      } catch {
        if (active) setFailed(true)
      } finally {
        clearTimeout(timeout)
        running = false
        if (active) setLoading(false)
      }
    }
    refresh()
    const interval = setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
      controller?.abort()
    }
  }, [request])

  const status = failed ? 'unmonitored' : report?.status
  const updated = report ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.checkedAt)) : null

  return (
    <section className={styles.status} aria-label="Hup system status">
      <div className={clsx('__container', styles.status__container)} data-width="medium">
        <header className={styles.status__header}>
          <p className={styles.status__eyebrow}>Hup service availability</p>
          <h1 className={styles.status__title}>System status</h1>
          <p>See how Hup’s monitored services are doing right now.</p>
        </header>

        <section className={clsx(styles.status__summary, styles[`status__summary--${status || 'unmonitored'}`])} aria-live="polite" aria-atomic="true">
          <span className={clsx(styles.status__dot, styles[`status__dot--${status || 'unmonitored'}`])} aria-hidden="true" />
          <div>
            <h2>{failed ? 'Current status is unavailable' : report ? SUMMARIES[report.status] : 'Checking service availability'}</h2>
            <p>{failed ? 'We could not refresh the checks. Previous results may be out of date.' : 'Automatic checks refresh every minute while this page is open.'}</p>
          </div>
        </section>

        <div className={styles.status__toolbar}>
          <p>{updated ? <>Last checked <time dateTime={report.checkedAt}>{updated}</time></> : 'Waiting for the first check'}</p>
          <button className={styles.status__refresh} type="button" onClick={() => setRequest((value) => value + 1)} disabled={loading}>
            {loading && <Spinner size={16} />}
            {loading ? 'Checking…' : 'Refresh status'}
          </button>
        </div>

        {report && (
          <ul className={styles.status__services} aria-label={failed ? 'Previous service checks' : 'Service checks'}>
            {report.services.map((service) => (
              <li className={styles.status__service} key={service.id}>
                <div>
                  <h2>{service.name}</h2>
                  <p>{service.description}</p>
                </div>
                <Tooltip content={!failed && Number.isFinite(service.usagePercent) ? `${service.name}: ${new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(service.usagePercent / 100)} used at the last check` : null}>
                  <span tabIndex={!failed && Number.isFinite(service.usagePercent) ? 0 : undefined} className={clsx(styles.status__badge, styles[`status__badge--${failed ? 'unmonitored' : service.status}`])}>
                    <span className={clsx(styles.status__dot, styles[`status__dot--${failed ? 'unmonitored' : service.status}`])} aria-hidden="true" />
                    {failed ? 'Awaiting update' : service.id.startsWith('resource-') && service.status === 'operational' ? 'Normal' : LABELS[service.status]}
                  </span>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}

        <aside className={styles.status__note}>
          <h2>About these checks</h2>
          <p>Resource labels describe the shared server, not just Hup. Busy means CPU usage is at least 75%, or memory or disk usage is at least 85%. Heavy load starts at 90% CPU or 95% memory or disk usage. A short spike does not necessarily mean a service is unavailable.</p>
          <p>These are point-in-time availability checks, not a guarantee that every feature works. They do not test sending email, publishing posts, wallet transactions, or individual media playback.</p>
          <p>This page runs on Hup’s infrastructure and may be unavailable during a full outage. Historical uptime and incident history are not tracked here yet.</p>
          <Link href="/help">Having a problem? Visit the Help Center →</Link>
        </aside>
      </div>
    </section>
  )
}
