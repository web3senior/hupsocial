'use client'

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import styles from './TrendChart.module.scss'

const dayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const numberFormatter = new Intl.NumberFormat(undefined, { notation: 'compact' })

function formatTick(date) {
  return dayFormatter.format(new Date(`${date}T00:00:00`))
}

function CustomTooltip({ active, payload, label, series }) {
  if (!active || !payload?.length) return null

  return (
    <div className={styles.tooltip}>
      <span className={styles.tooltip__date}>{formatTick(label)}</span>
      {series.map((s) => {
        const entry = payload.find((p) => p.dataKey === s.key)
        if (!entry) return null
        return (
          <span key={s.key} className={styles.tooltip__row}>
            <span className={styles.tooltip__dot} style={{ background: s.color }} />
            {s.label}
            <strong>{numberFormatter.format(entry.value)}</strong>
          </span>
        )
      })}
    </div>
  )
}

/**
 * Shared line-chart primitive for the Insights page: pass one series (follower growth,
 * profile views) or several (reach) and it renders identically, per the dataviz "one axis,
 * legend for 2+ series" rule.
 */
export default function TrendChart({ title, data, series }) {
  return (
    <div className={styles.trendChart}>
      <h3 className={styles.trendChart__title}>{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatTick}
            stroke="var(--text-muted)"
            tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            stroke="var(--text-muted)"
            tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip content={<CustomTooltip series={series} />} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }} />}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={{ r: 4, fill: s.color, stroke: 'var(--surface)', strokeWidth: 2 }}
              activeDot={{ r: 5, fill: s.color, stroke: 'var(--surface)', strokeWidth: 2 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
