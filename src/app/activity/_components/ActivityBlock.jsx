'use client'

import clsx from 'clsx'
import { getChainIconUrl } from '@/lib/chains'
import { toRelativeTimestamp } from '@/lib/dateHelper'
import ActivityRow from './ActivityRow'
import { isFresh } from './activityModel'
import styles from './ActivityBlock.module.scss'

const blockNumberFormat = new Intl.NumberFormat('en')

/**
 * One block of the chain: a node on the rail, a header naming the height and the chain, and the
 * actions that landed in it. `isNew` plays the arrival animation exactly once — the stream clears
 * the flag after the paint, so scrolling or a tab switch never re-runs it.
 */
export default function ActivityBlock({ block, isNew }) {
  const fresh = isFresh(block.ts)
  const chainIcon = getChainIconUrl(block.networkId)

  return (
    <article
      className={clsx(styles.block, block.loose && styles['block--loose'], isNew && styles['block--enter'], fresh && styles['block--fresh'])}
      data-network={block.networkId ?? undefined}
    >
      <div className={styles.block__rail} aria-hidden="true">
        <span className={styles.block__node} />
      </div>

      <div className={styles.block__body}>
        <div className={styles.block__head}>
          <span className={styles.block__height}>
            {block.blockNumber === null ? 'off-block' : `#${blockNumberFormat.format(block.blockNumber)}`}
          </span>
          {/* The mark carries the chain at a glance, the name settles it — chains with no logo
              configured show the name alone rather than an empty slot. */}
          {block.networkName && (
            <span className={styles.block__chain}>
              {chainIcon && <img src={chainIcon} alt="" width={12} height={12} loading="lazy" />}
              {block.networkName}
            </span>
          )}
          <span className={styles.block__count}>
            {block.rows.length > 1 && `${block.rows.length} actions · `}
            {toRelativeTimestamp(block.ts)}
          </span>
        </div>

        <div className={styles.block__card}>
          {block.rows.map((row) => (
            <ActivityRow key={row.uid} row={row} />
          ))}
        </div>
      </div>
    </article>
  )
}

/** The rail continues through a run of heights nothing happened in. */
export function BlockGap({ skipped, networkId }) {
  return (
    <div className={styles.gap} data-network={networkId ?? undefined}>
      <div className={styles.gap__rail} aria-hidden="true" />
      <p className={styles.gap__label}>⋯ {blockNumberFormat.format(skipped)} blocks</p>
    </div>
  )
}
