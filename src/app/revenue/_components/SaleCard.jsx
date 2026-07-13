'use client'

import Link from 'next/link'
import { toRelativeTimestamp } from '@/lib/dateHelper'
import { formatTokenAmount } from './formatTokenAmount'
import styles from './SaleCard.module.scss'

function excerptOf(content) {
  if (!content || typeof content !== 'object') return typeof content === 'string' ? content : ''
  const textElement = content.elements?.find((el) => el.type === 'text')
  return textElement?.data?.text || ''
}

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export default function SaleCard({ sale }) {
  const excerpt = excerptOf(sale.content)

  return (
    <li className={styles.saleCard}>
      <span className={styles.saleCard__amount}>
        +{formatTokenAmount(sale.amount, sale.decimals)}
        <span className={styles.saleCard__symbol}>{sale.symbol}</span>
      </span>

      <span className={styles.saleCard__details}>
        <Link href={`/networks/${sale.network_id}/${sale.post_id}`} className={styles.saleCard__post}>
          {excerpt || `Post #${sale.post_id}`}
        </Link>
        <span className={styles.saleCard__meta}>
          {sale.quantity > 1 && <span className={styles.saleCard__quantity}>×{sale.quantity}</span>}
          <span>{shortAddress(sale.buyer)}</span>
          <span aria-hidden="true">·</span>
          <span>{toRelativeTimestamp(sale.sold_at)}</span>
          {sale.network_name && <span className={styles.saleCard__network}>{sale.network_name}</span>}
        </span>
      </span>
    </li>
  )
}
