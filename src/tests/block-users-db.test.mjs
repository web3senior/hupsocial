import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import mysql from 'mysql2/promise'
import { Wallet, verifyMessage } from 'ethers'
import { blockedFeedFilter, blockUserMessage, readUserBlocks, saveUserBlock } from '../lib/blockUsers.js'

test('MySQL persistence, signature verification, replay protection and feed filtering', { skip: process.env.BLOCK_USERS_DB_TEST !== '1' }, async (t) => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  })
  t.after(() => connection.end())

  // These tables shadow the real ones only on this connection. No user data is modified.
  const migration = await readFile(new URL('../../deploy/migrations/20261029-user-blocks.sql', import.meta.url), 'utf8')
  await connection.query(migration.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE'))
  await connection.query('CREATE TEMPORARY TABLE nonces (nonce VARCHAR(32) PRIMARY KEY, wallet_address VARCHAR(44), expires_at DATETIME) ENGINE=InnoDB')
  const db = {
    execute: connection.execute.bind(connection),
    getConnection: async () => ({
      beginTransaction: connection.beginTransaction.bind(connection),
      execute: connection.execute.bind(connection),
      commit: connection.commit.bind(connection),
      rollback: connection.rollback.bind(connection),
      release: () => {},
    }),
  }
  const wallet = Wallet.createRandom()
  const target = `0x${'b'.repeat(40)}`
  const body = { address: wallet.address, target, blocked: true, nonce: randomBytes(16).toString('hex'), issuedAt: Date.now() }
  const verify = async (address, message, signature) => verifyMessage(message, signature).toLowerCase() === address
  body.signature = await wallet.signMessage(blockUserMessage(body))
  await connection.execute('INSERT INTO nonces VALUES (?, ?, NOW() + INTERVAL 5 MINUTE)', [body.nonce, wallet.address.toLowerCase()])
  await saveUserBlock(db, body, verify)
  assert.deepEqual(await readUserBlocks(db, wallet.address), [target])
  await assert.rejects(saveUserBlock(db, body, verify), /Nonce/)

  const filter = blockedFeedFilter(await readUserBlocks(db, wallet.address), 's', false)
  const [hidden] = await connection.execute(`SELECT s.wallet_address FROM (SELECT ? AS wallet_address) s WHERE 1=1 ${filter.sql}`, [target.toUpperCase().replace('0X', '0x'), ...filter.params])
  assert.equal(hidden.length, 0)

  const solana = 'Ab'.repeat(16)
  const caseFilter = blockedFeedFilter([solana], 's', false)
  const [differentCase] = await connection.execute(`SELECT s.wallet_address FROM (SELECT ? AS wallet_address) s WHERE 1=1 ${caseFilter.sql}`, [solana.toLowerCase(), ...caseFilter.params])
  assert.equal(differentCase.length, 1)

  // Resolve a synthetic repost against an existing post without inserting or changing posts.
  const [originals] = await connection.query('SELECT id, network_id, wallet_address FROM posts WHERE wallet_address IS NOT NULL LIMIT 1')
  if (originals.length) {
    const original = originals[0]
    const normalized = original.wallet_address.startsWith('0x') ? original.wallet_address.toLowerCase() : original.wallet_address
    const repostFilter = blockedFeedFilter([normalized])
    const [reposts] = await connection.execute(`SELECT p.wallet_address FROM (SELECT ? AS wallet_address, ? AS network_id, ? AS is_repost) p WHERE 1=1 ${repostFilter.sql}`, [wallet.address, original.network_id, original.id, ...repostFilter.params])
    assert.equal(reposts.length, 0)
  }

  const unblock = { ...body, blocked: false, nonce: randomBytes(16).toString('hex'), issuedAt: Date.now() }
  unblock.signature = await wallet.signMessage(blockUserMessage(unblock))
  await connection.execute('INSERT INTO nonces VALUES (?, ?, NOW() + INTERVAL 5 MINUTE)', [unblock.nonce, wallet.address.toLowerCase()])
  await saveUserBlock(db, unblock, verify)
  assert.deepEqual(await readUserBlocks(db, wallet.address), [])
})
