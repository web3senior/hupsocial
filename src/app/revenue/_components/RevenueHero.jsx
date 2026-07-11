'use client'

import { formatTokenAmount } from './formatTokenAmount'
import styles from './RevenueHero.module.scss'

const compactFormatter = new Intl.NumberFormat(undefined, { notation: 'compact' })

export default function RevenueHero({ totals, buyerCount, unitsSold, salesCount }) {
  return (
    <section className={styles.hero} aria-label="Revenue summary">
      <span className={styles.hero__eyebrow}>Total earned</span>

      <div className={styles.hero__amounts}>
        {totals.map((total) => (
          <span key={`${total.network_id}-${total.token}`} className={styles.hero__amount}>
            +{formatTokenAmount(total.total, total.decimals)}
            <span className={styles.hero__symbol}>{total.symbol}</span>
          </span>
        ))}
      </div>

      <div className={styles.hero__chips}>
        <span className={styles.hero__chip}>{compactFormatter.format(unitsSold)} sold</span>
        <span className={styles.hero__chip}>{compactFormatter.format(salesCount)} sales</span>
        <span className={styles.hero__chip}>{compactFormatter.format(buyerCount)} buyers</span>
      </div>
    </section>
  )
}
