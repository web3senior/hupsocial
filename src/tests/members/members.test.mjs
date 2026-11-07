import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import mysql from 'mysql2/promise'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const nextRequire = createRequire(require.resolve('next/package.json'))
nextRequire('@next/env').loadEnvConfig(process.cwd(), true)

// Opt in against a local server; fixtures create and drop a dedicated database only.
test('first Hup connection is independent of profile indexing', { skip: process.env.MEMBERS_TEST_DB !== '1' }, async (t) => {
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST), 'Use a local test database')
  const database = `hup_members_test_${process.pid}`
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.MEMBERS_TEST_SOCKET,
    multipleStatements: true,
  })
  let db
  try {
    await admin.query(`CREATE DATABASE ${database}`)
    process.env.DB_NAME = database
    if (process.env.MEMBERS_TEST_SOCKET) {
      globalThis.__hupDbPool = mysql.createPool({
        user: process.env.DB_USER,
        socketPath: process.env.MEMBERS_TEST_SOCKET,
        database,
        connectionLimit: 1,
      })
    }
    db = (await import('../../lib/db.js')).default
    const { ensureMember, ensureEmailMember, countMembers, memberFilter } = await import('../../lib/members.js')
    await db.query(`CREATE TABLE users (
      wallet_address VARCHAR(64) PRIMARY KEY, name TEXT, profileImage TEXT,
      created_at DATETIME, last_seen_at DATETIME, lastUpdate DATETIME
    )`)
    await t.test('unmigrated sign-in still works', async () => {
      await ensureMember('legacy')
      for (const since of [null, '2026-11-01 00:00:00']) {
        const filter = memberFilter(since, false)
        const [[row]] = await db.execute(`SELECT COUNT(*) AS total FROM users ${filter.where}`, filter.params)
        assert.equal(row.total, 0, 'missing tracking must never fall back to indexed profiles')
      }
    })
    const migration = await readFile(new URL('../../../deploy/migrations/20261107-member-joined-at.sql', import.meta.url), 'utf8')
    await admin.query(`USE ${database}`)
    await admin.query(migration)
    await admin.query(migration)
    // Re-probe after the negative-cache retry boundary without waiting five minutes.
    const realNow = Date.now
    Date.now = () => realNow() + 301_000
    try {
      await ensureMember('migrated')
    } finally {
      Date.now = realNow
    }
    await db.execute(`INSERT INTO users (wallet_address, name, created_at)
      VALUES ('indexed', 'Indexed profile', UTC_TIMESTAMP() - INTERVAL 30 DAY),
             ('cache-only', 'Cache only', UTC_TIMESTAMP()),
             ('old-join', NULL, UTC_TIMESTAMP())`)
    await db.execute("UPDATE users SET joined_at = UTC_TIMESTAMP() - INTERVAL 2 DAY WHERE wallet_address = 'old-join'")
    await t.test('pre-indexed wallet gets a recent join; indexer-only profiles do not', async () => {
      await ensureMember('indexed')
      await Promise.all([ensureMember('fresh'), ensureMember('fresh')])
      const filter = memberFilter(new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' '), true)
      const [rows] = await db.execute(`SELECT wallet_address FROM users ${filter.where}`, filter.params)
      assert.deepEqual(rows.map((row) => row.wallet_address).sort(), ['fresh', 'indexed', 'migrated'])
    })
    await t.test('reconnect preserves join timestamp and excludes returning old members', async () => {
      const [[before]] = await db.execute("SELECT joined_at FROM users WHERE wallet_address = 'indexed'")
      await ensureMember('indexed')
      await ensureMember('old-join')
      const [[after]] = await db.execute("SELECT joined_at FROM users WHERE wallet_address = 'indexed'")
      assert.equal(String(before.joined_at), String(after.joined_at))
      const [[old]] = await db.execute("SELECT joined_at < UTC_TIMESTAMP() - INTERVAL 24 HOUR AS old FROM users WHERE wallet_address = 'old-join'")
      assert.equal(old.old, 1)
    })
    await t.test('total includes unnamed connections and excludes indexer-only profiles', async () => {
      const filter = memberFilter(null, true)
      const [[row]] = await db.execute(`SELECT COUNT(*) AS total FROM users ${filter.where}`, filter.params)
      assert.equal(row.total, 4)
      const [rows] = await db.execute(`SELECT wallet_address FROM users ${filter.where}`, filter.params)
      assert.deepEqual(rows.map((row) => row.wallet_address).sort(), ['fresh', 'indexed', 'migrated', 'old-join'])
    })
    await db.query(`CREATE TABLE email_accounts (
      id INT PRIMARY KEY, wallet_address VARCHAR(42), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login_at TIMESTAMP NULL, joined_at DATETIME NULL
    )`)
    await db.execute('INSERT INTO email_accounts (id, last_login_at) VALUES (1, NOW()), (2, NULL)')
    await t.test('verified email counts before wallet creation, then deduplicates when linked', async () => {
      await ensureEmailMember(1)
      assert.equal((await countMembers()).total, 5)
      const [[before]] = await db.execute('SELECT joined_at FROM email_accounts WHERE id = 1')
      const wallet = `0x${'AB'.repeat(20)}`
      await db.execute('UPDATE email_accounts SET wallet_address = ? WHERE id = 1', [wallet])
      await ensureEmailMember(1, wallet)
      assert.equal((await countMembers()).total, 5, 'linked email and wallet must count once')
      await ensureEmailMember(1, wallet)
      const [[after]] = await db.execute('SELECT joined_at FROM email_accounts WHERE id = 1')
      assert.equal(String(before.joined_at), String(after.joined_at), 'relogin keeps the first join')
      const since = new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ')
      assert.equal((await countMembers(since)).recent, 4)
    })
  } finally {
    if (db) await db.end()
    await admin.query(`DROP DATABASE IF EXISTS ${database}`)
    await admin.end()
  }
})
