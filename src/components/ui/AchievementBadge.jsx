'use client'

import Link from 'next/link'
import clsx from 'clsx'
import useAchievementCatalog from '@/hooks/useAchievementCatalog'
import AchievementEmblem from '@/components/achievements/AchievementEmblem'
import styles from './AchievementBadge.module.scss'

// The size of the chain and premium marks it sits in a row with
const EMBLEM_SIZE = { sm: 16, lg: 22 }

/**
 * Achievement Badge
 * The achievement a wallet features beside its name, drawn with the same AchievementEmblem as
 * every other surface. Linked, it opens that achievement on /achievements; callers already inside
 * a link pass `linked={false}`, since an anchor cannot hold another.
 */
export default function AchievementBadge({ featured, size = 'sm', linked = true, className }) {
  const { achievementById } = useAchievementCatalog()
  const item = achievementById(featured?.id)
  if (!item) return null
  const label = `${item.name}${featured.scope ? ` · Season ${featured.scope}` : ''}`
  const emblem = <AchievementEmblem item={item} size={EMBLEM_SIZE[size] ?? EMBLEM_SIZE.sm} label={linked ? undefined : label} />
  return linked ? (
    <Link className={clsx(styles.achievementBadge, className)} href={`/achievements#${item.id}`} aria-label={label} title={label}>
      {emblem}
    </Link>
  ) : (
    <span className={clsx(styles.achievementBadge, className)}>{emblem}</span>
  )
}
