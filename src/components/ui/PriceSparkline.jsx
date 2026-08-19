'use client'

import { useId, useMemo } from 'react'
import clsx from 'clsx'
import styles from './PriceSparkline.module.scss'

// Room above and below the extremes so a peak never sits flush against the edge
const PAD = 0.08

/**
 * Price Sparkline
 * One price series, drawn as an area with a 2px line on top. No axes, no gridlines, no legend —
 * a single series is named by the card around it, and at this size any chrome costs more room
 * than it repays.
 *
 * Distinct from ui/Sparkline, which is decorative chrome for stat tiles: that one takes a bare
 * value list, smooths it into a curve and hides itself from assistive tech. This one carries a
 * meaning — direction, and a baseline the change figure is measured from — so it keeps its
 * points honest (no smoothing between them) and describes itself.
 *
 * Direction is never carried by colour alone: every card that draws one of these also prints a
 * ↑/↓ and the signed percentage beside it, which is what makes a red/green encoding legible to
 * the ~8% of men who cannot separate that pair. The steps are per-theme tokens (--chart-up /
 * --chart-down) chosen against each surface rather than flipped — the green that reads well on
 * the dark surface sits at only 2.28:1 on white.
 *
 * The viewBox is unit-square and stretched, so `vector-effect: non-scaling-stroke` is doing real
 * work: without it the stroke and the baseline's dashes distort with the aspect ratio.
 */
const PriceSparkline = ({ points, direction = 'up', height = 32, baseline = false, className, label, title }) => {
  const geometry = useMemo(() => {
    if (!Array.isArray(points) || points.length < 2) return null

    const values = points.map((point) => point.p)
    const min = Math.min(...values)
    const max = Math.max(...values)
    // A dead-flat series would divide by zero; give it a hairline range so it draws mid-height
    const span = max - min || Math.abs(max) || 1
    const lo = min - span * PAD
    const hi = max + span * PAD

    const x = (index) => (index / (points.length - 1)) * 100
    const y = (value) => 100 - ((value - lo) / (hi - lo)) * 100

    const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.p).toFixed(2)}`).join('')
    // The fill closes to the floor rather than to the series' own minimum, so the shaded mass
    // reads as "value above zero" instead of an arbitrary wedge
    const area = `${line}L100,100L0,100Z`

    return { line, area, openY: y(values[0]) }
  }, [points])

  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, '')

  if (!geometry) return null

  return (
    <svg
      className={clsx(styles.priceSparkline, styles[`priceSparkline--${direction}`], className)}
      style={{ height }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={label || `Price trend, ${direction}`}
    >
      {/* A real SVG <title> rather than an HTML title attribute: it is the accessible name
          for the graphic and the browser shows it on hover, so the period the line covers is
          discoverable instead of assumed */}
      {title && <title>{title}</title>}

      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={geometry.area} fill={`url(#${gradientId})`} />

      {/* The period's opening price — what the card's change figure is measured against */}
      {baseline && (
        <line
          className={styles.priceSparkline__baseline}
          x1="0"
          x2="100"
          y1={geometry.openY}
          y2={geometry.openY}
          vectorEffect="non-scaling-stroke"
        />
      )}

      <path className={styles.priceSparkline__line} d={geometry.line} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export default PriceSparkline
