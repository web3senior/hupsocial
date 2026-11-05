'use client'

import { forwardRef, useId } from 'react'
import NativeDialog from '@/components/ui/NativeDialog'
import AchievementEmblem from './AchievementEmblem'
import { Spinner } from '@/components/Loading'
import useAchievementCatalog from '@/hooks/useAchievementCatalog'
import styles from './AchievementDialog.module.scss'

const AchievementDialog = forwardRef(function AchievementDialog({ earned, featured, owner, holders, totalWallets, busy, error, onFeature }, ref) {
  const { achievementById } = useAchievementCatalog()
  const titleId = useId()
  const item = achievementById(earned?.id)
  const selected = featured?.id === earned?.id && featured?.scope === earned?.scope
  return (
    <NativeDialog ref={ref} className={styles.achievementDialog} lightDismiss={!busy} aria-labelledby={titleId}
      onClose={(event) => event.stopPropagation()} onCancel={(event) => { event.stopPropagation(); if (busy) event.preventDefault() }}>
      {item && <>
        <div className={styles.achievementDialog__heading}>
          <AchievementEmblem item={item} size={56} />
          <h2 id={titleId}>{item.name}</h2>
          <button type="button" onClick={() => ref.current?.close()} disabled={busy} aria-label="Close achievement details">×</button>
        </div>
        <span className={styles.achievementDialog__rarity}>{item.rarity}{earned.scope ? ` · Season ${earned.scope}` : ''}</span>
        <p>{item.description}</p>
        {earned.awardedAt && <p>Earned {new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(earned.awardedAt))}</p>}
        {totalWallets > 0 && Number.isFinite(holders) && <p>{new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(holders / totalWallets)} of wallets</p>}
        {error && <p role="alert">{error}</p>}
        {owner && <button className={styles.achievementDialog__feature} type="button" disabled={busy} onClick={() => onFeature(selected ? null : earned)}>
          {busy && <Spinner size={16} />} {selected ? 'Remove featured achievement' : 'Feature beside my name'}
        </button>}
      </>}
    </NativeDialog>
  )
})

export default AchievementDialog
