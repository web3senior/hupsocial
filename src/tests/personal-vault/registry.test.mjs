import assert from 'node:assert/strict'
import { test } from 'node:test'
import mysql from 'mysql2/promise'
import { getAddress } from 'viem'
import { PERSONAL_VAULT_TABLES, listPersonalVaults, recordVerifiedVault, vaultRegistrationInput } from '@/lib/personalVaultRegistry'

const owner = `0x${'a'.repeat(40)}`
const second = `0x${'b'.repeat(40)}`
const replacement = `0x${'c'.repeat(40)}`
const address = `0x${'d'.repeat(40)}`
const snapshot = { chainId: 42, address, version: '1.3.0', threshold: 2, owners: [owner, second], blockNumber: 100n }

test('registration validates network/address and ignores claimed wallet ownership', () => {
  assert.deepEqual(vaultRegistrationInput({ chainId: 42, address, wallet: replacement, owners: [replacement] }), { chainId: 42, address: '0xDDdDddDdDdddDDddDDddDDDDdDdDDdDDdDDDDDDd' })
  for (const chainId of [0, -1, '42', 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => vaultRegistrationInput({ chainId, address }), /network/)
  assert.throws(() => vaultRegistrationInput({ chainId: 42, address: 'invalid' }), /address/)
  assert.throws(() => vaultRegistrationInput({ chainId: 42, address: `0x${'0'.repeat(40)}` }), /address/)
})

test('invalid registry lookups fail before touching the database', async () => {
  const db = { execute: () => { throw new Error('Database should not be called') } }
  await assert.rejects(() => listPersonalVaults(db, 'invalid'), /signing wallet/)
  await assert.rejects(() => listPersonalVaults(db, owner, -1), /cursor/)
})

test('MySQL vault persistence, owner associations, pagination and rollback', { skip: process.env.PERSONAL_VAULT_DB_TEST !== '1' }, async (t) => {
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: Number(process.env.DB_PORT || 3306), ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined })
  t.after(() => connection.end())
  // Connection-local tables shadow production tables. Test records never enter real user tables.
  for (const sql of PERSONAL_VAULT_TABLES) await connection.query(sql.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE'))
  const tx = {
    beginTransaction: () => connection.beginTransaction(),
    execute: (...args) => connection.execute(...args),
    commit: () => connection.commit(),
    rollback: () => connection.rollback(),
    release: () => {},
  }
  const db = { execute: (...args) => connection.execute(...args), getConnection: async () => tx }

  await t.test('all signers can discover the same vault, without duplicates on retry', async () => {
    await recordVerifiedVault(db, snapshot)
    await recordVerifiedVault(db, snapshot)
    for (const wallet of [owner, second, getAddress(owner)]) {
      const result = await listPersonalVaults(db, wallet)
      assert.equal(result.vaults.length, 1)
      assert.equal(result.vaults[0].chainId, 42)
      assert.equal(result.vaults[0].threshold, 2)
      assert.equal(result.vaults[0].signerCount, 2)
      assert.equal(result.vaults[0].address.toLowerCase(), address)
    }
    assert.equal((await listPersonalVaults(db, replacement)).vaults.length, 0)
  })
  await t.test('new signer snapshots replace removed owners; old snapshots cannot restore them', async () => {
    await recordVerifiedVault(db, { ...snapshot, owners: [owner, replacement], blockNumber: 101n })
    await recordVerifiedVault(db, snapshot)
    assert.equal((await listPersonalVaults(db, second)).vaults.length, 0)
    assert.equal((await listPersonalVaults(db, replacement)).vaults.length, 1)
  })
  await t.test('identical addresses on different chains stay separate and lists paginate', async () => {
    await recordVerifiedVault(db, { ...snapshot, chainId: 1, version: '1.4.1' })
    const first = await listPersonalVaults(db, owner, 0, 1)
    assert.equal(first.vaults.length, 1)
    assert.equal(first.nextCursor, 1)
    const next = await listPersonalVaults(db, owner, first.nextCursor, 1)
    assert.equal(next.vaults.length, 1)
    assert.notEqual(first.vaults[0].chainId, next.vaults[0].chainId)
    assert.equal(next.nextCursor, null)
  })
  await t.test('a failed signer update rolls back both vault metadata and associations', async () => {
    const failing = { ...db, getConnection: async () => ({ ...tx, execute: (sql, args) => {
      if (sql.startsWith('INSERT INTO personal_vault_signers')) throw new Error('Simulated write failure')
      return connection.execute(sql, args)
    } }) }
    await assert.rejects(() => recordVerifiedVault(failing, { ...snapshot, owners: [second, replacement], blockNumber: 102n }), /Simulated/)
    assert.equal((await listPersonalVaults(db, owner)).vaults.length, 2)
    assert.equal((await listPersonalVaults(db, second)).vaults.length, 1)
    const [rows] = await connection.execute('SELECT verified_block FROM personal_vaults WHERE chain_id = ? AND address = ?', [42, address])
    assert.equal(Number(rows[0].verified_block), 101)
  })
})
