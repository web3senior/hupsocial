'use client'

import clsx from 'clsx'
import { formatPower, formatShare } from '@/lib/communityProposal'
import { CheckCircleIcon } from '@phosphor-icons/react'
import styles from './ResultsBar.module.scss'

/**
 * Results Bar
 * One row per option: label, share of the votes cast, weight, and a bar. The leader is only
 * highlighted once voting has ended — highlighting it mid-vote would steer the votes it reports.
 * @param {Object} props
 * @param {Array<{label: string, votes: bigint, share: number, isLeader: boolean}>} props.rows From tallyRows().
 * @param {number} props.decimals Voting-power decimals.
 * @param {boolean} [props.settled] Voting has ended.
 * @param {number|null} [props.viewerOption] The option the viewer chose.
 * @param {boolean} [props.compact] Card density.
 */
export default function ResultsBar({ rows, decimals, settled = false, viewerOption = null, compact = false }) {
  return (
    <ul className={clsx(styles.results, compact && styles['results--compact'])}>
      {rows.map((row, index) => {
        const winning = settled && row.isLeader
        return (
          <li key={index} className={clsx(styles.results__row, winning && styles['results__row--winning'])}>
            <div className={styles.results__head}>
              <span className={styles.results__label}>
                {row.label}
                {viewerOption === index && (
                  <span className={styles.results__mine}>
                    <CheckCircleIcon size={12} weight="fill" aria-hidden="true" />
                    Your vote
                  </span>
                )}
              </span>
              <span className={styles.results__value}>
                {formatShare(row.share)}
                {!compact && <span className={styles.results__weight}> · {formatPower(row.votes, decimals)}</span>}
              </span>
            </div>
            <div
              className={styles.results__track}
              role="meter"
              aria-label={row.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(row.share * 100)}
            >
              <div className={styles.results__fill} style={{ width: `${Math.min(100, row.share * 100)}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
