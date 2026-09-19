'use client'

import clsx from 'clsx'
import { useRouter } from 'next/navigation'
import { CaretDownIcon, CheckIcon, SealCheckIcon } from '@phosphor-icons/react'
import NativePopover from '@/components/ui/NativePopover'
import styles from './InsightsPeriodPicker.module.scss'

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

// A `premium` option is a window past the free ceiling — see FREE_INSIGHTS_DAYS in
// lib/premium.js, which the route enforces. The flag here only decides how the list looks.
const OPTIONS = [
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '14d', label: 'Last 14 days', days: 14 },
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '90d', label: 'Last 90 days', days: 90, premium: true },
  { value: '365d', label: 'Last 12 months', days: 365, premium: true },
]

function rangeLabel(days) {
  const end = new Date()
  const start = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000)
  return `${dateFormatter.format(start)} – ${dateFormatter.format(end)}`
}

export default function InsightsPeriodPicker({ value, onChange, isPremium = false }) {
  const router = useRouter()
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
                if (option.premium && !isPremium) {
                  close()
                  router.push('/premium')
                  return
                }
                onChange(option.value)
                close()
              }}
            >
              <span>
                <span className={styles.picker__optionLabel}>{option.label}</span>
                <span className={styles.picker__optionRange}>{rangeLabel(option.days)}</span>
              </span>
              {option.premium && !isPremium ? (
                <SealCheckIcon size={16} weight="fill" className={styles.picker__locked} />
              ) : (
                option.value === value && <CheckIcon size={16} />
              )}
            </button>
          ))}
        </div>
      )}
    </NativePopover>
  )
}
