'use client'

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { formatUnits } from 'viem'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CaretDownIcon, CaretUpIcon, ChartLineIcon, MinusIcon, TableIcon } from '@phosphor-icons/react'
import { getNftCollectionHistory } from '@/lib/api'
import { formatStake } from '@/hooks/useStakeToken'
import styles from './FloorChart.module.scss'

const RANGES = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
]

const DEFAULT_RANGE = 30

const dayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 })
const percent = new Intl.NumberFormat(undefined, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 1 })

// Day keys arrive as UTC 'YYYY-MM-DD'; parsing them at local midnight keeps the calendar date
// the server bucketed on instead of sliding it a day west
const formatDay = (date) => dayFormatter.format(new Date(`${date}T00:00:00`))

function FloorTooltip({ active, payload, label, symbol }) {
  if (!active || !payload?.length) return null

  const value = payload[0].value
  if (value === null || value === undefined) return null

  return (
    <div className={styles.chart__tooltip}>
      <span className={styles.chart__tooltipDate}>{formatDay(label)}</span>
      <strong className={styles.chart__tooltipValue}>
        {compact.format(value)} {symbol}
      </strong>
    </div>
  )
}

/**
 * Floor Chart
 * How cheaply you could have bought into this collection, day by day. One series, so no legend
 * — the heading names what is plotted, and the current floor is called out beside it rather
 * than labelled inside the plot where it would collide with the line.
 *
 * The floor is rebuilt from which listings were live on each day (see lib/nftFloorHistory), not
 * read from a snapshot: days when nobody was selling have no floor at all and break the line
 * rather than dropping it to zero.
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
  const [showTable, setShowTable] = useState(false)

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

  // Recharts plots Numbers, so wei-scale base units get scaled down here — unlike the card
  // sparkline, this series carries a real axis, so the values have to be the ones a reader
  // would recognise. Nulls stay null so connectNulls={false} can break the line over them.
  const series = useMemo(() => {
    if (!history?.points?.length || decimals === undefined) return []
    return history.points.map((point) => ({
      date: point.date,
      floor: point.floor === null ? null : Number(formatUnits(BigInt(point.floor), decimals)),
    }))
  }, [history, decimals])

  const quoted = useMemo(() => series.filter((point) => point.floor !== null), [series])
  const lastQuotedIndex = useMemo(() => series.reduce((last, point, index) => (point.floor === null ? last : index), -1), [series])

  const change = history?.change_pct
  const hasChange = change !== null && change !== undefined
  // Flat is its own outcome — an up caret over "0%" claims a direction the number denies
  const direction = !hasChange || change === 0 ? 'flat' : change > 0 ? 'up' : 'down'
  const Caret = direction === 'up' ? CaretUpIcon : direction === 'down' ? CaretDownIcon : MinusIcon

  // A single priced day is a price, not a trend — there is no line to draw through one point
  const hasTrend = quoted.length >= 2

  // Endpoint marker only: a dot on every day is the "number on every point" failure in mark
  // form. The surface-colored ring keeps it legible where it sits on the line.
  const renderDot = (props) => {
    const { cx, cy, index, key } = props
    if (index !== lastQuotedIndex || cx === null || cy === null) return null
    return <circle key={key} cx={cx} cy={cy} r={4} fill="var(--chart-line)" stroke="var(--surface)" strokeWidth={2} />
  }

  if (hasFailed) return null

  return (
    <section className={styles.chart} aria-label="Floor price history">
      <header className={styles.chart__header}>
        <div className={styles.chart__headline}>
          <h3 className={styles.chart__title}>Floor price</h3>

          {hasTrend && (
            <p className={styles.chart__summary}>
              <span className={styles.chart__current}>
                {formatStake(history.points[lastQuotedIndex].floor, decimals)} {symbol}
              </span>
              {hasChange && (
                <span className={clsx(styles.chart__delta, styles[`chart__delta--${direction}`])}>
                  <Caret size={12} weight="bold" aria-hidden="true" />
                  {percent.format(change / 100)}
                  <small>{days}d</small>
                </span>
              )}
            </p>
          )}
        </div>

        {/* One control row above everything it scopes — the range picker and the table toggle
            both re-render the same slice rather than each owning a filter of its own */}
        <div className={styles.chart__controls}>
          <div className={styles.chart__ranges} role="group" aria-label="Time range">
            {RANGES.map((range) => (
              <button
                key={range.days}
                type="button"
                className={clsx(styles.chart__range, days === range.days && styles['chart__range--active'])}
                aria-pressed={days === range.days}
                onClick={() => setDays(range.days)}
              >
                {range.label}
              </button>
            ))}
          </div>

          {hasTrend && (
            <button
              type="button"
              className={styles.chart__toggle}
              aria-pressed={showTable}
              onClick={() => setShowTable((current) => !current)}
            >
              {showTable ? <ChartLineIcon size={14} /> : <TableIcon size={14} />}
              {showTable ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </header>

      {!hasTrend ? (
        <p className={styles.chart__empty}>
          {isLoading ? 'Loading floor history…' : `Nothing was listed on enough days in the last ${days} days to chart a floor.`}
        </p>
      ) : (
        /* Refetching a new range dims the existing render instead of swapping in a skeleton —
           the axis and the line hold their geometry, so the card never jumps */
        <div className={clsx(styles.chart__body, isLoading && styles['chart__body--refreshing'])}>
          {showTable ? (
            <div className={styles.chart__tableWrap}>
              <table className={styles.chart__table}>
                <caption className={styles.chart__caption}>
                  Daily floor in {symbol}. Days with nothing listed are left out.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Floor ({symbol})</th>
                  </tr>
                </thead>
                <tbody>
                  {quoted.map((point) => (
                    <tr key={point.date}>
                      <th scope="row">{formatDay(point.date)}</th>
                      <td>{compact.format(point.floor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDay}
                  minTickGap={28}
                  stroke="var(--text-muted)"
                  tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(value) => compact.format(value)}
                  stroke="var(--text-muted)"
                  tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip content={<FloorTooltip symbol={symbol} />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
                {/* Linear, not monotone: the floor is one discrete value per day, and a spline
                    through those points rounds a one-day spike into a smooth hump that reads as
                    prices the collection never actually had. Straight segments claim only the
                    interpolation every daily series is already read with. */}
                <Line
                  type="linear"
                  dataKey="floor"
                  name="Floor"
                  stroke="var(--chart-line)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  connectNulls={false}
                  dot={renderDot}
                  activeDot={{ r: 5, fill: 'var(--chart-line)', stroke: 'var(--surface)', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </section>
  )
}
