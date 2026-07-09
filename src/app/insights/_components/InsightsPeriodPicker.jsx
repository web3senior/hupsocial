'use client'

import clsx from 'clsx'
import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react'
import NativePopover from '@/components/ui/NativePopover'
import styles from './InsightsPeriodPicker.module.scss'

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

const OPTIONS = [
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '14d', label: 'Last 14 days', days: 14 },
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '90d', label: 'Last 90 days', days: 90 },
]

function rangeLabel(days) {
  const end = new Date()
  const start = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000)
  return `${dateFormatter.format(start)} – ${dateFormatter.format(end)}`
}

export default function InsightsPeriodPicker({ value, onChange }) {
  const current = OPTIONS.find((o) => o.value === value) || OPTIONS[2]

  return (
    <NativePopover
      placement="bottom-end"
      trigger={
        <button type="button" className={styles.picker__trigger}>
          {current.label}
          <CaretDownIcon size={16} className={styles.picker__chevron} />
        </button>
      }
    >
      {({ close }) => (
        <div className={styles.picker__panel}>
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={clsx(styles.picker__option, option.value === value && styles['picker__option--active'])}
              onClick={() => {
                onChange(option.value)
                close()
              }}
            >
              <span>
                <span className={styles.picker__optionLabel}>{option.label}</span>
                <span className={styles.picker__optionRange}>{rangeLabel(option.days)}</span>
              </span>
              {option.value === value && <CheckIcon size={16} />}
            </button>
          ))}
        </div>
      )}
    </NativePopover>
  )
}
