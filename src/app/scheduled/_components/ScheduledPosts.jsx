'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { useConnection, useSignMessage } from 'wagmi'
import {
  ArrowSquareOutIcon,
  CalendarDotsIcon,
  CheckCircleIcon,
  PaperPlaneTiltIcon,
  SpinnerIcon,
  WarningCircleIcon,
  XCircleIcon,
} from '@phosphor-icons/react'
import { useActiveChain } from '@/hooks/useActiveChain'
import { appChains } from '@/config/contracts'
import EmptyState from '@/components/ui/EmptyState'
import MediaGallery from '@/components/Gallery'
import { toast } from '@/components/NextToast'
import { renderMarkdown } from '@/lib/markdown'
import {
  cancelScheduledPost,
  clearScheduleToken,
  ensureScheduleSession,
  formatWillSend,
  listScheduledPosts,
  pokeScheduledRunner,
  readScheduleToken,
  subscribeScheduleToken,
  updateScheduledPost,
} from '@/lib/scheduledPosts'
import styles from './ScheduledPosts.module.scss'

const TABS = [
  { key: 'pending', label: 'Upcoming' },
  { key: 'history', label: 'Sent' },
]

// While a post is mid-publish the row flips on its own; poll it rather than make the author reload
const SENDING_POLL_MS = 5000

const stateOf = (row) => {
  if (row.status === 'sending') return { key: 'sending', label: 'Publishing…', Icon: SpinnerIcon }
  if (row.status === 'sent') return { key: 'sent', label: 'Sent', Icon: CheckCircleIcon }
  if (row.status === 'failed') return { key: 'failed', label: 'Failed', Icon: WarningCircleIcon }
  if (row.status === 'cancelled') return { key: 'cancelled', label: 'Cancelled', Icon: XCircleIcon }
  if (row.signed && !row.signatureStale) return { key: 'relayer', label: 'Sends on time, even while you are away', Icon: PaperPlaneTiltIcon }
  if (row.signatureStale) return { key: 'stale', label: 'Needs your signature — it goes out when you are next on Hup', Icon: WarningCircleIcon }
  return { key: 'author', label: 'Goes out when you are on Hup at that time', Icon: CalendarDotsIcon }
}

const textOf = (row) => row?.content?.elements?.[0]?.data?.text ?? ''
const mediaOf = (row) => row?.content?.elements?.[1]?.data?.items ?? []

export default function ScheduledPosts() {
  const { address, isConnected } = useConnection()
  const { chainId } = useActiveChain()
  const { signMessageAsync } = useSignMessage()
  const token = useSyncExternalStore(
    subscribeScheduleToken,
    () => readScheduleToken(address),
    () => null,
  )

  const [tab, setTab] = useState('pending')
  const [rows, setRows] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    setError(null)
    try {
      setRows(await listScheduledPosts(token, tab))
    } catch (err) {
      if (err.status === 401) clearScheduleToken(address)
      setError(err.message || 'Could not load scheduled posts')
    } finally {
      setIsLoading(false)
    }
  }, [token, tab, address])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!rows.some((row) => row.status === 'sending')) return
    const timer = window.setInterval(load, SENDING_POLL_MS)
    return () => window.clearInterval(timer)
  }, [rows, load])

  const signIn = async () => {
    try {
      await ensureScheduleSession(address, signMessageAsync, chainId)
    } catch (err) {
      toast(err.message || 'Sign-in was declined', 'error')
    }
  }

  const act = async (row, run, after) => {
    setBusyId(row.id)
    try {
      await run()
      await load()
      after?.()
    } catch (err) {
      toast(err.message || 'That did not work', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const postNow = (row) =>
    act(
      row,
      () => updateScheduledPost(token, row.id, { action: 'now' }),
      () => {
        pokeScheduledRunner()
        toast('Publishing it now…', 'info')
      },
    )
  const cancel = (row) => act(row, () => cancelScheduledPost(token, row.id))
  const remove = (row) => act(row, () => cancelScheduledPost(token, row.id, { purge: true }))

  if (!isConnected || !address) {
    return (
      <EmptyState icon={CalendarDotsIcon} align="center" size="lg">
        Connect your wallet to see your scheduled posts.
      </EmptyState>
    )
  }

  if (!token) {
    return (
      <EmptyState
        icon={CalendarDotsIcon}
        align="center"
        size="lg"
        action={
          <button type="button" className={styles.signIn} onClick={signIn}>
            Sign in
          </button>
        }
      >
        Sign once to see and manage the posts you have scheduled.
      </EmptyState>
    )
  }

  return (
    <div className={styles.container}>
      <nav className={styles.tabs} aria-label="Scheduled posts">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={clsx(styles.tabs__tab, { [styles['tabs__tab--active']]: tab === item.key })}
            aria-pressed={tab === item.key}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error && <p className={styles.error}>{error}</p>}

      {isLoading && rows.length === 0 && <p className={styles.loading}>Loading…</p>}

      {!isLoading && !error && rows.length === 0 && (
        <EmptyState icon={CalendarDotsIcon} align="center">
          {tab === 'pending' ? 'Nothing scheduled. Pick a time from the calendar in the composer.' : 'No scheduled posts have gone out yet.'}
        </EmptyState>
      )}

      <div className={styles.feed}>
        {rows.map((row) => {
          const chain = appChains.find((item) => item.id === Number(row.networkId))
          const state = stateOf(row)
          const Icon = state.Icon
          const pending = row.status === 'scheduled'
          const text = textOf(row)
          const media = mediaOf(row)
          const explorer = chain?.blockExplorers?.default?.url
          const busy = busyId === row.id

          return (
            <article key={row.id} className={styles.row}>
              <header className={styles.row__meta}>
                <span className={styles.row__chain}>{chain?.name || `Network ${row.networkId}`}</span>
                <time dateTime={new Date(row.scheduledAt * 1000).toISOString()}>
                  {row.status === 'sent' && row.sentAt ? `Sent ${formatWillSend(row.sentAt)}` : `Will send on ${formatWillSend(row.scheduledAt)}`}
                </time>
              </header>

              {text && <div className={styles.row__text} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />}
              {media.length > 0 && (
                <div className={styles.row__media}>
                  <MediaGallery data={media} />
                </div>
              )}

              <footer className={styles.row__footer}>
                <span className={clsx(styles.row__state, styles[`row__state--${state.key}`])}>
                  <Icon size={16} />
                  {state.label}
                </span>

                <div className={styles.row__actions}>
                  {pending && (
                    <button type="button" onClick={() => postNow(row)} disabled={busy}>
                      Post now
                    </button>
                  )}
                  {pending && (
                    <button type="button" className={styles['row__action--danger']} onClick={() => cancel(row)} disabled={busy}>
                      Cancel
                    </button>
                  )}
                  {row.txHash && explorer && (
                    <a href={`${explorer.replace(/\/+$/, '')}/tx/${row.txHash}`} target="_blank" rel="noreferrer">
                      Transaction <ArrowSquareOutIcon size={14} />
                    </a>
                  )}
                  {!pending && row.status !== 'sending' && (
                    <button type="button" onClick={() => remove(row)} disabled={busy}>
                      Remove
                    </button>
                  )}
                </div>
              </footer>

              {row.signatureStale && row.lastError && <p className={styles.row__error}>{row.lastError}</p>}
            </article>
          )
        })}
      </div>
    </div>
  )
}
