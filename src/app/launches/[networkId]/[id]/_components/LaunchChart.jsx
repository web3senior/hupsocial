'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { formatUnits } from 'viem'
import { formatDecimal, formatNative } from '@/lib/launch'
import styles from './LaunchChart.module.scss'

// Up/down pair, validated with the dataviz palette script against both the light and dark chart
// surfaces: worst-case CVD separation ΔE 10.3 (protan), normal-vision 32.1, contrast ≥3:1 —
// where the conventional #22a06b/#e34948 pair scores only 5.8 under deuteranopia, below even the
// conditional floor. Colour is never the sole cue regardless: candle geometry carries direction,
// and the OHLC readout states the numbers outright.
const UP = '#0d9488'
const DOWN = '#f43f5e'

const INTERVALS = [
  { key: 60, label: '1m' },
  { key: 300, label: '5m' },
  { key: 900, label: '15m' },
  { key: 3600, label: '1H' },
]

const VOLUME_WINDOWS = [
  { key: 3600, label: '1H' },
  { key: 21600, label: '6H' },
  { key: 86400, label: '24H' },
  { key: null, label: 'All' },
]

/**
 * Groups price points into OHLCV candles on a fixed interval. Empty intervals are skipped rather
 * than carried forward — a bonding curve only moves when someone trades, so a flat run of
 * synthetic candles would imply activity that never happened.
 */
const buildCandles = (points, seconds) => {
  const byBucket = new Map()

  for (const point of points) {
    const bucket = Math.floor(point.at / seconds) * seconds
    const candle = byBucket.get(bucket)

    if (!candle) {
      byBucket.set(bucket, {
        time: bucket,
        open: point.price,
        high: point.price,
        low: point.price,
        close: point.price,
        volume: point.volume,
        volumeWei: point.volumeWei,
      })
      continue
    }

    candle.high = Math.max(candle.high, point.price)
    candle.low = Math.min(candle.low, point.price)
    candle.close = point.price
    candle.volume += point.volume
    candle.volumeWei += point.volumeWei
  }

  // Lightweight Charts requires ascending, strictly unique timestamps
  return [...byBucket.values()].sort((a, b) => a.time - b.time)
}

/**
 * Tick granularity for the price scale. Memecoin prices sit around 1e-9, where the library's
 * default two-decimal formatting collapses every candle onto 0.00 — so the move size is derived
 * from the data's own magnitude rather than hardcoded.
 */
const minMoveFor = (price) => {
  if (!Number.isFinite(price) || price <= 0) return 0.00000001
  return Math.pow(10, Math.floor(Math.log10(price)) - 3)
}

/**
 * Launch Chart
 * Candles and volume over the bonding curve's trade history, drawn with TradingView's
 * Lightweight Charts — the same library the DEX screeners use, so the price scale, crosshair,
 * last-price tag and time axis behave the way traders already expect.
 *
 * The canvas is transparent and the library's own gridlines are off: the dot grid behind it is
 * CSS, which keeps it on the app's theme tokens without re-theming the chart in JS.
 *
 * @param {Object} props
 * @param {Array} props.trades Indexed trades, oldest first.
 * @param {Object} props.launch The indexed launch row, for the opening price.
 * @param {string} props.nativeSymbol Ticker of the chain's native coin.
 */
const LaunchChart = ({ trades, launch, nativeSymbol }) => {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)
  const volumeSeriesRef = useRef(null)

  // Named for the value, not `interval` — a `setInterval` state setter shadows the global timer
  const [candleSeconds, setCandleSeconds] = useState(300)
  const [volumeWindow, setVolumeWindow] = useState(null)
  const [hovered, setHovered] = useState(null)
  // The chart is created inside an async import, and assigning a ref does not re-render — so
  // without this flag the data effect runs once against null refs and never fires again.
  const [ready, setReady] = useState(false)

  // Wall-clock lives in state rather than being read during render: Date.now() in a memo is
  // impure, so the window boundary would shift on any incidental re-render. Ticks on SWR's
  // cadence, and stays 0 until mounted so server and client agree on the first paint.
  const [now, setNow] = useState(0)
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000))
    tick()
    const timer = window.setInterval(tick, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // The curve's opening price is a real data point: it is where the token was priced before
  // anyone traded, so it becomes the first candle's open rather than being inferred from a buy.
  const points = useMemo(() => {
    if (!launch) return []

    return [
      {
        at: Number(launch.created_at),
        // The pool's opening price, derived at index time from LaunchCreated's sqrtPriceX96
        price: Number(formatUnits(BigInt(launch.opening_price || 0), 18)),
        volume: 0,
        volumeWei: 0n,
      },
      ...trades.map((trade) => ({
        at: Number(trade.traded_at),
        price: Number(formatUnits(BigInt(trade.price || 0), 18)),
        volume: Number(formatUnits(BigInt(trade.native_amount || 0), 18)),
        volumeWei: BigInt(trade.native_amount || 0),
      })),
    ]
  }, [trades, launch])

  const candles = useMemo(() => buildCandles(points, candleSeconds), [points, candleSeconds])

  const volumeStats = useMemo(() => {
    const cutoff = volumeWindow && now ? now - volumeWindow : 0
    const inWindow = trades.filter((trade) => Number(trade.traded_at) >= cutoff)

    const tally = (side) => {
      const rows = inWindow.filter((trade) => Number(trade.side) === side)
      return {
        count: rows.length,
        traders: new Set(rows.map((trade) => trade.trader)).size,
        total: rows.reduce((sum, trade) => sum + BigInt(trade.native_amount || 0), 0n),
      }
    }

    const buys = tally(0)
    const sells = tally(1)
    const total = buys.total + sells.total
    // Integer percentage split, computed in wei so a large sell can't be rounded away
    const buyShare = total > 0n ? Number((buys.total * 1000n) / total) / 10 : 0

    return { buys, sells, total, buyShare }
  }, [trades, volumeWindow, now])

  const lastCandle = candles[candles.length - 1]

  // Build the chart once. Imported dynamically so the library never reaches the server bundle,
  // and so nothing touches `document` before mount.
  useEffect(() => {
    let disposed = false
    const element = containerRef.current
    if (!element) return undefined

    import('lightweight-charts').then(({ createChart, CandlestickSeries, HistogramSeries, CrosshairMode, LineStyle }) => {
      if (disposed || !containerRef.current) return

      const ink = getComputedStyle(element).getPropertyValue('--text-muted').trim() || '#888888'

      const chart = createChart(element, {
        autoSize: true,
        layout: {
          // Transparent so the CSS dot grid behind the canvas shows through, and so the chart
          // follows a light/dark theme flip without re-applying options
          background: { color: 'transparent' },
          textColor: ink,
          fontSize: 10,
          attributionLogo: true,
        },
        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
        rightPriceScale: {
          borderVisible: false,
          ticksVisible: false,
          entireTextOnly: true,
          scaleMargins: { top: 0.1, bottom: 0.3 },
        },
        timeScale: {
          borderVisible: false,
          ticksVisible: false,
          timeVisible: true,
          secondsVisible: false,
          // Narrow bars with room to breathe — the reference look is thin marks on empty space,
          // not a packed wall of candles
          barSpacing: 7,
          minBarSpacing: 0.5,
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: ink, width: 1, style: LineStyle.Dotted, labelBackgroundColor: ink },
          horzLine: { color: ink, width: 1, style: LineStyle.Dotted, labelBackgroundColor: ink },
        },
        handleScale: { axisPressedMouseMove: { time: true, price: false } },
      })

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: UP,
        downColor: DOWN,
        // No border: a bordered body at this width is mostly outline, which reads heavy
        borderVisible: false,
        wickUpColor: UP,
        wickDownColor: DOWN,
        priceLineStyle: LineStyle.Dashed,
        priceLineWidth: 1,
      })

      // Overlay histogram: its own hidden scale pinned to the bottom fifth, so volume never
      // shares an axis with price
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: '',
        priceFormat: { type: 'volume' },
        lastValueVisible: false,
        priceLineVisible: false,
      })
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })

      // The OHLC readout above the chart follows the crosshair; leaving the pane falls back to
      // the most recent candle
      chart.subscribeCrosshairMove((param) => {
        setHovered(param?.seriesData?.get(candleSeries) ?? null)
      })

      chartRef.current = chart
      candleSeriesRef.current = candleSeries
      volumeSeriesRef.current = volumeSeries
      setReady(true)
    })

    return () => {
      disposed = true
      setReady(false)
      chartRef.current?.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
    }
  }, [])

  // Feed the series. Kept separate from creation so changing the interval or receiving new
  // trades never tears the chart down and loses the viewer's pan/zoom.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    if (!candleSeries || !volumeSeries || candles.length === 0) return

    candleSeries.applyOptions({
      priceFormat: {
        type: 'custom',
        minMove: minMoveFor(candles[candles.length - 1].close),
        formatter: (value) => formatDecimal(value, 4),
      },
    })

    candleSeries.setData(
      candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
    )
    volumeSeries.setData(
      candles.map(({ time, volume, close, open }) => ({
        time,
        value: volume,
        color: close >= open ? `${UP}66` : `${DOWN}66`,
      })),
    )
    chartRef.current?.timeScale().fitContent()
  }, [candles, ready])

  if (!launch) return null

  if (candles.length === 0) {
    return <p className={styles.chart__empty}>No trades yet — the chart starts with the first buy.</p>
  }

  const active = hovered ?? lastCandle
  const activeRising = (active?.close ?? 0) >= (active?.open ?? 0)

  return (
    <section className={styles.chart} aria-label="Price and volume history">
      <header className={styles.chart__header}>
        <dl className={styles.chart__ohlc} style={{ color: activeRising ? UP : DOWN }}>
          {[
            ['O', active?.open],
            ['H', active?.high],
            ['L', active?.low],
            ['C', active?.close],
          ].map(([letter, value]) => (
            <div key={letter}>
              <dt>{letter}</dt>
              <dd>{formatDecimal(value ?? 0, 4)}</dd>
            </div>
          ))}
        </dl>

        <div className={styles.chart__intervals} role="group" aria-label="Candle interval">
          {INTERVALS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-pressed={candleSeconds === entry.key}
              className={clsx(candleSeconds === entry.key && styles['chart__interval--active'])}
              onClick={() => setCandleSeconds(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </header>

      <div ref={containerRef} className={styles.chart__canvas} />

      <footer className={styles.chart__volume}>
        <div className={styles.chart__volumeHead}>
          <div>
            <span>Volume</span>
            <strong>
              {formatNative(volumeStats.total)} {nativeSymbol}
            </strong>
          </div>
          <div className={styles.chart__intervals} role="group" aria-label="Volume window">
            {VOLUME_WINDOWS.map((entry) => (
              <button
                key={entry.label}
                type="button"
                aria-pressed={volumeWindow === entry.key}
                className={clsx(volumeWindow === entry.key && styles['chart__interval--active'])}
                onClick={() => setVolumeWindow(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.chart__split} role="img" aria-label={`${volumeStats.buyShare}% of volume is buys`}>
          <span style={{ width: `${volumeStats.buyShare}%`, background: UP }} />
          <span style={{ width: `${100 - volumeStats.buyShare}%`, background: DOWN }} />
        </div>

        <div className={styles.chart__splitLegend}>
          <p style={{ color: UP }}>
            <b>{volumeStats.buys.count} buys</b>
            <small>
              {volumeStats.buys.traders} · {formatNative(volumeStats.buys.total)} {nativeSymbol} ·{' '}
              {volumeStats.buyShare.toFixed(1)}%
            </small>
          </p>
          <p style={{ color: DOWN }}>
            <b>{volumeStats.sells.count} sells</b>
            <small>
              {volumeStats.sells.traders} · {formatNative(volumeStats.sells.total)} {nativeSymbol} ·{' '}
              {(100 - volumeStats.buyShare).toFixed(1)}%
            </small>
          </p>
        </div>
      </footer>
    </section>
  )
}

export default LaunchChart
