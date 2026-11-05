'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import useSWR from 'swr'
import { Rise } from 'cube-motion/react'
import { CheckCircleIcon, LightningIcon, LockSimpleIcon, PushPinIcon, ShieldCheckIcon } from '@phosphor-icons/react'
import { RARITIES, RARITY_LABELS } from '@/config/achievements'
import { achievementBonusLabel } from '@/config/points'
import { getUserAchievements } from '@/lib/api'
import useAchievementCatalog from '@/hooks/useAchievementCatalog'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { profilePath } from '@/lib/username'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { ACHIEVEMENT_ICONS, DEFAULT_ACHIEVEMENT_ICON } from '@/components/achievements/achievementIcons'
import styles from './AchievementCatalog.module.scss'

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })
const earnedDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

// Rarest first: the list reads from the marks people chase down to the ones everyone collects.


const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'earned', label: 'Earned' },
  { value: 'locked', label: 'Not yet' },
]

// The three things people need before the list makes sense: where achievements come from, and
// that they last.
const FACTS = [
  { icon: LightningIcon, title: 'Automatic', text: 'Most unlock on their own from what you do on Hup.' },
  { icon: ShieldCheckIcon, title: 'Given by the team', text: 'A few are awarded by Hup for helping out.' },
  { icon: PushPinIcon, title: 'Yours for good', text: 'They stay on your profile. Feature one beside your name.' },
]

const howToEarn = (item) => {
  if (item.kind === 'granted') return 'Given by the Hup team'
  if (item.audience === 'agents') return 'Automatic · for agent accounts'
  return item.perSeason ? 'Automatic · once per season' : 'Automatic'
}

function holdersText(count, total) {
  if (!count) return 'No holders yet'
  const share = total > 0 ? count / total : 0
  const shareText = share > 0 && share < 0.001 ? '<0.1%' : percent.format(share)
  return `${compact.format(count)} ${count === 1 ? 'holder' : 'holders'} · ${shareText} of members`
}

/**
 * The /achievements catalog: how achievements work, the viewer's progress when a wallet is
 * connected, and every achievement rarest first. Rows render from the static catalog at once;
 * holder counts and the viewer's own awards fill in as they arrive, so nothing shifts or spins.
 */
export default function AchievementCatalog() {
  const { address, isConnected } = useActiveWallet()
  const [filter, setFilter] = useState('all')
  const { data: stats, error: statsError, catalog } = useAchievementCatalog()
  const ordered = [...catalog].sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity))
  const { data: mine } = useSWR(isConnected && address ? ['achievements:mine', address] : null, ([, wallet]) => getUserAchievements(wallet))

  // Every award per achievement: a seasonal one can be held once per season.
  const earnedById = useMemo(() => {
    const map = new Map()
    for (const row of mine?.earned ?? []) map.set(row.id, [...(map.get(row.id) ?? []), row])
    return map
  }, [mine])

  const knowsMine = Boolean(isConnected && mine)
  const earnedCount = catalog.filter((item) => earnedById.has(item.id)).length
  const activeFilter = knowsMine ? filter : 'all'
  const visible = ordered.filter((item) => activeFilter === 'all' || (activeFilter === 'earned') === earnedById.has(item.id))

  return (
    <div className={styles.catalog}>
      <ul className={styles.catalog__facts} aria-label="How achievements work">
        {FACTS.map(({ icon: Icon, title, text }) => (
          <li key={title} className={styles.catalog__fact}>
            <Icon className={styles.catalog__factIcon} size={20} weight="duotone" aria-hidden="true" />
            <div>
              <strong>{title}</strong>
              <p>{text}</p>
            </div>
          </li>
        ))}
      </ul>

      {isConnected ? (
        <section className={styles.progress} aria-label="Your progress">
          <div className={styles.progress__summary}>
            <span>
              <strong>{knowsMine ? earnedCount : '–'}</strong> of {catalog.length} earned
            </span>
            {earnedCount > 0 && (
              <Link className={styles.progress__link} href={profilePath(address)}>
                Feature one on your profile
              </Link>
            )}
          </div>
          <div
            className={styles.progress__track}
            role="progressbar"
            aria-label="Achievements earned"
            aria-valuemin={0}
            aria-valuemax={catalog.length}
            aria-valuenow={earnedCount}
            style={{ '--progress': `${(earnedCount / (catalog.length || 1)) * 100}%` }}
          />
        </section>
      ) : (
        <p className={styles.catalog__hint}>Connect a wallet to see which achievements you have earned.</p>
      )}

      <header className={styles.catalog__toolbar}>
        <h2>{knowsMine && activeFilter !== 'all' ? FILTERS.find((option) => option.value === activeFilter).label : 'All achievements'}</h2>
        {knowsMine && <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} label="Show" size="sm" />}
      </header>

      {statsError && <p className={styles.catalog__hint}>Holder counts are unavailable right now.</p>}

      {visible.length === 0 ? (
        <p className={styles.catalog__empty}>
          {activeFilter === 'earned' ? 'None yet. Publish your first post to unlock First Words.' : 'You have earned every achievement.'}
        </p>
      ) : (
        <Rise as="ul" className={styles.catalog__list} targets="children" key={activeFilter}>
          {visible.map((item) => {
            const Icon = ACHIEVEMENT_ICONS[item.icon] ?? DEFAULT_ACHIEVEMENT_ICON
            const awards = earnedById.get(item.id) ?? []
            const earned = awards.length > 0

            return (
              <li key={item.id} id={item.id} className={clsx(styles.achievementRow, styles[`achievementRow--${item.rarity}`], earned && styles['achievementRow--earned'])}>
                <span className={styles.achievementRow__icon} aria-hidden="true">
                  <Icon size={26} weight={earned ? 'fill' : 'duotone'} />
                </span>

                <div className={styles.achievementRow__body}>
                  <div className={styles.achievementRow__heading}>
                    <h3>{item.name}</h3>
                    <span className={styles.achievementRow__rarity}>{RARITY_LABELS[item.rarity]}</span>
                    {achievementBonusLabel(item.id) && <span className={styles.achievementRow__bonus}>{achievementBonusLabel(item.id)}</span>}
                  </div>
                  <p className={styles.achievementRow__description}>{item.description}</p>
                  <p className={styles.achievementRow__meta}>
                    {howToEarn(item)}
                    {stats && <> · {holdersText(stats.holders[item.id] ?? 0, stats.totalWallets)}</>}
                  </p>
                </div>

                {knowsMine && (
                  <div className={styles.achievementRow__status}>
                    {earned ? (
                      awards.map((award) => (
                        <span key={award.scope} className={styles.achievementRow__earned}>
                          <CheckCircleIcon size={16} weight="fill" aria-hidden="true" />
                          {award.scope ? `Season ${award.scope} · ` : 'Earned '}
                          {earnedDate.format(new Date(award.awardedAt))}
                        </span>
                      ))
                    ) : (
                      <span className={styles.achievementRow__locked}>
                        <LockSimpleIcon size={16} aria-hidden="true" />
                        Not yet
                      </span>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </Rise>
      )}
    </div>
  )
}
