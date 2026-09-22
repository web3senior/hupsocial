'use client'

import clsx from 'clsx'
import { CheckCircleIcon, CircleDashedIcon, CircleHalfIcon, ClockIcon, WarningIcon, XCircleIcon } from '@phosphor-icons/react'
import styles from './StatusBadge.module.scss'

const TONES = {
  pending: { icon: ClockIcon, label: 'Pending' },
  review: { icon: WarningIcon, label: 'In review' },
  progress: { icon: CircleHalfIcon, label: 'In progress' },
  idle: { icon: CircleDashedIcon, label: 'Not started' },
  cancelled: { icon: XCircleIcon, label: 'Cancelled' },
  approved: { icon: CheckCircleIcon, label: 'Approved' },
}

/**
 * One pill for every lifecycle state in the app: a tinted background, a filled icon and a
 * monospace label. Pass a `tone` and optionally your own `children` label.
 * @param {Object} props
 * @param {'pending'|'review'|'progress'|'idle'|'cancelled'|'approved'} props.tone
 * @param {'sm'|'md'} [props.size='sm']
 */
export default function StatusBadge({ tone = 'idle', size = 'sm', children, className }) {
  const meta = TONES[tone] ?? TONES.idle
  const Icon = meta.icon
  return (
    <span className={clsx(styles.badge, styles[`badge--${tone}`], styles[`badge--${size}`], className)}>
      <Icon weight={tone === 'idle' ? 'regular' : 'fill'} aria-hidden="true" />
      {children ?? meta.label}
    </span>
  )
}
