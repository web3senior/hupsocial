import assert from 'node:assert/strict'
import test from 'node:test'
import { achievementSettingMessage, applyAchievementSettings, validateAchievementSetting } from '../../lib/achievementSettings.js'

const change = { action: 'settings', id: 'generous', name: 'Generous', description: 'Sent 25 tips.', rarity: 'epic', listed: true, thresholds: { threshold: 25 } }

test('settings validate supported thresholds and preserve code defaults', () => {
  const checked = validateAchievementSetting(change)
  const live = applyAchievementSettings({ generous: checked })
  assert.equal(live.find((item) => item.id === 'generous').threshold, 25)
  assert.equal(live.find((item) => item.id === 'generous').rarity, 'epic')
  assert.equal(applyAchievementSettings().find((item) => item.id === 'generous').threshold, 50)
  for (const threshold of [0, -1, 1.5, '25', null, 1000001]) {
    assert.throws(() => validateAchievementSetting({ ...change, thresholds: { threshold } }))
  }
  assert.throws(() => validateAchievementSetting({ ...change, thresholds: { threshold: 25, minDays: 5 } }))
  assert.throws(() => validateAchievementSetting({ ...change, thresholds: {} }))
  assert.throws(() => validateAchievementSetting({ ...change, rarity: 'unknown' }))
  assert.throws(() => validateAchievementSetting({ ...change, listed: 'false' }))
  assert.throws(() => validateAchievementSetting({ ...change, name: ' ' }))
  assert.throws(() => validateAchievementSetting({ ...change, id: 'unknown' }))
  assert.deepEqual(validateAchievementSetting({ action: 'reset-settings', id: 'generous' }), { action: 'reset-settings', id: 'generous' })
})

test('signed settings bind every editable field and the reset action', () => {
  const message = achievementSettingMessage(change, 'a'.repeat(32))
  for (const edit of [{ name: 'Changed' }, { description: 'Changed' }, { rarity: 'common' }, { listed: false }, { thresholds: { threshold: 26 } }, { id: 'rising-voice' }]) {
    assert.notEqual(achievementSettingMessage({ ...change, ...edit }, 'a'.repeat(32)), message)
  }
  assert.notEqual(achievementSettingMessage(change, 'b'.repeat(32)), message)
  assert.notEqual(achievementSettingMessage({ action: 'reset-settings', id: change.id }, 'a'.repeat(32)), message)
})
