'use client'

import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import Profile from '@/components/Profile'
import styles from './PostTippers.module.scss'

// Compact ("1.2K") for large amounts, but sub-1 amounts keep their significant digits —
// compact's 2-fraction-digit rounding would collapse e.g. 0.00005 ETH to "0 ETH".
const formatTokenAmount = (n) =>
  new Intl.NumberFormat(undefined, n > 0 && n < 1 ? { maximumSignificantDigits: 4 } : { notation: 'compact', maximumFractionDigits: 2 }).format(n)

/**
 * Supporters strip on the post detail page — lists a post's tips (newest first) from the
 * cidex-indexed tips table via the post's tips API. Renders nothing until the post has at
 * least one tip.
 * @param {Object} props
 * @param {string|number} props.networkId The post's network id.
 * @param {string|number} props.postId The post's id.
 */
export default function PostTippers({ networkId, postId }) {
  const [tips, setTips] = useState(null)
  const [meta, setMeta] = useState(null)

  useEffect(() => {
    let cancelled = false

    fetch(`/api/v1/networks/${networkId}/${postId}/tips`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled || !body?.success) return
        setTips(body.data)
        setMeta(body.meta)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [networkId, postId])

  if (!tips || tips.length === 0) return null

  return (
    <section className={`${styles.tippers} animate fade`}>
      <header className={styles.tippers__header}>
        <h3>Supporters</h3>
        <span className={styles.tippers__total}>
          {new Intl.NumberFormat('en', { notation: 'compact' }).format(meta.total)}{' '}
          {meta.total === 1 ? 'tip' : 'tips'}
        </span>
      </header>

      <ul className={styles.tippers__list}>
        {tips.map((tip) => (
          <li key={`${tip.tx_hash}-${tip.tipped_at}`} className={styles.tippers__item}>
            <Profile variant="fullWithoutTime" creator={tip.wallet_address} networkId={networkId} />
            <span className={styles.tippers__amount}>
              +{formatTokenAmount(Number(formatUnits(BigInt(tip.amount), tip.decimals ?? 18)))} {tip.symbol || ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
