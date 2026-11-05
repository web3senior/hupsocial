'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { useConnection, useSignMessage } from 'wagmi'
import { COMMUNITY_STANDING, RARITIES } from '@/config/achievements'
import useRailScroll from '@/hooks/useRailScroll'
import useAchievementCatalog from '@/hooks/useAchievementCatalog'
import { sameAddress, isEvmAddress } from '@/lib/address'
import { featuredAchievementMessage } from '@/lib/achievements'
import { getAchievementCatalog, requestAuthNonce, setFeaturedAchievement } from '@/lib/api'
import AchievementCard from './AchievementCard'
import AchievementDialog from './AchievementDialog'
import styles from './AchievementsRow.module.scss'

export default function AchievementsRow({ achievements, address: wallet, owner = false, onSaved }) {
  const { achievementById } = useAchievementCatalog()
  const dialogRef = useRef(null)
  const trackRef = useRef(null)
  const { address, chainId } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const [selected, setSelected] = useState(null)
  const [rarity, setRarity] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const earned = (achievements?.earned ?? []).filter((row) => achievementById(row.id)).slice().sort((a, b) =>
    RARITIES.indexOf(achievementById(b.id).rarity) - RARITIES.indexOf(achievementById(a.id).rarity) || b.awardedAt - a.awardedAt)
  const canFeature = owner && isEvmAddress(wallet) && sameAddress(address, wallet)
  const { canScrollLeft, canScrollRight, scrollByPage } = useRailScroll(trackRef, [achievements, earned.length])

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

  if (!earned.length) {
    if (!owner) return null
    // Standing is the community's call, so its owner is told plainly rather than left guessing.
    return achievements?.hidden
      ? <p className={styles.achievementsRow__empty}>Your achievements are hidden while {COMMUNITY_STANDING.blockedByOg} or more OG members have you blocked. They come back when enough of them unblock you.</p>
      : <p className={styles.achievementsRow__empty}>No achievements yet · <Link href="/achievements">See all achievements →</Link></p>
  }
  return (
    <section className={styles.achievementsRow} aria-label="Earned achievements">
      <header className={styles.achievementsRow__heading}>
        <h3>Achievements</h3>
        <div className={styles.achievementsRow__actions}>
          <Link href="/achievements">See all →</Link>
          {(canScrollLeft || canScrollRight) && (
            <div className={styles.achievementsRow__arrows}>
              <button type="button" className={styles.achievementsRow__arrow} aria-label="Scroll achievements left" disabled={!canScrollLeft} onClick={() => scrollByPage(-1)}>
                <CaretLeftIcon size={12} aria-hidden="true" />
              </button>
              <button type="button" className={styles.achievementsRow__arrow} aria-label="Scroll achievements right" disabled={!canScrollRight} onClick={() => scrollByPage(1)}>
                <CaretRightIcon size={12} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </header>
      <div ref={trackRef} className={styles.achievementsRow__track} data-scroll-left={canScrollLeft} data-scroll-right={canScrollRight} tabIndex={0} role="region" aria-label="Achievements list">
        {earned.map((row) => {
          const item = achievementById(row.id)
          return (
            <AchievementCard key={`${row.id}:${row.scope}`} item={item} size="md" as="button" scope={row.scope}
              className={styles.achievementsRow__card} onClick={() => open(row)} />
          )
        })}
      </div>
      <AchievementDialog ref={dialogRef} earned={selected} featured={achievements.featured} owner={canFeature} busy={busy} error={error} onFeature={feature}
        holders={selected && rarity ? (rarity.holders[selected.id] ?? 0) : undefined} totalWallets={rarity?.totalWallets} />
    </section>
  )
}
