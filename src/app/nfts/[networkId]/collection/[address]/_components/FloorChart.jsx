'use client'

import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { formatUnits } from 'viem'
import { CaretDownIcon, CaretUpIcon, MinusIcon } from '@phosphor-icons/react'
import { getNftCollectionHistory } from '@/lib/api'
import { formatStake } from '@/hooks/useStakeToken'
import EmptyState from '@/components/ui/EmptyState'
import styles from './FloorChart.module.scss'

const RANGES = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
]

const DEFAULT_RANGE = 30
const HEIGHT = 160
// Room above and below the extremes so a peak never sits flush against the edge
const PAD_Y = 6

const dayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 })
const percent = new Intl.NumberFormat(undefined, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 1 })

// Day keys arrive as UTC 'YYYY-MM-DD'; parsing them at local midnight keeps the calendar date
// the server bucketed on instead of sliding it a day west
const formatDay = (date) => dayFormatter.format(new Date(`${date}T00:00:00`))

/**
 * Floor Chart
 * The collection's cheapest listing on Hup, day by day, drawn as one thin line and nothing
 * else. Hovering (or touching) the line reads that day into the headline instead of a tooltip.
 *
 * Days when nobody was selling have no floor at all and break the line rather than dropping it
 * to zero (see lib/nftFloorHistory).
 * @param {Object} props
 * @param {number} props.chainId Chain the collection lives on.
 * @param {string} props.collection Collection contract address, lowercased.
 * @param {Object} [props.chainInfo] Entry from appChains — supplies the native currency's
 * symbol and decimals, which store_tokens does not always carry a row for.
 */
export default function FloorChart({ chainId, collection, chainInfo }) {
  const [days, setDays] = useState(DEFAULT_RANGE)
  const [history, setHistory] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasFailed, setHasFailed] = useState(false)
  const [hoverIndex, setHoverIndex] = useState(null)
  const [width, setWidth] = useState(0)
  // State, not a ref: the plot box only mounts once the data has loaded, so the observer has
  // to attach when the node arrives rather than once on mount
  const [plotNode, setPlotNode] = useState(null)

  useLayoutEffect(() => {
    if (!plotNode) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(plotNode)
    return () => observer.disconnect()
  }, [plotNode])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      try {
        const res = await getNftCollectionHistory(chainId, collection, days)
        if (cancelled) return
        setHistory(res.data || null)
        setHasFailed(false)
      } catch {
        if (cancelled) return
        setHistory(null)
        setHasFailed(true)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()

    return () => {
      cancelled = true
    }
  }, [chainId, collection, days])

  const isNative = !history?.payment_token || history.payment_token === '0x0000000000000000000000000000000000000000'
  const decimals = history?.decimals ?? (isNative ? chainInfo?.nativeCurrency?.decimals : undefined)
  const symbol = history?.symbol || (isNative ? chainInfo?.nativeCurrency?.symbol : '') || ''

  const series = useMemo(() => {
    if (!history?.points?.length || decimals === undefined) return []

    const toNumber = (value) => Number(formatUnits(BigInt(value), decimals))
    const salesByDate = new Map((history.sales || []).map((sale) => [sale.date, sale]))

    return history.points.map((point) => {
      const sale = salesByDate.get(point.date)
      return {
        date: point.date,
        raw: point.floor,
        floor: point.floor === null ? null : toNumber(point.floor),
        sale: sale ? toNumber(sale.avg) : null,
        saleCount: sale?.count ?? 0,
      }
    })
  }, [history, decimals])

  const quoted = useMemo(() => series.filter((point) => point.floor !== null), [series])
  const firstQuoted = quoted[0]
  const lastQuotedIndex = useMemo(() => series.reduce((last, point, index) => (point.floor === null ? last : index), -1), [series])
  // A single priced day is a price, not a trend — there is no line to draw through one point
  const hasTrend = quoted.length >= 2

  const geometry = useMemo(() => {
    if (!hasTrend || width === 0) return null

    const values = quoted.map((point) => point.floor)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || Math.abs(max) || 1
    const step = series.length > 1 ? width / (series.length - 1) : 0

    const x = (index) => index * step
    const y = (value) => HEIGHT - PAD_Y - ((value - min) / span) * (HEIGHT - PAD_Y * 2)

    // One M per run of quoted days, so a gap in the order book stays a gap in the line
    let path = ''
    let open = false
    series.forEach((point, index) => {
      if (point.floor === null) {
        open = false
        return
      }
      path += `${open ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.floor).toFixed(1)}`
      open = true
    })

    return { path, x, y, step, min, max }
  }, [hasTrend, width, series, quoted])

  const handlePointerMove = (event) => {
    if (!geometry) return
    const rect = event.currentTarget.getBoundingClientRect()
    const index = Math.round((event.clientX - rect.left) / geometry.step)
    setHoverIndex(Math.max(0, Math.min(series.length - 1, index)))
  }

  const hovered = hoverIndex === null ? null : series[hoverIndex]
  // The headline follows the pointer: the hovered day when there is one, the latest priced
  // day otherwise. The change is always measured from the range's first priced day.
  const shown = hovered ?? (lastQuotedIndex >= 0 ? series[lastQuotedIndex] : null)
  const change = shown?.floor !== null && shown?.floor !== undefined && firstQuoted?.floor ? ((shown.floor - firstQuoted.floor) / firstQuoted.floor) * 100 : null
  const hasChange = change !== null
  // Flat is its own outcome — an up caret over "0%" claims a direction the number denies
  const direction = !hasChange || Math.abs(change) < 0.05 ? 'flat' : change > 0 ? 'up' : 'down'
  const Caret = direction === 'up' ? CaretUpIcon : direction === 'down' ? CaretDownIcon : MinusIcon

  // Window-bounded like everything else here, so its absence on 7d is information rather than
  // a gap: nothing traded that week
  const lastSale = history?.last_sale

  if (hasFailed) return null

  return (
    <section className={styles.chart} aria-label="Floor price history">
      <header className={styles.chart__header}>
        <div className={styles.chart__headline}>
          <h3 className={styles.chart__title}>Floor price</h3>
          {/* This app's order book, not the collection's floor across every marketplace it
              trades on — saying so plainly beats letting the number overclaim */}
          <p className={styles.chart__scope}>Cheapest listing on Hup</p>

          {(hasTrend || lastSale) && (
            <p className={styles.chart__summary}>
              {hasTrend && shown && (
                <>
                  <span className={styles.chart__current}>
                    {shown.floor === null ? 'No listings' : `${formatStake(shown.raw, decimals)} ${symbol}`}
                  </span>
                  {hasChange && (
                    <span className={clsx(styles.chart__delta, styles[`chart__delta--${direction}`])}>
                      <Caret size={12} weight="bold" aria-hidden="true" />
                      {percent.format(change / 100)}
                    </span>
                  )}
                  <span className={styles.chart__date}>
                    {formatDay(shown.date)}
                    {shown.saleCount > 0 &&
                      (shown.saleCount > 1
                        ? ` · ${shown.saleCount} sales, avg ${compact.format(shown.sale)} ${symbol}`
                        : ` · sold ${compact.format(shown.sale)} ${symbol}`)}
                  </span>
                </>
              )}

              {/* Rendered on its own condition, so a collection whose listings have all aged
                  out still gets to say what it last traded for */}
              {lastSale && !hovered &&
                (lastSale.listing_id ? (
                  <Link href={`/nfts/${chainId}/${lastSale.listing_id}`} className={clsx(styles.chart__lastSale, styles['chart__lastSale--link'])}>
                    Last sale
                    <strong>
                      {formatStake(lastSale.price, decimals)} {symbol}
                    </strong>
                    <small>{formatDay(lastSale.date)}</small>
                  </Link>
                ) : (
                  <span className={styles.chart__lastSale}>
                    Last sale
                    <strong>
                      {formatStake(lastSale.price, decimals)} {symbol}
                    </strong>
                    <small>{formatDay(lastSale.date)}</small>
                  </span>
                ))}
            </p>
          )}
        </div>

        <div className={styles.chart__ranges} role="group" aria-label="Time range">
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              className={clsx(styles.chart__range, days === range.days && styles['chart__range--active'])}
              aria-pressed={days === range.days}
              onClick={() => {
                setDays(range.days)
                setHoverIndex(null)
              }}
            >
              {range.label}
            </button>
          ))}
        </div>
      </header>

      {!hasTrend ? (
        <EmptyState align="center" size="sm" className={styles.chart__empty}>
          {isLoading ? 'Loading floor history…' : `Nothing was listed on enough days in the last ${days} days to chart a floor.`}
        </EmptyState>
      ) : (
        /* Refetching a new range dims the existing render instead of swapping in a skeleton,
           so the card never jumps */
        <div
          ref={setPlotNode}
          className={clsx(styles.chart__plot, isLoading && styles['chart__plot--refreshing'])}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {geometry && (
            <svg
              className={styles.chart__svg}
              width={width}
              height={HEIGHT}
              viewBox={`0 0 ${width} ${HEIGHT}`}
              role="img"
              aria-label={`Floor over ${days} days, from ${compact.format(firstQuoted.floor)} to ${compact.format(series[lastQuotedIndex].floor)} ${symbol}, low ${compact.format(geometry.min)}, high ${compact.format(geometry.max)}`}
            >
              <path className={styles.chart__line} d={geometry.path} />

              {hovered && (
                <g className={styles.chart__cursor}>
                  <line x1={geometry.x(hoverIndex)} x2={geometry.x(hoverIndex)} y1={0} y2={HEIGHT} />
                  {hovered.floor !== null && <circle cx={geometry.x(hoverIndex)} cy={geometry.y(hovered.floor)} r={4} />}
                </g>
              )}
            </svg>
          )}
        </div>
      )}
    </section>
  )
}
