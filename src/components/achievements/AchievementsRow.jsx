'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useConnection, useSignMessage } from 'wagmi'
import { achievementById, RARITIES } from '@/config/achievements'
import { sameAddress, isEvmAddress } from '@/lib/address'
import { featuredAchievementMessage } from '@/lib/achievements'
import { getAchievementCatalog, requestAuthNonce, setFeaturedAchievement } from '@/lib/api'
import AchievementBadge from '@/components/ui/AchievementBadge'
import AchievementDialog from './AchievementDialog'
import styles from './AchievementsRow.module.scss'

export default function AchievementsRow({ achievements, address: wallet, owner = false, onSaved }) {
  const dialogRef = useRef(null)
  const { address, chainId } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const [selected, setSelected] = useState(null)
  const [rarity, setRarity] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const earned = (achievements?.earned ?? []).filter((row) => achievementById(row.id)).slice().sort((a, b) =>
    RARITIES.indexOf(achievementById(b.id).rarity) - RARITIES.indexOf(achievementById(a.id).rarity) || b.awardedAt - a.awardedAt)
  const canFeature = owner && isEvmAddress(wallet) && sameAddress(address, wallet)

  const open = (row) => {
    setSelected(row)
    setError(null)
    dialogRef.current?.open()
    if (!rarity) getAchievementCatalog().then(setRarity).catch(() => {})
  }

  const feature = async (row) => {
    if (!canFeature) return
    setBusy(true)
    setError(null)
    try {
      const nonce = await requestAuthNonce(address)
      if (!nonce) throw new Error('Could not get a nonce')
      const claim = { address, achievementId: row?.id ?? null, scope: row?.scope ?? '', nonce, issuedAt: Date.now(), chainId }
      const signature = await signMessageAsync({ message: featuredAchievementMessage(claim) })
      const { featured } = await setFeaturedAchievement({ ...claim, signature })
      onSaved?.({ ...achievements, featured })
    } catch (err) {
      setError(err.shortMessage || err.message || 'Could not feature achievement')
    } finally {
      setBusy(false)
    }
  }

  if (!earned.length) return owner ? <p className={styles.achievementsRow__empty}>No achievements yet · <Link href="/achievements">See all achievements →</Link></p> : null
  return (
    <section className={styles.achievementsRow} aria-label="Earned achievements">
      <header className={styles.achievementsRow__heading}><h3>Achievements</h3><Link href="/achievements">See all →</Link></header>
      <div className={styles.achievementsRow__grid}>
        {earned.map((row) => <button type="button" key={`${row.id}:${row.scope}`} className={styles.achievementsRow__chip}
          aria-label={`${achievementById(row.id).name}${row.scope ? ` · Season ${row.scope}` : ''}`} onClick={() => open(row)}>
          <AchievementBadge featured={row} linked={false} size="lg" />
          {achievementById(row.id).name}{row.scope ? ` · Season ${row.scope}` : ''}
        </button>)}
      </div>
      <AchievementDialog ref={dialogRef} earned={selected} featured={achievements.featured} owner={canFeature} busy={busy} error={error} onFeature={feature}
        holders={selected && rarity ? (rarity.holders[selected.id] ?? 0) : undefined} totalWallets={rarity?.totalWallets} />
    </section>
  )
}
