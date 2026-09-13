'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { CornersInIcon, CornersOutIcon } from '@phosphor-icons/react'
import { formatUnits } from 'viem'
import { TOTAL_SUPPLY, WAD, formatDecimal, formatQuote, formatUsd, quoteWeiToUsd } from '@/lib/launch'
import { resolveAvatarImageUrl } from '@/lib/storageHelper'
import { createTraderAvatarsPrimitive } from './traderAvatarsPrimitive'
import styles from './LaunchChart.module.scss'

// Up/down colours come from the app's own theme tokens (--chart-up / --chart-down in
// Globals.scss :root — user-owned, light and dark values). The canvas can't read CSS variables,
// so they're resolved from computed style once at chart creation; the HTML parts (OHLC readout,
// volume split) use var() directly and follow a theme flip live. Direction is never colour-alone
// regardless: candle geometry, the OHLC numbers, and the Buy/Sell labels all carry it.
const FALLBACK_UP = '#16a34a'
const FALLBACK_DOWN = '#dc2626'
const CSS_UP = `var(--chart-up, ${FALLBACK_UP})`
const CSS_DOWN = `var(--chart-down, ${FALLBACK_DOWN})`

const readChartColors = (element) => {
  const style = getComputedStyle(element)
  return {
    up: style.getPropertyValue('--chart-up').trim() || FALLBACK_UP,
    down: style.getPropertyValue('--chart-down').trim() || FALLBACK_DOWN,
    muted: style.getPropertyValue('--text-muted').trim() || '#888888',
  }
}

// Alpha suffix only works on 6-digit hex; anything else (a named colour, rgb()) passes through
const withAlpha = (color, alpha) => (/^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color)

const INTERVALS = [
  { key: 60, label: '1m' },
  { key: 300, label: '5m' },
  { key: 900, label: '15m' },
  { key: 3600, label: '1H' },
]

// Pixels per candle before the viewer zooms — bodies wide enough to read direction from
const DEFAULT_BAR_SPACING = 12

// Below this the whole history is too dense to fit on open, so the view falls back to the fixed
// spacing at the live edge instead
const MIN_FIT_BAR_SPACING = 3

// Bars of air left either side of a fitted view, so an avatar on the first or last candle is not
// sliced by the pane edge
const FIT_EDGE_BARS = 4

const METRICS = [
  { key: 'price', label: 'Price' },
  { key: 'fdv', label: 'FDV' },
]

// FDV is the whole fixed supply at the plotted price, so the two metrics are one multiplier apart
const SUPPLY_MULTIPLIER = Number(TOTAL_SUPPLY / WAD)

const VOLUME_WINDOWS = [
  { key: 3600, label: '1H' },
  { key: 21600, label: '6H' },
  { key: 86400, label: '24H' },
  { key: null, label: 'All' },
]

/**
 * Groups price points into OHLCV candles on a fixed interval, then fills every empty interval
 * with a flat candle carrying the last close forward — up to the CURRENT interval, so the time
 * axis keeps advancing even when nobody trades. That continuous tape is what makes a screener
 * chart read as "live" (pools.trade does the same); a sparse trades-only series looks frozen.
 *
 * @param {Array} points Price points, any order.
 * @param {number} seconds Candle interval.
 * @param {number} nowBucket The current interval's bucket timestamp (0 before the clock mounts).
 */
const buildCandles = (points, seconds, nowBucket) => {
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
  const sparse = [...byBucket.values()].sort((a, b) => a.time - b.time)
  if (sparse.length === 0) return sparse

  // Every interval opens where the last one closed — the standard OHLC construction for tick
  // data, and the one thing that makes a candle chart of this shape readable. Opening each
  // bucket at its OWN first trade turned any single-trade interval into a doji with no body and
  // no direction, and left consecutive candles never touching: on a bonding curve, where an
  // interval holds one trade or none, that rendered the entire tape as disconnected dashes.
  for (let index = 1; index < sparse.length; index++) {
    const open = sparse[index - 1].close
    sparse[index].open = open
    sparse[index].high = Math.max(sparse[index].high, open)
    sparse[index].low = Math.min(sparse[index].low, open)
  }

  const first = sparse[0].time
  const last = Math.max(sparse[sparse.length - 1].time, nowBucket || 0)
  // Pathology guard: an old launch on the 1m interval would fill tens of thousands of flat
  // candles — past this span the sparse series is the lesser evil
  if (!nowBucket || (last - first) / seconds > 10_000) return sparse

  const filled = []
  let previousClose = sparse[0].open
  for (let time = first; time <= last; time += seconds) {
    const real = byBucket.get(time)
    if (real) {
      filled.push(real)
      previousClose = real.close
    } else {
      // Tagged so the drawing pass can mute it. A young token is mostly empty intervals, and at
      // full up/down strength those dashes shout louder than the handful of real trades.
      filled.push({
        time,
        open: previousClose,
        high: previousClose,
        low: previousClose,
        close: previousClose,
        volume: 0,
        volumeWei: 0n,
        filler: true,
      })
    }
  }
  return filled
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
 * @param {{symbol: string, decimals: number}} props.quote The asset this launch is priced in.
 * @param {number|null} [props.quoteUsd] Dollar price of the quote asset, when the chain has a feed.
 */
const LaunchChart = ({ trades, launch, quote, quoteUsd = null }) => {
  const quoteSymbol = quote?.symbol ?? 'ETH'
  const quoteDecimals = quote?.decimals ?? 18

  // Volume is money, and money reads in dollars wherever there is a rate for it
  const quoteFigure = (amount) =>
    quoteUsd
      ? formatUsd(quoteWeiToUsd(amount, quoteUsd, quoteDecimals))
      : `${formatQuote(amount, quoteDecimals)} ${quoteSymbol}`

  const [metric, setMetric] = useState('price')

  // Indexed prices are base units of the quote asset per token. One multiplier turns them into whatever the header
  // asks for — dollars where the chain has a rate, times the supply when the metric is FDV — so
  // the candles, the avatar markers and the readout can never drift out of the same unit.
  const valueScale = (quoteUsd || 1) * (metric === 'fdv' ? SUPPLY_MULTIPLIER : 1)
  const moneyPrefix = quoteUsd ? '$' : ''

  // An FDV runs to millions where the subscript form has nothing to compact, so past a thousand
  // the label is grouped whole dollars instead
  const formatMetric = (value, { digits = 6, pad = false } = {}) =>
    Math.abs(value) >= 1000
      ? `${moneyPrefix}${Math.round(value).toLocaleString('en')}`
      : `${moneyPrefix}${formatDecimal(value, digits, { pad })}`

  const router = useRouter()
  const sectionRef = useRef(null)
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)
  const volumeSeriesRef = useRef(null)
  const avatarsRef = useRef(null)
  // Theme colours resolved at creation, needed again when the volume bars re-colour on data
  const colorsRef = useRef({ up: FALLBACK_UP, down: FALLBACK_DOWN, muted: '#888888' })
  // Which interval the view (restored zoom or default spacing) was last applied for — data refreshes
  // must never re-fit, or the viewer's pan/zoom gets stomped every poll
  const viewAppliedRef = useRef(null)
  const [hoveredTrader, setHoveredTrader] = useState(null)

  // Named for the value, not `interval` — a `setInterval` state setter shadows the global timer
  const [candleSeconds, setCandleSeconds] = useState(300)

  // Zoom persists per launch AND per interval (logical ranges are bar indices, so they don't
  // translate across intervals). Ref'd so the once-only range subscription writes the right key.
  const zoomKey = `hup:launch-zoom:${launch?.network_id}:${launch?.launch_id}:${candleSeconds}`
  const zoomKeyRef = useRef(zoomKey)
  useEffect(() => {
    zoomKeyRef.current = zoomKey
  }, [zoomKey])
  const [volumeWindow, setVolumeWindow] = useState(null)
  const [hovered, setHovered] = useState(null)
  // The chart is created inside an async import, and assigning a ref does not re-render — so
  // without this flag the data effect runs once against null refs and never fires again.
  const [ready, setReady] = useState(false)

  // Track fullscreen from the document, not from the click — Esc and the browser's own controls
  // exit without telling us, and the button label would otherwise go stale
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement === sectionRef.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  // iPhone Safari implements the Fullscreen API for <video> only, so requestFullscreen is absent
  // on ordinary elements. Without this the button renders and silently does nothing.
  const [canFullscreen, setCanFullscreen] = useState(false)
  useEffect(() => {
    setCanFullscreen(typeof document !== 'undefined' && document.fullscreenEnabled === true)
  }, [])

  // The whole section goes fullscreen, not just the canvas, so the exit control, the OHLC
  // readout and the volume panel all come along. `autoSize` means the chart resizes itself.
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
      return
    }
    sectionRef.current?.requestFullscreen?.().catch(() => {
      /* denied or unsupported — the inline chart keeps working */
    })
  }

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
        price: Number(formatUnits(BigInt(launch.opening_price || 0), quoteDecimals)),
        volume: 0,
        volumeWei: 0n,
      },
      ...trades.map((trade) => ({
        at: Number(trade.traded_at),
        price: Number(formatUnits(BigInt(trade.price || 0), quoteDecimals)),
        volume: Number(formatUnits(BigInt(trade.native_amount || 0), quoteDecimals)),
        volumeWei: BigInt(trade.native_amount || 0),
      })),
    ]
  }, [trades, launch, quoteDecimals])

  // Derived from `now` but quantized to the interval, so the series only rebuilds when a new
  // candle actually opens — not on every 30s clock tick
  const nowBucket = now ? Math.floor(now / candleSeconds) * candleSeconds : 0
  const candles = useMemo(() => buildCandles(points, candleSeconds, nowBucket), [points, candleSeconds, nowBucket])

  // What actually gets drawn. The wei totals stay on `candles` — the readout looks a candle up by
  // time for its own volume, and scaling a float back up would overflow past 2^53.
  const plotted = useMemo(
    () =>
      candles.map(({ time, open, high, low, close, filler }) => ({
        time,
        open: open * valueScale,
        high: high * valueScale,
        low: low * valueScale,
        close: close * valueScale,
        filler: filler === true,
      })),
    [candles, valueScale],
  )

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

  // One face per candle — the biggest trade wins the slot, a +N badge carries the rest — capped
  // to the 45 largest in the set. A busy token should read as a crowd on the tape: at any sane
  // zoom neighbouring candles' faces overlap into clusters, which is the whole fomo mechanic.
  // Radius follows trade size off a floor small enough that a quiet token still shows candles:
  // faces are a layer ON the tape, and at the old 12–18px they buried it under six discs.
  const avatarMarkers = useMemo(() => {
    if (trades.length === 0) return []

    const byBucket = new Map()
    for (const trade of trades) {
      const bucket = Math.floor(Number(trade.traded_at) / candleSeconds) * candleSeconds
      const size = Number(formatUnits(BigInt(trade.native_amount || 0), quoteDecimals))
      const candidate = {
        time: bucket,
        price: Number(formatUnits(BigInt(trade.price || 0), quoteDecimals)) * valueScale,
        side: Number(trade.side),
        size,
        amountLabel: formatQuote(BigInt(trade.native_amount || 0), quoteDecimals),
        name: trade.display_name || null,
        address: trade.trader,
        image: trade.profile_image ? resolveAvatarImageUrl(trade.profile_image, 48) : null,
        initial: (trade.display_name || trade.trader?.slice(2) || '?').charAt(0).toUpperCase(),
        extra: 0,
      }
      const current = byBucket.get(bucket)
      if (!current) {
        byBucket.set(bucket, candidate)
      } else if (size > current.size) {
        candidate.extra = current.extra + 1
        byBucket.set(bucket, candidate)
      } else {
        current.extra += 1
      }
    }

    const top = [...byBucket.values()].sort((a, b) => b.size - a.size).slice(0, 45)
    const maxSize = top[0]?.size || 1
    return top.map((marker) => ({
      ...marker,
      radius: 7 + Math.round(4 * Math.sqrt(maxSize > 0 ? marker.size / maxSize : 0)),
    }))
  }, [trades, candleSeconds, valueScale, quoteDecimals])

  useEffect(() => {
    if (ready) avatarsRef.current?.setMarkers(avatarMarkers)
  }, [avatarMarkers, ready])

  const lastCandle = plotted[plotted.length - 1]

  // Build the chart once. Imported dynamically so the library never reaches the server bundle,
  // and so nothing touches `document` before mount.
  useEffect(() => {
    let disposed = false
    const element = containerRef.current
    if (!element) return undefined

    import('lightweight-charts').then(({ createChart, CandlestickSeries, HistogramSeries, CrosshairMode, LineStyle }) => {
      if (disposed || !containerRef.current) return

      const colors = readChartColors(element)
      colorsRef.current = colors
      const ink = colors.muted

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
          // Meets the volume floor below with a hair to spare — a wider gap than this reads as
          // a hole in the middle of the pane rather than as two stacked panels
          scaleMargins: { top: 0.08, bottom: 0.24 },
        },
        timeScale: {
          borderVisible: false,
          ticksVisible: false,
          timeVisible: true,
          secondsVisible: false,
          // A fixed default candle width, the screener default — the viewer zooms from there.
          // Fitting the whole history instead made the bars as thin as the launch was old.
          barSpacing: DEFAULT_BAR_SPACING,
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
        upColor: colors.up,
        downColor: colors.down,
        // No border: a bordered body at this width is mostly outline, which reads heavy
        borderVisible: false,
        wickUpColor: colors.up,
        wickDownColor: colors.down,
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
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.79, bottom: 0 } })

      // The OHLC readout above the chart follows the crosshair; leaving the pane falls back to
      // the most recent candle
      chart.subscribeCrosshairMove((param) => {
        setHovered(param?.seriesData?.get(candleSeries) ?? null)
      })

      // Trader avatars ride the candle series as a canvas primitive
      const avatars = createTraderAvatarsPrimitive(colors)
      candleSeries.attachPrimitive(avatars)
      avatarsRef.current = avatars

      // Persist pan/zoom (debounced) so a reload comes back to the same view
      let saveTimer = null
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range) return
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
          try {
            localStorage.setItem(zoomKeyRef.current, JSON.stringify({ from: range.from, to: range.to }))
          } catch {}
        }, 250)
      })

      // Hover + click on avatars. Click is distinguished from a pan by pointer travel.
      const relative = (ev) => {
        const rect = element.getBoundingClientRect()
        return [ev.clientX - rect.left, ev.clientY - rect.top]
      }
      let downPoint = null
      const handleMove = (ev) => {
        const [x, y] = relative(ev)
        const hit = avatars.hitTest(x, y)
        element.style.cursor = hit ? 'pointer' : ''
        setHoveredTrader(hit ? { ...hit, x, y } : null)
      }
      const handleLeave = () => setHoveredTrader(null)
      const handleDown = (ev) => {
        downPoint = [ev.clientX, ev.clientY]
      }
      const handleUp = (ev) => {
        if (!downPoint) return
        const travelled = Math.hypot(ev.clientX - downPoint[0], ev.clientY - downPoint[1])
        downPoint = null
        if (travelled > 4) return
        const [x, y] = relative(ev)
        const hit = avatars.hitTest(x, y)
        if (hit) router.push(`/${hit.name || hit.address}`)
      }
      element.addEventListener('mousemove', handleMove)
      element.addEventListener('mouseleave', handleLeave)
      element.addEventListener('mousedown', handleDown)
      element.addEventListener('mouseup', handleUp)
      element._avatarCleanup = () => {
        clearTimeout(saveTimer)
        element.removeEventListener('mousemove', handleMove)
        element.removeEventListener('mouseleave', handleLeave)
        element.removeEventListener('mousedown', handleDown)
        element.removeEventListener('mouseup', handleUp)
      }

      chartRef.current = chart
      candleSeriesRef.current = candleSeries
      volumeSeriesRef.current = volumeSeries
      setReady(true)
    })

    return () => {
      disposed = true
      setReady(false)
      element?._avatarCleanup?.()
      chartRef.current?.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      avatarsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Feed the series. Kept separate from creation so changing the interval or receiving new
  // trades never tears the chart down and loses the viewer's pan/zoom.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    if (!candleSeries || !volumeSeries || plotted.length === 0) return

    const priceFormat = {
      type: 'custom',
      minMove: minMoveFor(plotted[plotted.length - 1].close),
      // 6 significant digits, not 4: zoomed into a quiet stretch the visible range spans a
      // few parts in 100k, and at 4 digits every axis tick rounds to the same label.
      // Padded so every tick is the same width — see formatDecimal on why trimming clips.
      formatter: (value) => formatMetric(value, { digits: 6, pad: true }),
    }
    // Both series share the right scale, and the axis takes its formatting from what is on it —
    // leaving the step line on the library's 2-decimal default printed every sub-cent tick as
    // "0.00" and blanked the price axis
    candleSeries.applyOptions({ priceFormat })

    // Intervals nobody traded are drawn, not hidden — the same continuous tape every screener
    // shows. They carry the last close forward, so with opens chained they line up into one flat
    // run at a single level rather than the scattered dashes they used to be. Muted ink keeps
    // them plainly subordinate to the candles that actually printed.
    const quiet = withAlpha(colorsRef.current.muted, '8c')
    candleSeries.setData(
      plotted.map((candle) =>
        candle.filler ? { ...candle, color: quiet, wickColor: quiet, borderColor: quiet } : candle,
      ),
    )
    volumeSeries.setData(
      candles.map(({ time, volume, close, open }) => ({
        time,
        value: volume,
        // A no-volume interval still draws a zero-height bar, which came out as a 1px line in the
        // up colour — end to end that read as a green floor under the whole pane claiming every
        // quiet interval closed up
        color:
          volume > 0
            ? withAlpha(close >= open ? colorsRef.current.up : colorsRef.current.down, '80')
            : 'transparent',
      })),
    )
    // Apply a view once per interval: the saved zoom when one exists, else the default candle
    // width at the live edge. Data refreshes deliberately never re-apply — that was the bug
    // where every 30s poll reset the zoom.
    if (viewAppliedRef.current !== candleSeconds) {
      viewAppliedRef.current = candleSeconds
      let saved = null
      try {
        saved = JSON.parse(localStorage.getItem(zoomKey) || 'null')
      } catch {}
      if (saved && Number.isFinite(saved.from) && Number.isFinite(saved.to) && saved.to > saved.from) {
        chartRef.current?.timeScale().setVisibleLogicalRange(saved)
      } else if ((containerRef.current?.clientWidth || 0) / plotted.length >= MIN_FIT_BAR_SPACING) {
        // A young token's whole life fits and still leaves readable bars, so show all of it:
        // the fixed screener spacing opened on the last few hours and hid most of the trades
        const timeScale = chartRef.current?.timeScale()
        timeScale?.fitContent()
        // fitContent lands the first and last bars flush against the edges, which halves the
        // avatar sitting on either one — a few bars of air puts them back inside the pane
        const range = timeScale?.getVisibleLogicalRange()
        if (range) timeScale.setVisibleLogicalRange({ from: range.from - FIT_EDGE_BARS, to: range.to + FIT_EDGE_BARS })
      } else {
        chartRef.current?.timeScale().applyOptions({ barSpacing: DEFAULT_BAR_SPACING })
        chartRef.current?.timeScale().scrollToRealTime()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotted, candles, ready, candleSeconds])

  if (!launch) return null

  if (candles.length === 0) {
    return <p className={styles.chart__empty}>No trades yet — the chart starts with the first buy.</p>
  }

  const active = hovered ?? lastCandle
  // The candle under the crosshair is read from the numbers themselves. Tying the readout's
  // colour to its direction meant the whole row flipped green↔red as the pointer travelled,
  // which is motion the eye chases instead of the chart.
  // Charting hands back OHLC only, so the candle is looked up again for its own wei total —
  // scaling the float back up would overflow past 2^53 and hand BigInt a non-integer
  const activeVolumeWei = candles.find((candle) => candle.time === active?.time)?.volumeWei ?? 0n

  return (
    <section ref={sectionRef} className={styles.chart} aria-label="Price and volume history">
      <header className={styles.chart__header}>
        <dl className={styles.chart__ohlc}>
          {[
            ['O', active?.open],
            ['H', active?.high],
            ['L', active?.low],
            ['C', active?.close],
          ].map(([letter, value]) => (
            <div key={letter}>
              <dt>{letter}</dt>
              {/* Same 6 significant digits as the price axis: at 4 a token whose whole session
                  moves in the 5th digit printed O, H, L and C as four identical numbers */}
              <dd>{formatMetric(value ?? 0, { digits: 6 })}</dd>
            </div>
          ))}
          <div>
            <dt>V</dt>
            <dd>
              {quoteFigure(activeVolumeWei)}
            </dd>
          </div>
        </dl>

        <div className={styles.chart__controls}>
          {/* Two options, so a segmented pair rather than a menu — one press to switch, and it
              reads as the same control as the interval beside it */}
          <div className={styles.chart__intervals} role="group" aria-label="Chart metric">
            {METRICS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={metric === entry.key}
                className={clsx(metric === entry.key && styles['chart__interval--active'])}
                onClick={() => {
                  setMetric(entry.key)
                  // The held candle is in the old unit until the pointer moves again
                  setHovered(null)
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>

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

          {canFullscreen && (
            <button
              type="button"
              className={styles.chart__maximize}
              aria-pressed={isFullscreen}
              aria-label={isFullscreen ? 'Restore chart size' : 'Maximize chart'}
              title={isFullscreen ? 'Restore' : 'Maximize'}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? <CornersInIcon size={14} weight="bold" /> : <CornersOutIcon size={14} weight="bold" />}
            </button>
          )}
        </div>
      </header>

      {/* The chart mounts into its own div; the tooltip is a SIBLING, never a child — React and
          Lightweight Charts must not manage the same element's children */}
      <div className={styles.chart__stage}>
        <div ref={containerRef} className={styles.chart__canvas} />
        {hoveredTrader && (
          <div
            className={styles.chart__traderTip}
            style={{ left: hoveredTrader.x + 14, top: Math.max(hoveredTrader.y - 12, 4) }}
          >
            <b>{hoveredTrader.name || `${hoveredTrader.address.slice(0, 6)}…${hoveredTrader.address.slice(-4)}`}</b>
            <span>
              {hoveredTrader.side === 1 ? 'Sold' : 'Bought'} {hoveredTrader.amountLabel} {quoteSymbol}
              {hoveredTrader.extra > 0 && ` · +${hoveredTrader.extra} more in this candle`}
            </span>
          </div>
        )}
      </div>

      <footer className={styles.chart__volume}>
        <div className={styles.chart__volumeHead}>
          <div>
            <span>Volume</span>
            <strong>{quoteFigure(volumeStats.total)}</strong>
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
          <span style={{ width: `${volumeStats.buyShare}%`, background: CSS_UP }} />
          <span style={{ width: `${100 - volumeStats.buyShare}%`, background: CSS_DOWN }} />
        </div>

        <div className={styles.chart__splitLegend}>
          <p style={{ color: CSS_UP }}>
            <b>{volumeStats.buys.count} buys</b>
            <small>
              {volumeStats.buys.traders} · {quoteFigure(volumeStats.buys.total)} ·{' '}
              {volumeStats.buyShare.toFixed(1)}%
            </small>
          </p>
          <p style={{ color: CSS_DOWN }}>
            <b>{volumeStats.sells.count} sells</b>
            <small>
              {volumeStats.sells.traders} · {quoteFigure(volumeStats.sells.total)} ·{' '}
              {(100 - volumeStats.buyShare).toFixed(1)}%
            </small>
          </p>
        </div>
      </footer>
    </section>
  )
}

export default LaunchChart
