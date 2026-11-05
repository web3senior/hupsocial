import { ACHIEVEMENTS, achievementById, RARITIES } from '../config/achievements.js'
import { AchievementError } from './achievements.js'

export const ACHIEVEMENT_THRESHOLD_LABELS = {
  threshold: 'Required count',
  minDays: 'Minimum days',
  minFollowers: 'Qualified followers',
}

export function validateAchievementSetting(body) {
  const item = achievementById(body?.id)
  if (!item) throw new AchievementError('Unknown achievement')
  if (body.action === 'reset-settings') return { action: body.action, id: item.id }
  if (body.action !== 'settings') throw new AchievementError('Invalid settings action')
  const { name, description, rarity, listed, thresholds } = body
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 ||
    typeof description !== 'string' || !description.trim() || description.trim().length > 1000 ||
    !RARITIES.includes(rarity) || typeof listed !== 'boolean' ||
    !thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds)) {
    throw new AchievementError('Enter a name, description, valid rarity and visibility')
  }
  const fields = Object.keys(ACHIEVEMENT_THRESHOLD_LABELS).filter((key) => item[key] !== undefined)
  if (Object.keys(thresholds).some((key) => !fields.includes(key))) throw new AchievementError('Unsupported threshold')
  const checked = {}
  for (const key of fields) {
    const value = thresholds[key]
    if (!Number.isSafeInteger(value) || value < 1 || value > 1000000) {
      throw new AchievementError(`${ACHIEVEMENT_THRESHOLD_LABELS[key]} must be a whole number between 1 and 1,000,000`)
    }
    checked[key] = value
  }
  return { action: 'settings', id: item.id, name: name.trim(), description: description.trim(), rarity, listed, thresholds: checked }
}

export const achievementSettingMessage = (change, nonce) => [
  'Update achievement settings on Hup',
  JSON.stringify({ ...validateAchievementSetting(change), nonce }),
].join('\n')

export function applyAchievementSettings(settings = {}) {
  return ACHIEVEMENTS.map((item) => {
    const setting = settings[item.id]
    if (!setting) return { ...item, listed: true, overridden: false }
    return { ...item, ...setting.thresholds, name: setting.name, description: setting.description, rarity: setting.rarity, listed: setting.listed, overridden: true }
  })
}
