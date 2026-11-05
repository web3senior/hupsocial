'use client'

import Link from 'next/link'
import clsx from 'clsx'
import useAchievementCatalog from '@/hooks/useAchievementCatalog'
import { ACHIEVEMENT_ICONS, DEFAULT_ACHIEVEMENT_ICON } from '@/components/achievements/achievementIcons'
import styles from './AchievementBadge.module.scss'

export default function AchievementBadge({ featured, size = 'sm', linked = true, className }) {
  const { achievementById } = useAchievementCatalog()
  const item = achievementById(featured?.id)
  if (!item) return null
  const Icon = ACHIEVEMENT_ICONS[item.icon] ?? DEFAULT_ACHIEVEMENT_ICON
  const label = `${item.name}${featured.scope ? ` · Season ${featured.scope}` : ''}`
  const props = { className: clsx(styles.achievementBadge, styles[`achievementBadge--${item.rarity}`], className), title: label, 'aria-label': label }
  const icon = <Icon size={size === 'lg' ? 18 : 14} weight="fill" aria-hidden="true" />
  return linked ? <Link {...props} href={`/achievements#${item.id}`}>{icon}</Link> : <span {...props} role="img">{icon}</span>
}
