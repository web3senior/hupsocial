'use client'

import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { getChainIconUrl } from '@/lib/chains'
import { toRelativeTimestamp } from '@/lib/dateHelper'
import { useProfile } from '@/hooks/useProfile'
import { amountOf, getKindMeta, hrefOf, shortAddress } from './activityModel'
import styles from './ActivityTape.module.scss'

/**
 * The same feed at one line per action — a trading tape. No previews, no thumbnails, no receipts:
 * time, height, verb, actor, value, chain, in fixed columns so the eye can run down any of them.
 */
export default function ActivityTape({ rows, newUids }) {
  return (
    <div className={styles.tape} role="table" aria-label="Activity tape">
      {rows.map((row) => (
        <TapeRow key={row.uid} row={row} isNew={newUids.has(row.uid)} />
      ))}
    </div>
  )
}

function TapeRow({ row, isNew }) {
  const router = useRouter()
  const meta = getKindMeta(row.kind)
  const Icon = meta.icon
  const href = hrefOf(row)
  const amount = amountOf(row)
  const { profile } = useProfile(row.actor)
  const resolved = profile?.fullName || (profile?.name === 'new-user' ? null : profile?.name)
  const chainIcon = getChainIconUrl(row.network_id)

  return (
    <div
      className={clsx(styles.tape__row, href && styles['tape__row--clickable'], isNew && styles['tape__row--enter'])}
      data-tone={meta.tone}
      role={href ? 'link' : 'row'}
      tabIndex={href ? 0 : undefined}
      onClick={() => href && router.push(href)}
      onKeyDown={(event) => {
        if (!href || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        router.push(href)
      }}
    >
      <span className={styles.tape__time}>{toRelativeTimestamp(row.ts)}</span>
      <span className={styles.tape__block} data-network={row.network_id ?? undefined}>
        {row.block_number === null ? '—' : `#${row.block_number}`}
      </span>
      <span className={styles.tape__icon} title={meta.label}>
        <Icon size={14} weight={meta.weight || 'regular'} />
      </span>
      <span className={styles.tape__verb}>{meta.label}</span>
      <span className={styles.tape__actor}>{resolved || shortAddress(row.actor)}</span>
      <span className={styles.tape__value}>{amount || subjectOf(row)}</span>
      <span className={styles.tape__chain} title={row.network_name}>
        {chainIcon && <img src={chainIcon} alt="" width={12} height={12} loading="lazy" />}
        {row.network_name}
      </span>
    </div>
  )
}

/** Rows that move no value still have a subject worth a column: a pair, a market, a person. */
function subjectOf(row) {
  if (row.kind === 'swap') return `${row.meta?.token_in_symbol || '?'} → ${row.meta?.token_out_symbol || '?'}`
  if (row.kind === 'follow' && row.subject) return shortAddress(row.subject)
  if (row.entity_type === 'post' && row.entity_id) return `post #${row.entity_id}`
  return ''
}
