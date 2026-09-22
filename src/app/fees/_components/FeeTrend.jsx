'use client'

import { useLayoutEffect, useMemo, useState } from 'react'
import styles from './FeeTrend.module.scss'

const HEIGHT = 96
// Headroom above the peak; the floor is always zero so a steady fee draws as a steady line
const HEADROOM = 1.25

/**
 * Fee Trend
 * One action's cost per block, drawn as a single line on a zero floor. A stretched min-max scale
 * would turn a 1% wobble into a cliff, which is the opposite of what this chart is for. Hovering
 * reads that block's cost into the headline.
 * @param {Object} props
 * @param {number[]} props.values Cost per block, oldest first.
 * @param {(value: number) => string} props.format Formats one cost for display.
 * @param {string} props.label Accessible name for the chart.
 */
export default function FeeTrend({ values, format, label }) {
  const [hoverIndex, setHoverIndex] = useState(null)
  const [width, setWidth] = useState(0)
  const [node, setNode] = useState(null)

  useLayoutEffect(() => {
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  const geometry = useMemo(() => {
    if (values.length < 2 || width === 0) return null
    const peak = Math.max(...values) * HEADROOM || 1
    const x = (index) => (index / (values.length - 1)) * width
    const y = (value) => HEIGHT - (value / peak) * HEIGHT
    const line = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join('')
    return { line, x, y }
  }, [values, width])

  const index = hoverIndex ?? values.length - 1
  const low = Math.min(...values)
  const high = Math.max(...values)

  const onPointer = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1)
    setHoverIndex(Math.round(ratio * (values.length - 1)))
  }

  return (
    <figure className={styles.trend}>
      <figcaption className={styles.trend__head}>
        <span className={styles.trend__value}>{format(values[index])}</span>
        <span className={styles.trend__caption}>
          {hoverIndex === null
            ? `latest block · last ${values.length} blocks ranged ${format(low)} to ${format(high)}`
            : `${values.length - 1 - hoverIndex} blocks ago`}
        </span>
      </figcaption>

      <div
        ref={setNode}
        className={styles.trend__plot}
        style={{ height: HEIGHT }}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {geometry && (
          <svg width={width} height={HEIGHT} role="img" aria-label={`${label}: ${format(low)} to ${format(high)}`}>
            <line className={styles.trend__floor} x1="0" x2={width} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} />
            <path className={styles.trend__line} d={geometry.line} />
            {hoverIndex !== null && (
              <>
                <line className={styles.trend__cursor} x1={geometry.x(index)} x2={geometry.x(index)} y1="0" y2={HEIGHT} />
                <circle className={styles.trend__dot} cx={geometry.x(index)} cy={geometry.y(values[index])} r="4" />
              </>
            )}
          </svg>
        )}
      </div>
    </figure>
  )
}
