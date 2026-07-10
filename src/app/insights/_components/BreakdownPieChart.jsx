'use client'

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'
import styles from './BreakdownPieChart.module.scss'

const numberFormatter = new Intl.NumberFormat(undefined, { notation: 'compact' })
const percentFormatter = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })

// Series ladder from the dataviz method: past 7 slices the tail folds into a gray "Other"
// instead of generating more hues.
const MAX_SLICES = 7
const OTHER_COLOR = '#898781'

function CustomTooltip({ active, payload, total }) {
  if (!active || !payload?.length) return null
  const slice = payload[0].payload

  return (
    <div className={styles.tooltip}>
      <span className={styles.tooltip__row}>
        <span className={styles.tooltip__dot} style={{ background: slice.fill }} />
        {slice.name}
        <strong>
          {percentFormatter.format(slice.count / total)} · {numberFormatter.format(slice.count)}
        </strong>
      </span>
    </div>
  )
}

/**
 * Shared donut primitive for the Insights breakdowns. `colorByNetwork` maps network_id → hue and
 * is built once from every breakdown on the page, so the same network wears the same color in
 * every pie (color follows the entity, never its rank within one chart).
 */
export default function BreakdownPieChart({ title, data = [], colorByNetwork, totalLabel, emptyLabel }) {
  const total = data.reduce((sum, slice) => sum + slice.count, 0)

  const sorted = [...data].sort((a, b) => b.count - a.count)
  const kept = sorted.slice(0, MAX_SLICES)
  const tail = sorted.slice(MAX_SLICES)
  const slices = (
    tail.length
      ? [...kept, { network_id: 'other', name: 'Other', count: tail.reduce((sum, slice) => sum + slice.count, 0) }]
      : kept
  ).map((slice) => ({
    ...slice,
    fill: slice.network_id === 'other' ? OTHER_COLOR : colorByNetwork.get(slice.network_id) || OTHER_COLOR,
  }))

  return (
    <div className={styles.breakdownChart}>
      <h3 className={styles.breakdownChart__title}>{title}</h3>
      {total === 0 ? (
        <p className={styles.breakdownChart__empty}>{emptyLabel}</p>
      ) : (
        <>
          <div className={styles.breakdownChart__canvas}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="count"
                  nameKey="name"
                  innerRadius="62%"
                  outerRadius="88%"
                  stroke="var(--surface)"
                  strokeWidth={2}
                  startAngle={90}
                  endAngle={-270}
                >
                  {slices.map((slice) => (
                    <Cell key={slice.network_id} fill={slice.fill} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip total={total} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className={styles.breakdownChart__center}>
              <span className={styles.breakdownChart__centerValue}>{numberFormatter.format(total)}</span>
              <span className={styles.breakdownChart__centerLabel}>{totalLabel}</span>
            </div>
          </div>
          <ul className={styles.breakdownChart__legend}>
            {slices.map((slice) => (
              <li key={slice.network_id} className={styles.breakdownChart__legendRow}>
                <span className={styles.breakdownChart__legendDot} style={{ background: slice.fill }} />
                <span className={styles.breakdownChart__legendName}>{slice.name}</span>
                <span className={styles.breakdownChart__legendShare}>{percentFormatter.format(slice.count / total)}</span>
                <span className={styles.breakdownChart__legendCount}>{numberFormatter.format(slice.count)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
