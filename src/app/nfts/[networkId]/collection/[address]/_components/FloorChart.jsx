'use client'

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { formatUnits } from 'viem'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
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

// Half-width of the diamond a sale is drawn as. 4.5 puts it a touch over the 8px minimum
// marker size once both points of an axis are counted.
const SALE_RADIUS = 4.5

const dayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 })
const percent = new Intl.NumberFormat(undefined, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 1 })

// Day keys arrive as UTC 'YYYY-MM-DD'; parsing them at local midnight keeps the calendar date
// the server bucketed on instead of sliding it a day west
const formatDay = (date) => dayFormatter.format(new Date(`${date}T00:00:00`))

function FloorTooltip({ active, payload, label, symbol }) {
  // Both series share one data row, so the row is read straight off the payload rather than
  // matched entry by entry — whichever of the two the pointer found carries it
  const row = payload?.[0]?.payload
  if (!active || !row) return null

  const hasFloor = row.floor !== null && row.floor !== undefined
  const hasSale = row.sale !== null && row.sale !== undefined
  if (!hasFloor && !hasSale) return null

  return (
    <div className={styles.chart__tooltip}>
      <span className={styles.chart__tooltipDate}>{formatDay(label)}</span>

      {hasFloor && (
        <strong className={styles.chart__tooltipValue}>
          Floor {compact.format(row.floor)} {symbol}
        </strong>
      )}

      {/* A day with several sales is plotted at its mean, so the tooltip has to say so and
          give the range back — otherwise the marker quietly passes an average off as a price */}
      {hasSale && (
        <span className={styles.chart__tooltipSale}>
          {row.saleCount > 1
            ? `${row.saleCount} sales, avg ${compact.format(row.sale)} ${symbol} (${compact.format(row.saleLow)}–${compact.format(row.saleHigh)})`
            : `Sold ${compact.format(row.sale)} ${symbol}`}
        </span>
      )}
    </div>
  )
}

/**
 * A settled trade, as a diamond over the floor line. Shape carries the distinction, not hue
 * alone, so the two series stay apart in greyscale and under CVD.
 */
function SaleMarker({ cx, cy }) {
  if (cx === null || cx === undefined || cy === null || cy === undefined) return null

  return (
    <path
      d={`M${cx} ${cy - SALE_RADIUS}L${cx + SALE_RADIUS} ${cy}L${cx} ${cy + SALE_RADIUS}L${cx - SALE_RADIUS} ${cy}Z`}
      fill="var(--chart-sale)"
      stroke="var(--surface)"
      strokeWidth={1.5}
    />
  )
}

/**
 * Floor Chart
 * How cheaply you could have bought into this collection, day by day, and which of those asks
 * anyone actually took. Two series, so a legend is present; the current floor and the last
 * sale are called out beside the heading rather than labelled inside the plot where they
 * would collide with the line.
 *
 * The floor is rebuilt from which listings were live on each day (see lib/nftFloorHistory), not
 * read from a snapshot: days when nobody was selling have no floor at all and break the line
 * rather than dropping it to zero. Sales come from nft_trades and are events, not a series —
 * they appear only on the days something changed hands.
 *
 * A sale marker sitting *below* the line is real, not a rendering fault: a listing that sells
 * is live on its sale day and therefore sets that day's floor, so a second, cheaper sale that
 * had already ended dips under it.
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
  //
  // Sales are folded into the same rows the floor uses: one shared data array means the
  // tooltip resolves a day once, and a sale can never drift off the tick it belongs to.
  const series = useMemo(() => {
    if (!history?.points?.length || decimals === undefined) return []

    const toNumber = (value) => Number(formatUnits(BigInt(value), decimals))
    const salesByDate = new Map((history.sales || []).map((sale) => [sale.date, sale]))

    return history.points.map((point) => {
      const sale = salesByDate.get(point.date)

      return {
        date: point.date,
        floor: point.floor === null ? null : toNumber(point.floor),
        sale: sale ? toNumber(sale.avg) : null,
        saleCount: sale?.count ?? 0,
        saleLow: sale ? toNumber(sale.low) : null,
        saleHigh: sale ? toNumber(sale.high) : null,
      }
    })
  }, [history, decimals])

  const quoted = useMemo(() => series.filter((point) => point.floor !== null), [series])
  const lastQuotedIndex = useMemo(() => series.reduce((last, point, index) => (point.floor === null ? last : index), -1), [series])
  const hasSales = useMemo(() => series.some((point) => point.sale !== null), [series])
  // The table is the chart's readable twin, so it covers the union: a day that only traded
  // still earns a row, or the marker above it would have no text equivalent
  const tableRows = useMemo(() => series.filter((point) => point.floor !== null || point.sale !== null), [series])

  const change = history?.change_pct
  const hasChange = change !== null && change !== undefined
  // Flat is its own outcome — an up caret over "0%" claims a direction the number denies
  const direction = !hasChange || change === 0 ? 'flat' : change > 0 ? 'up' : 'down'
  const Caret = direction === 'up' ? CaretUpIcon : direction === 'down' ? CaretDownIcon : MinusIcon

  // A single priced day is a price, not a trend — there is no line to draw through one point
  const hasTrend = quoted.length >= 2
  // Window-bounded like everything else here, so its absence on 7d is information rather than
  // a gap: nothing traded that week
  const lastSale = history?.last_sale

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
          {/* This app's order book, not the collection's floor across every marketplace it
              trades on — saying so plainly beats letting the number overclaim */}
          <p className={styles.chart__scope}>Cheapest listing on Hup</p>

          {(hasTrend || lastSale) && (
            <p className={styles.chart__summary}>
              {hasTrend && (
                <>
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
                </>
              )}

              {/* Rendered on its own condition, so a collection whose listings have all aged
                  out still gets to say what it last traded for */}
              {lastSale && (
                <span className={styles.chart__lastSale}>
                  Last sale
                  <strong>
                    {formatStake(lastSale.price, decimals)} {symbol}
                  </strong>
                  <small>{formatDay(lastSale.date)}</small>
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

      {/* Only earned once both series are actually on the plot — a legend naming a mark that
          was never drawn is chrome explaining nothing */}
      {hasTrend && hasSales && !showTable && (
        <div className={styles.chart__legend}>
          <span className={styles.chart__legendItem}>
            <svg className={styles.chart__legendMark} viewBox="0 0 12 12" aria-hidden="true">
              <line x1="1" y1="6" x2="11" y2="6" stroke="var(--chart-line)" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Floor
          </span>
          <span className={styles.chart__legendItem}>
            <svg className={styles.chart__legendMark} viewBox="0 0 12 12" aria-hidden="true">
              <path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" fill="var(--chart-sale)" />
            </svg>
            Sale
          </span>
        </div>
      )}

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
                  Daily floor and sales in {symbol}. Days with nothing listed and nothing sold are left out; a day
                  with several sales shows their average.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Floor ({symbol})</th>
                    <th scope="col">Sold ({symbol})</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((point) => (
                    <tr key={point.date}>
                      <th scope="row">{formatDay(point.date)}</th>
                      <td>{point.floor === null ? '—' : compact.format(point.floor)}</td>
                      <td>
                        {point.sale === null ? '—' : compact.format(point.sale)}
                        {point.saleCount > 1 && <small className={styles.chart__tableCount}>×{point.saleCount}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              {/* Composed rather than a line chart: a sale is a discrete event, and drawing it
                  as a second line with the stroke switched off would fake a series that has no
                  continuity between its points */}
              <ComposedChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
                {/* After the line, so a sale that landed on the floor it cleared sits on top of
                    it rather than under it */}
                <Scatter dataKey="sale" name="Sale" shape={<SaleMarker />} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </section>
  )
}
