'use client'

import { NotePencilIcon, TagIcon, HandCoinsIcon } from '@phosphor-icons/react'
import styles from './EarnSteps.module.scss'

const STEPS = [
  {
    icon: NotePencilIcon,
    label: 'Create content',
    description: 'Post art, photos, or anything worth owning',
  },
  {
    icon: TagIcon,
    label: 'List for sale',
    description: 'Set your price and list it on the Bazaar',
  },
  {
    icon: HandCoinsIcon,
    label: 'Earn money',
    description: 'Every sale pays out straight to your wallet',
  },
]

export default function EarnSteps() {
  return (
    <ol className={styles.steps} aria-label="How to earn">
      {STEPS.map(({ icon: Icon, label, description }) => (
        <li key={label} className={styles.steps__item}>
          <span className={styles.steps__icon}>
            <Icon size={26} weight="fill" />
          </span>
          <span className={styles.steps__label}>{label}</span>
          <span className={styles.steps__description}>{description}</span>
        </li>
      ))}
    </ol>
  )
}
