'use client'

import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { TargetIcon } from '@phosphor-icons/react'
import { OUTCOME_COLORS, marketStatus, parseJsonArray, toRelative } from '@/lib/predict'
import useStakeToken, { formatStake } from '@/hooks/useStakeToken'
import styles from './PredictCard.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

/**
 * Predict Card
 * Compact prediction-market card rendered inside posts. The content JSON only carries a
 * reference ({ marketId, chainId }); the market itself is resolved live from the indexed
 * API so pools, status, and the winner stay current wherever the post is shown.
 * @param {Object} props
 * @param {Object} props.marketRef Reference payload from the post's content JSON.
 */
export default function PredictCard({ marketRef }) {
  const chainId = Number(marketRef?.chainId)
  const marketId = marketRef?.marketId

  const { data: detail } = useSWR(
    chainId && marketId ? `/api/v1/predict/${marketId}?networkId=${chainId}` : null,
    fetcher,
  )

  const market = detail?.data?.market
  const { symbol, decimals } = useStakeToken(chainId, market?.token, Boolean(Number(market?.is_token_lsp7)))

  if (!market) return null

  const status = marketStatus(market)
  const outcomes = parseJsonArray(market.outcome_labels)
  const pools = parseJsonArray(market.outcome_pools)
  const totalPool = BigInt(market.total_pool || '0')
  const volume = formatStake(market.total_pool, decimals)

  return (
    <Link
      href={`/predict/${chainId}/${marketId}`}
      className={styles.predictCard}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.predictCard__top}>
        <span className={styles.predictCard__kind}>
          <TargetIcon size={14} />
          Prediction market
        </span>
        <span className={clsx(styles.predictCard__badge, styles[`predictCard__badge--${status.key}`])}>{status.label}</span>
      </div>

      <h4 className={styles.predictCard__title}>{market.title || 'Untitled market'}</h4>

      <div className={styles.predictCard__outcomes}>
        {Array.from({ length: Math.min(Number(market.outcome_count), 4) }, (_, index) => {
          const pool = BigInt(pools[index] ?? '0')
          const share = totalPool > 0n ? Number((pool * 10000n) / totalPool) / 100 : 0
          const isWinner = status.key === 'resolved' && Number(market.winning_outcome) === index

          return (
            <div key={index} className={styles.predictCard__outcome}>
              <span
                className={styles.predictCard__outcomeFill}
                style={{ width: `${share}%`, backgroundColor: OUTCOME_COLORS[index % OUTCOME_COLORS.length] }}
                aria-hidden
              />
              <span className={styles.predictCard__outcomeLabel}>
                {outcomes[index]?.label || `Outcome #${index + 1}`}
                {isWinner && ' 🏆'}
              </span>
              {totalPool > 0n && <span className={styles.predictCard__outcomeShare}>{share.toFixed(0)}%</span>}
            </div>
          )
        })}
        {Number(market.outcome_count) > 4 && (
          <span className={styles.predictCard__more}>+{Number(market.outcome_count) - 4} more</span>
        )}
      </div>

      <div className={styles.predictCard__footer}>
        {volume !== null && (
          <span>
            {volume} {symbol} pot
          </span>
        )}
        {status.key === 'open' ? <span>closes {toRelative(market.betting_deadline)}</span> : null}
        <span className={styles.predictCard__cta}>{status.key === 'open' ? 'Place your bet' : 'View market'}</span>
      </div>
    </Link>
  )
}
