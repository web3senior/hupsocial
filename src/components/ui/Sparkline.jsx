'use client'

import { useId } from 'react'

/* Fixed drawing space; the SVG stretches to its CSS box with preserveAspectRatio="none",
 * and non-scaling-stroke keeps the 2px line from distorting under that stretch. */
const VIEW_WIDTH = 120
const VIEW_HEIGHT = 44
const PAD_Y = 3

/* Converts the value series into smoothed (Catmull-Rom → cubic Bezier) path points,
 * normalized so the series' own min/max fill the vertical space. */
function buildPath(values) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min

  const points = values.map((value, index) => {
    const x = values.length === 1 ? VIEW_WIDTH / 2 : (index / (values.length - 1)) * VIEW_WIDTH
    const y = span === 0 ? VIEW_HEIGHT / 2 : VIEW_HEIGHT - PAD_Y - ((value - min) / span) * (VIEW_HEIGHT - PAD_Y * 2)
    return [x, y]
  })

  if (points.length < 2) return null

  let path = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    path += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`
  }
  return path
}

/**
 * Decorative gradient sparkline for stat cards: no axes, no tooltip, aria-hidden —
 * the card's label and value carry the information, the line only sketches the trend.
 * @param {Object} props
 * @param {number[]} props.values The series; fewer than two points draws nothing.
 * @param {string} props.from Stroke color at the left edge.
 * @param {string} [props.to] Stroke color at the right edge; omit for a flat line, which is
 * what a directional (up/down) sparkline wants — there, the hue already means something, and
 * fading it across the card would only make the meaning harder to read.
 */
export default function Sparkline({ values, from, to = from, className }) {
  const gradientId = useId()
  const path = values?.length ? buildPath(values) : null

  if (!path) return null

  return (
    <svg
      className={className}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* userSpaceOnUse: a flat series draws a zero-height path, and an
          * objectBoundingBox gradient on a zero-height box renders nothing. */}
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={VIEW_WIDTH} y2="0">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      <path
        d={path}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
