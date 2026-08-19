'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ArrowClockwiseIcon, ArrowUpIcon, CubeIcon, ListDashesIcon, PulseIcon, SpinnerIcon } from '@phosphor-icons/react'
import ActivityBlock, { BlockGap } from './ActivityBlock'
import ActivityTape from './ActivityTape'
import { TABS, groupIntoBlocks, skippedBlocksBetween } from './activityModel'
import styles from './ActivityStream.module.scss'

const PAGE_SIZE = 30
// Long enough that an idle tab is not polling the union query every few seconds, short enough
// that the page feels live while somebody watches it.
const REFRESH_MS = 45_000
// Below this scroll depth new blocks are simply prepended; past it they would yank the reading
// position, so the pill offers the jump instead.
const PILL_SCROLL_THRESHOLD = 220

const VIEWS = [
  { id: 'blocks', label: 'Blocks', icon: CubeIcon },
  { id: 'tape', label: 'Tape', icon: ListDashesIcon },
]

const tabById = (id) => TABS.find((tab) => tab.id === id) || TABS[0]

// Rows are keyed by uid, which is unique per source row, so a cursor landing on a shared
// timestamp can repeat a row without it ever rendering twice. `kept` wins any uid collision;
// the merged list is re-sorted because a page always spans several sources.
const mergeRows = (kept, added) => {
  const seen = new Set(kept.map((row) => row.uid))
  return [...kept, ...added.filter((row) => !seen.has(row.uid))].sort((a, b) => b.ts - a.ts)
}

export default function ActivityStream() {
  const [tab, setTab] = useState(TABS[0].id)
  const [view, setView] = useState(VIEWS[0].id)
  const [rows, setRows] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPaging, setIsPaging] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)
  // uids that arrived on a poll rather than the first page — only these animate in.
  const [newUids, setNewUids] = useState(() => new Set())
  const [pendingCount, setPendingCount] = useState(0)

  // The tab the on-screen rows belong to — a poll that lands after a tab switch must not merge
  // its rows into the new tab's list.
  const appliedTab = useRef(tab)
  // Mirror of `rows` for the merge path, which has to diff against what is on screen without
  // reading state inside a setState updater. Synced after paint — a merge only ever runs from a
  // timer or a click, long after the rows it compares against were rendered.
  const rowsRef = useRef([])

  const load = useCallback(
    async ({ tabId, cursor = null, mode = 'replace', signal } = {}) => {
      const active = tabById(tabId)

      if (mode === 'append') setIsPaging(true)
      else if (mode === 'merge') setIsRefreshing(true)
      else setIsLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
        if (active.kinds) params.set('kinds', active.kinds.join(','))
        if (cursor) params.set('before', String(cursor))

        const response = await fetch(`/api/v1/activity?${params}`, { signal })
        const payload = await response.json()

        if (!response.ok || !payload.success) throw new Error(payload.error || 'Failed to fetch activity')

        if (mode === 'append') {
          setRows((current) => mergeRows(current, payload.data))
          setNextCursor(payload.nextCursor)
        } else if (mode === 'merge') {
          // What counts as new is read from the ref, never from inside the state updater: React
          // may call an updater twice, and counting arrivals in there double-counts the pill.
          const known = new Set(rowsRef.current.map((row) => row.uid))
          const arrived = payload.data.filter((row) => !known.has(row.uid))

          if (arrived.length) {
            setNewUids(new Set(arrived.map((row) => row.uid)))
            if (window.scrollY > PILL_SCROLL_THRESHOLD) setPendingCount((count) => count + arrived.length)
          }

          // The cursor stays put: merging only adds rows above what is already loaded.
          setRows((current) => mergeRows(payload.data, current))
        } else {
          setRows(payload.data)
          setNextCursor(payload.nextCursor)
          setNewUids(new Set())
          setPendingCount(0)
        }

        appliedTab.current = tabId
      } catch (err) {
        if (err.name === 'AbortError') return
        console.error('Activity fetch error:', err)
        setError('Could not load activity.')
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false)
          setIsPaging(false)
          setIsRefreshing(false)
        }
      }
    },
    [],
  )

  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  useEffect(() => {
    const controller = new AbortController()
    // Deferred by a tick so the fetch's own setState lands outside the effect body. The previous
    // tab's rows are never cleared here — the skeleton covers them until the new page replaces
    // them, so a tab switch has no empty frame.
    const timer = setTimeout(() => load({ tabId: tab, signal: controller.signal }), 0)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [tab, load])

  // Poll the newest page while the tab is visible and merge anything new in above the fold.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (appliedTab.current !== tab) return
      load({ tabId: tab, mode: 'merge' })
    }, REFRESH_MS)

    return () => clearInterval(timer)
  }, [tab, load])

  // The arrival animation plays once. Clearing the flags after it finishes keeps a later re-render
  // (a profile resolving, a preview landing) from replaying it.
  useEffect(() => {
    if (newUids.size === 0) return

    const timer = setTimeout(() => setNewUids(new Set()), 2600)
    return () => clearTimeout(timer)
  }, [newUids])

  const blocks = useMemo(() => (view === 'blocks' ? groupIntoBlocks(rows) : []), [rows, view])
  const active = tabById(tab)

  const jumpToNewest = () => {
    setPendingCount(0)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <section className={styles.stream}>
      <header className={styles.stream__header}>
        <div className={styles.stream__tabs} role="tablist" aria-label="Activity filters">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === tab}
              className={clsx(styles.stream__tab, item.id === tab && styles['stream__tab--active'])}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className={styles.stream__views} role="group" aria-label="Layout">
          {VIEWS.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.id === view}
                aria-label={item.label}
                title={item.label}
                className={clsx(styles.stream__view, item.id === view && styles['stream__view--active'])}
                onClick={() => setView(item.id)}
              >
                <Icon size={15} weight={item.id === view ? 'fill' : 'regular'} />
              </button>
            )
          })}
        </div>

        <button
          type="button"
          className={styles.stream__refresh}
          onClick={() => load({ tabId: tab, mode: 'merge' })}
          disabled={isRefreshing || isLoading}
          aria-label="Refresh activity"
        >
          <ArrowClockwiseIcon size={16} className={clsx(isRefreshing && styles.stream__spin)} />
        </button>
      </header>

      {pendingCount > 0 && (
        <button type="button" className={styles.stream__pill} onClick={jumpToNewest}>
          <ArrowUpIcon size={13} weight="bold" />
          {pendingCount} new {pendingCount === 1 ? 'action' : 'actions'}
        </button>
      )}

      {isLoading ? (
        <ul className={styles.stream__skeleton}>
          {Array.from({ length: 8 }).map((_, index) => (
            <li key={index} />
          ))}
        </ul>
      ) : error ? (
        <div className={styles.stream__state}>
          <p>{error}</p>
          <button type="button" onClick={() => load({ tabId: tab })}>
            Try again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className={styles.stream__state}>
          <PulseIcon size={28} />
          <p>{active.empty}</p>
        </div>
      ) : (
        <>
          <div className={styles.stream__body}>
            {view === 'blocks' ? (
              <div className={styles.stream__chain}>
                {blocks.map((block, index) => {
                  const skipped = skippedBlocksBetween(blocks[index - 1], block)

                  return (
                    <Fragment key={block.key}>
                      {skipped > 0 && <BlockGap skipped={skipped} networkId={block.networkId} />}
                      <ActivityBlock block={block} isNew={block.rows.some((row) => newUids.has(row.uid))} />
                    </Fragment>
                  )
                })}
              </div>
            ) : (
              <ActivityTape rows={rows} newUids={newUids} />
            )}
          </div>

          {nextCursor && (
            <button
              type="button"
              className={styles.stream__more}
              onClick={() => load({ tabId: tab, cursor: nextCursor, mode: 'append' })}
              disabled={isPaging}
            >
              {isPaging ? <SpinnerIcon size={16} className={styles.stream__spin} /> : 'Load more'}
            </button>
          )}
        </>
      )}
    </section>
  )
}
