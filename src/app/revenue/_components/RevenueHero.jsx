'use client'

import { formatTokenAmount } from './formatTokenAmount'
import styles from './RevenueHero.module.scss'

const compactFormatter = new Intl.NumberFormat(undefined, { notation: 'compact' })

export default function RevenueHero({ totals, buyerCount, unitsSold, salesCount }) {
  return (
    <section className={styles.hero} aria-label="Revenue summary">
      <span className={styles.hero__eyebrow}>Total earned</span>

      <ul className={styles.hero__grid}>
        {totals.map((total) => (
          <li key={`${total.network_id}-${total.token}`} className={styles.hero__card}>
            <span className={styles.hero__symbol}>{total.symbol}</span>
            <span className={styles.hero__amount}>{formatTokenAmount(total.total, total.decimals)}</span>
            <span className={styles.hero__cardMeta}>
              {compactFormatter.format(total.units)} sold · {compactFormatter.format(total.sales)}{' '}
              {total.sales === 1 ? 'sale' : 'sales'}
            </span>
          </li>
        ))}
      </ul>

      <p className={styles.hero__meta}>
        {compactFormatter.format(unitsSold)} sold · {compactFormatter.format(salesCount)} sales ·{' '}
        {compactFormatter.format(buyerCount)} buyers
      </p>
    </section>
  )
}
