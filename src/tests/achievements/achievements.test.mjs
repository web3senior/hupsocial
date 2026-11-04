import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { ACHIEVEMENTS, achievementById } from '../../config/achievements.js'
import { AUTO_ACHIEVEMENT_IDS, achievementAdminMessage, featuredAchievementMessage, validateAchievementAdminClaim, validateAchievementScope, validateFeaturedAchievementClaim } from '../../lib/achievements.js'

const address = `0x${'ab'.repeat(20)}`
const now = 1_800_000_000_000
const claim = { address, achievementId: 'og', scope: '', nonce: 'a'.repeat(32), issuedAt: now, signature: '0x1234', chainId: 42 }

test('catalog identifiers are valid, unique and all automatic achievements have rule keys', async () => {
  assert.equal(new Set(ACHIEVEMENTS.map((item) => item.id)).size, ACHIEVEMENTS.length)
  const rules = await readFile(new URL('../../lib/achievementRules.js', import.meta.url), 'utf8')
  for (const item of ACHIEVEMENTS) {
    assert.match(item.id, /^[a-z0-9-]{1,48}$/)
    if (item.kind === 'auto') {
      assert.ok(AUTO_ACHIEVEMENT_IDS.includes(item.id))
      assert.match(rules, new RegExp(`(?:'${item.id}'|${item.id}):`))
    }
  }
  assert.equal(achievementById('missing'), null)
})

test('featured message is deterministic, normalizes the wallet, and binds every field', () => {
  assert.equal(featuredAchievementMessage(claim), featuredAchievementMessage({ ...claim, address: `0x${'AB'.repeat(20)}` }))
  for (const change of [{ achievementId: null }, { scope: '1' }, { nonce: 'b'.repeat(32) }, { issuedAt: now + 1 }]) {
    assert.notEqual(featuredAchievementMessage(claim), featuredAchievementMessage({ ...claim, ...change }))
  }
})

test('featured claims reject stale, future, malformed, unknown and invalidly scoped requests', () => {
  assert.equal(validateFeaturedAchievementClaim(claim, now).address, address)
  for (const change of [{ address: 'no' }, { issuedAt: now - 300001 }, { issuedAt: now + 300001 }, { issuedAt: '1800000000000' },
    { nonce: 'bad' }, { signature: '' }, { signature: 'a'.repeat(16385) }, { achievementId: 'unknown' }, { achievementId: undefined },
    { scope: '1' }, { achievementId: 'season-top-10', scope: '' }, { achievementId: 'season-top-10', scope: '999' },
    { achievementId: null, scope: '1' }]) {
    assert.throws(() => validateFeaturedAchievementClaim({ ...claim, ...change }, now))
  }
  assert.equal(validateFeaturedAchievementClaim({ ...claim, achievementId: null }, now).achievementId, null)
  assert.equal(validateAchievementScope('season-top-10', '1'), '1')
})

test('admin signature binds action, target, achievement, scope, note, notifications and nonce', () => {
  const admin = { action: 'grant', wallet: address, id: 'bug-hunter', scope: '', note: 'Confirmed', notify: true, nonce: 'a'.repeat(32), signature: '0x12' }
  assert.equal(achievementAdminMessage(admin), achievementAdminMessage({ ...admin }))
  for (const change of [{ action: 'revoke' }, { wallet: `0x${'cd'.repeat(20)}` }, { id: 'og' }, { scope: '1' }, { note: 'Other' }, { notify: false }, { nonce: 'b'.repeat(32) }]) {
    assert.notEqual(achievementAdminMessage(admin), achievementAdminMessage({ ...admin, ...change }))
  }
  assert.equal(validateAchievementAdminClaim(admin).id, 'bug-hunter')
  assert.equal(validateAchievementAdminClaim({ ...admin, action: 'run', id: null }).id, null)
  for (const change of [{ action: 'delete' }, { notify: 'false' }, { note: 'x'.repeat(256) }, { action: 'run', id: 'early-tester' }, { wallet: 'bad' }, { nonce: 'expired' }]) {
    assert.throws(() => validateAchievementAdminClaim({ ...admin, ...change }))
  }
})
