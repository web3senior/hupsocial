import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import mysql from 'mysql2/promise'

// Explicit opt-in. Fixtures use a fresh local database and never alter application data.
test('achievement storage, concurrent awards, rules, nonce consumption and migration guards', { skip: process.env.ACHIEVEMENTS_TEST_DB !== '1' }, async (t) => {
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST), 'Integration tests require a local database')
  const database = `hup_achievements_test_${process.pid}`
  assert.match(database, /^hup_achievements_test_\d+$/)
  const admin = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, port: Number(process.env.DB_PORT || 3306) })
  let db
  try {
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`)
    process.env.DB_NAME = database
    db = (await import('../../lib/db.js')).default
    const service = await import('../../lib/achievementsServer.js')
    const rules = (await import('../../lib/achievementRules.js')).RULES
    const wallet = (n) => `0x${n.toString(16).padStart(40, '0')}`
    const a = wallet(1)
    const b = wallet(2)
    await db.query('CREATE TABLE users (wallet_address VARCHAR(64) PRIMARY KEY, name TEXT, username TEXT, profileImage TEXT, tags TEXT, created_at DATETIME)')
    await db.query('CREATE TABLE posts (wallet_address VARCHAR(64), is_comment BIGINT NULL, is_repost BIGINT NULL)')
    await db.query('CREATE TABLE post_likes (liker_address VARCHAR(64))')
    await db.query('CREATE TABLE follows (follower_address VARCHAR(42), followed_address VARCHAR(42), is_following TINYINT)')
    await db.query('CREATE TABLE tips (tipper VARCHAR(42))')
    await db.query('CREATE TABLE hosted_agents (agent_address VARCHAR(42))')
    await db.query('CREATE TABLE nonces (nonce VARCHAR(64), wallet_address VARCHAR(42), expires_at DATETIME)')
    await db.query('CREATE TABLE notifications (recipient_wallet_address VARCHAR(64), action_type VARCHAR(80), entity_type VARCHAR(80), entity_id VARCHAR(191), title VARCHAR(191), message TEXT, action_url VARCHAR(500), email_status VARCHAR(20))')
    const migration = (await readFile(new URL('../../../deploy/migrations/20261105-user-achievements.sql', import.meta.url), 'utf8')).replace(/^--.*$/gm, '')
    for (const sql of migration.split(';').filter((sql) => sql.trim())) await db.query(sql)

    await t.test('concurrent grants preserve the first award and notify once', async () => {
      const awards = await Promise.all(Array.from({ length: 3 }, () => service.awardAchievement({ wallets: [a, a], id: 'bug-hunter', source: 'admin', grantedBy: b })))
      assert.equal(awards.flat().length, 1)
      const [[count]] = await db.query('SELECT COUNT(*) AS n FROM notifications')
      assert.equal(count.n, 1)
      assert.equal((await service.readAchievements(a))[0].source, 'admin')
      assert.equal((await service.readHolderCounts())['bug-hunter'], 1)
    })

    await t.test('feature requires ownership; a failed claim rolls its nonce back; successful claims consume it', async () => {
      const nonce = 'a'.repeat(32)
      await db.execute('INSERT INTO nonces VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))', [nonce, a])
      await assert.rejects(service.setFeaturedAchievement({ wallet: a, id: 'og', nonce }), { status: 403 })
      await service.setFeaturedAchievement({ wallet: a, id: 'bug-hunter', nonce })
      assert.deepEqual(await service.readFeaturedAchievement(a), { id: 'bug-hunter', scope: '' })
      await assert.rejects(service.setFeaturedAchievement({ wallet: a, id: null, nonce }), { status: 401 })
      await service.revokeAchievement({ wallet: a, id: 'bug-hunter' })
      assert.equal(await service.readFeaturedAchievement(a), null)
      assert.equal((await service.readHolderCounts())['bug-hunter'], undefined)
    })

    await t.test('automatic rules use qualifying activity, normalize addresses and exclude agents', async () => {
      await db.query('INSERT INTO users VALUES ?', [[
        [a, 'Human', null, null, '[]', '2026-11-03 12:00:00'],
        [b, 'Later', null, null, '[]', '2026-11-04 00:00:00'],
        [wallet(3), 'Bot', null, null, '["ai-agent"]', '2026-11-01 00:00:00'],
        [wallet(4), 'Hosted', null, null, null, '2026-11-01 00:00:00'],
      ]])
      await db.execute('INSERT INTO hosted_agents VALUES (?)', [wallet(4)])
      await db.query('INSERT INTO posts VALUES ?', [[[a.toUpperCase().replace('0X', '0x'), null, null], [b, 10, null], [wallet(3), null, null]]])
      await db.query('INSERT INTO tips VALUES ?', [Array.from({ length: 50 }, () => [a])])
      await db.query('INSERT INTO post_likes VALUES ?', [Array.from({ length: 100 }, (_, i) => [wallet(i + 100)])])
      await db.query('INSERT INTO follows VALUES ?', [Array.from({ length: 100 }, (_, i) => [wallet(i + 100), a, 1]).concat([[wallet(999), b, 1]])])
      assert.deepEqual(await rules.og(), [{ wallet: a, scope: '' }])
      assert.deepEqual(await rules['first-post'](), [{ wallet: a, scope: '' }])
      assert.deepEqual(await rules.generous(), [{ wallet: a, scope: '' }])
      assert.deepEqual(await rules['rising-voice'](), [{ wallet: a, scope: '' }])
      assert.deepEqual(await rules['season-top-10'](), [])
      const counts = await service.runAchievementRules({ notify: false })
      assert.equal(counts.og, 1)
      assert.equal(counts.generous, 1)
      assert.ok(Object.values(await service.runAchievementRules()).every((n) => n === 0))
      await assert.rejects(service.revokeAchievement({ wallet: a, id: 'og' }), { status: 403 })
      const [[count]] = await db.query('SELECT COUNT(*) AS n FROM notifications')
      assert.equal(count.n, 1, 'silent backfill and repeat runs do not notify')
    })

    await t.test('a closed season awards exactly its top ten once with a season scope', async () => {
      const { POINTS_SEASONS } = await import('../../config/points.js')
      const season = { id: 2, name: 'Test season', startsAt: '2020-01-01 00:00:00', endsAt: '2020-02-01 00:00:00' }
      POINTS_SEASONS.push(season)
      globalThis.__achievementTestStandings = { rows: Array.from({ length: 12 }, (_, index) => ({ wallet_address: wallet(200 + index), rank: index === 11 ? null : index + 1 })) }
      try {
        const standingsModule = 'data:text/javascript,export const getSeasonStandings = async () => globalThis.__achievementTestStandings'
        const source = (await readFile(new URL('../../lib/achievementRules.js', import.meta.url), 'utf8')).replace("'@/lib/points'", JSON.stringify(standingsModule))
        const { RULES: scopedRules } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
        const winners = await scopedRules['season-top-10']()
        assert.equal(winners.length, 10)
        assert.ok(winners.every((winner) => winner.scope === '2'))
        await service.awardAchievement({ wallets: winners.map((row) => row.wallet), id: 'season-top-10', scope: '2', source: 'rule', notify: false })
        assert.deepEqual(await scopedRules['season-top-10'](), [])
        assert.equal((await service.listAchievementHolders('season-top-10', '2')).length, 10)
      } finally {
        POINTS_SEASONS.pop()
        delete globalThis.__achievementTestStandings
      }
    })

    await t.test('admin API grants, revokes and runs rules with signed nonces', async () => {
      const { Wallet } = await import('ethers')
      const signer = Wallet.createRandom()
      process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS = signer.address.toLowerCase()
      const { achievementAdminMessage } = await import('../../lib/achievements.js')
      const { POST } = await import('../../app/api/v1/admin/achievements/route.js')
      const perform = async (action, index, id = 'early-tester') => {
        const nonce = index.toString(16).padStart(32, '0')
        await db.execute('INSERT INTO nonces VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))', [nonce, signer.address.toLowerCase()])
        const claim = { action, wallet: b, id, scope: '', note: 'Test grant', notify: false, nonce, chainId: 42 }
        const signature = await signer.signMessage(achievementAdminMessage(claim))
        return POST(new Request('http://localhost/api/v1/admin/achievements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...claim, signature }) }))
      }
      assert.equal((await perform('grant', 1)).status, 200)
      assert.equal((await service.readAchievements(b))[0].source, 'admin')
      await service.setFeaturedAchievement({ wallet: b, id: 'early-tester' })
      assert.equal((await perform('revoke', 2)).status, 200)
      assert.equal(await service.readFeaturedAchievement(b), null)
      assert.equal((await perform('run', 3, 'first-tip')).status, 200)
    })

    await t.test('featured API verifies an EOA signature, rejects tampering and replay', async () => {
      const { Wallet } = await import('ethers')
      const { featuredAchievementMessage } = await import('../../lib/achievements.js')
      const { POST } = await import('../../app/api/v1/users/achievements/featured/route.js')
      const signer = Wallet.createRandom()
      const owner = signer.address.toLowerCase()
      await service.awardAchievement({ wallets: [owner], id: 'early-tester', source: 'admin', grantedBy: b, notify: false })
      const nonce = 'b'.repeat(32)
      await db.execute('INSERT INTO nonces VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))', [nonce, owner])
      const claim = { address: owner, achievementId: 'early-tester', scope: '', nonce, issuedAt: Date.now(), chainId: 42 }
      const signature = await signer.signMessage(featuredAchievementMessage(claim))
      const request = (body) => new Request('http://localhost/api/v1/users/achievements/featured', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const response = await POST(request({ ...claim, signature }))
      assert.equal(response.status, 200)
      assert.deepEqual((await response.json()).data.featured, { id: 'early-tester', scope: '' })
      assert.equal((await POST(request({ ...claim, signature }))).status, 401)
      assert.equal((await POST(request({ ...claim, achievementId: 'unknown', signature }))).status, 400)
    })

    await t.test('missing tables return empty reads and reject writes with migration instructions', async () => {
      // A fresh module instance has no cached schema probes from the migrated fixture.
      const { spawnSync } = await import('node:child_process')
      await db.query('DROP TABLE user_featured_achievement, user_achievements')
      const result = spawnSync(process.execPath, ['--import', './src/tests/achievements/loader.mjs', '--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import pool from './src/lib/db.js';
        import { readAchievementSummary, readHolderCounts, runAchievementRules } from './src/lib/achievementsServer.js';
        assert.deepEqual(await readAchievementSummary('${a}'), {earned: [], featured: null});
        assert.deepEqual(await readHolderCounts(), {});
        await assert.rejects(runAchievementRules(), {status:503});
        const catalog = await import('./src/app/api/v1/achievements/route.js');
        assert.equal((await catalog.GET()).status, 200);
        const users = await import('./src/app/api/v1/users/[address]/achievements/route.js');
        assert.deepEqual((await (await users.GET(null, {params: Promise.resolve({address:'${a}'})})).json()).data, {earned: [], featured: null});
        const admin = await import('./src/app/api/v1/admin/achievements/route.js');
        assert.equal((await admin.GET(new Request('http://localhost/api/v1/admin/achievements?id=og'))).status, 503);
        await pool.end();
      `], { env: process.env, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
    })
  } finally {
    if (db) await db.end()
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await admin.end()
  }
})
