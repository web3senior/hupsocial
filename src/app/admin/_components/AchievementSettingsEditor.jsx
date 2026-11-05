'use client'

import { useState } from 'react'
import { RARITIES, RARITY_LABELS } from '@/config/achievements'
import { ACHIEVEMENT_THRESHOLD_LABELS } from '@/lib/achievementSettings'
import styles from './AchievementsSection.module.scss'

export default function AchievementSettingsEditor({ item, disabled, onSave }) {
  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description)
  const [rarity, setRarity] = useState(item.rarity)
  const [listed, setListed] = useState(item.listed !== false)
  const [thresholds, setThresholds] = useState(() => Object.fromEntries(
    Object.keys(ACHIEVEMENT_THRESHOLD_LABELS).filter((key) => item[key] !== undefined).map((key) => [key, item[key]])
  ))

  return (
    <form onSubmit={(event) => {
      event.preventDefault()
      onSave({ action: 'settings', id: item.id, name, description, rarity, listed, thresholds })
    }}>
      <fieldset disabled={disabled} className={styles.achievementsAdmin__form}>
        <legend>Edit achievement</legend>
        <label htmlFor="achievement-name">Name</label>
        <input id="achievement-name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        <label htmlFor="achievement-description">Description</label>
        <textarea id="achievement-description" required maxLength={1000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
        <label htmlFor="achievement-rarity">Rarity</label>
        <select id="achievement-rarity" value={rarity} onChange={(event) => setRarity(event.target.value)}>
          {RARITIES.map((value) => <option key={value} value={value}>{RARITY_LABELS[value]}</option>)}
        </select>
        {Object.entries(thresholds).map(([key, value]) => (
          <div key={key} className={styles.achievementsAdmin__field}>
            <label htmlFor={`achievement-${key}`}>{ACHIEVEMENT_THRESHOLD_LABELS[key]}</label>
            <input id={`achievement-${key}`} type="number" required min={1} max={1000000} step={1} value={value}
              onChange={(event) => setThresholds((current) => ({ ...current, [key]: event.target.value === '' ? '' : Number(event.target.value) }))} />
          </div>
        ))}
        <label className={styles.achievementsAdmin__checkbox}>
          <input type="checkbox" checked={listed} onChange={(event) => setListed(event.target.checked)} />Visible in catalog and profiles
        </label>
        <p className={styles.achievementsAdmin__hint}>Hidden achievements can still be earned. Threshold changes apply on the next rule run. Update the description to match your thresholds. Existing awards are retained.</p>
        <div className={styles.achievementsAdmin__actions}>
          <button type="submit">Save settings</button>
          <button type="button" disabled={!item.overridden} onClick={() => onSave({ action: 'reset-settings', id: item.id })}>Reset to code defaults</button>
        </div>
      </fieldset>
    </form>
  )
}
