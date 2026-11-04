'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Reveal } from 'cube-motion/react'
import { CheckCircleIcon, TrophyIcon } from '@phosphor-icons/react'
import { ACHIEVEMENTS, RARITIES } from '@/config/achievements'
import { getAchievementCatalog, getUserAchievements } from '@/lib/api'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { Spinner } from '@/components/Loading'
import { ACHIEVEMENT_ICONS, DEFAULT_ACHIEVEMENT_ICON } from '@/components/achievements/achievementIcons'
import badgeStyles from '@/components/ui/AchievementBadge.module.scss'
import styles from './page.module.scss'

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })

export default function AchievementCatalog() {
  const { address } = useActiveWallet()
  const [catalog, setCatalog] = useState(null)
  const [mine, setMine] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    getAchievementCatalog().then((data) => { if (active) { setCatalog(data); setError(null) } }).catch((err) => { if (active) setError(err.message) })
    return () => { active = false }
  }, [attempt])
  useEffect(() => {
    if (!address) return
    let active = true
    getUserAchievements(address).then((data) => { if (active) setMine({ address, ...data }) }).catch(() => { if (active) setMine(null) })
    return () => { active = false }
  }, [address])
  const earned = mine?.address === address ? mine.earned : []
  return (
    <main className={styles.achievements}>
      <header className={styles.achievements__header}>
        <span className={styles.achievements__eyebrow}><TrophyIcon size={16} weight="fill" /> YOUR HUP STORY</span>
        <h1>Small marks.<br />Lasting milestones.</h1>
        <p>Post your first words. Back someone with a tip. Help shape what comes next. Achievements celebrate your place in Hup.</p>
        {address && <span className={styles.achievements__progress}>{new Set(earned.map((row) => row.id)).size} / {ACHIEVEMENTS.length} achievements earned</span>}
      </header>
      {error && <p role="alert">{error} <button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></p>}
      {!catalog && !error && <Spinner label="Loading achievement counts" size={24} />}
      {[...RARITIES].reverse().map((rarity) => <section key={rarity} className={styles.achievements__section} aria-label={`${rarity} achievements`}>
        <h2>{rarity}</h2>
        <Reveal targets="children" className={styles.achievements__grid}>
          {(catalog?.catalog ?? ACHIEVEMENTS).filter((item) => item.rarity === rarity).map((item) => {
            const Icon = ACHIEVEMENT_ICONS[item.icon] ?? DEFAULT_ACHIEVEMENT_ICON
            const held = earned.filter((row) => row.id === item.id)
            const count = catalog?.holders[item.id] ?? 0
            return <article id={item.id} key={item.id} className={clsx(styles.achievements__card, held.length > 0 && styles['achievements__card--earned'])}>
              <span className={clsx(badgeStyles.achievementBadge, badgeStyles[`achievementBadge--${rarity}`], styles.achievements__icon)}><Icon size={32} weight="duotone" /></span>
              <div className={styles.achievements__cardHeading}><h3>{item.name}</h3>{held.length > 0 && <CheckCircleIcon size={20} weight="fill" aria-label="Earned" />}</div>
              <p>{item.description}</p>
              {held.map((row) => <span className={styles.achievements__earned} key={row.scope}>Earned{row.scope ? ` · Season ${row.scope}` : ''} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(row.awardedAt))}</span>)}
              <footer>{catalog ? `${compact.format(count)} holders · ${percent.format(catalog.totalWallets > 0 ? count / catalog.totalWallets : 0)} of wallets` : 'Holder counts unavailable'}</footer>
            </article>
          })}
        </Reveal>
      </section>)}
    </main>
  )
}
