import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { test } from 'node:test'
import { Wallet, verifyMessage } from 'ethers'
import bs58 from 'bs58'
import { blockUserMessage, blockedFeedFilter, readUserBlocks, saveUserBlock, validateBlockClaim } from '../lib/blockUsers.js'
import { verifySolanaBlockSignature } from '../lib/blockSolanaSignature.js'

const viewer = `0x${'a'.repeat(40)}`
const target = `0x${'b'.repeat(40)}`
const claim = (changes = {}) => ({ address: viewer, target, blocked: true, nonce: 'a'.repeat(32), issuedAt: Date.now(), signature: 'signed', ...changes })

function database() {
  const state = { blocks: new Map(), nonces: new Set(), released: 0, failWrite: false }
  const key = (owner, author) => `${owner}:${author}`
  return {
    state,
    execute: async (_sql, [owner]) => [[...state.blocks.values()].filter((row) => row.blocker_address === owner)],
    getConnection: async () => {
      let blocks
      let nonces
      return {
        beginTransaction: async () => {
          blocks = new Map(state.blocks)
          nonces = new Set(state.nonces)
        },
        execute: async (sql, args) => {
          if (sql.startsWith('DELETE FROM nonces')) {
            const nonceKey = key(args[1], args[0])
            return [{ affectedRows: nonces.delete(nonceKey) ? 1 : 0 }]
          }
          if (state.failWrite) throw new Error('database unavailable')
          if (sql.startsWith('INSERT')) blocks.set(key(...args), { blocker_address: args[0], blocked_address: args[1] })
          else blocks.delete(key(...args))
          return [{ affectedRows: 1 }]
        },
        commit: async () => {
          state.blocks = blocks
          state.nonces = nonces
        },
        rollback: async () => {},
        release: () => { state.released++ },
      }
    },
    authorize: (body) => state.nonces.add(key(body.address.toLowerCase(), body.nonce)),
  }
}

const verified = async () => true

test('database blocks survive a fresh read, remain wallet-scoped, and unblock', async () => {
  const db = database()
  const body = claim({ address: viewer.toUpperCase().replace('0X', '0x') })
  db.authorize(body)
  await saveUserBlock(db, body, verified)
  assert.deepEqual(await readUserBlocks(db, viewer), [target])
  assert.deepEqual(await readUserBlocks(db, target), [])
  const unblock = claim({ blocked: false, nonce: 'b'.repeat(32) })
  db.authorize(unblock)
  await saveUserBlock(db, unblock, verified)
  assert.deepEqual(await readUserBlocks(db, viewer), [])
  assert.equal(db.state.released, 2)
})

test('a nonce cannot be replayed to change a block', async () => {
  const db = database()
  const body = claim()
  db.authorize(body)
  await saveUserBlock(db, body, verified)
  await assert.rejects(saveUserBlock(db, { ...body, blocked: false }, verified), /Nonce/)
  assert.deepEqual(await readUserBlocks(db, viewer), [target])
})

test('failed signatures do not consume challenges or change blocks', async () => {
  const db = database()
  const body = claim()
  db.authorize(body)
  await assert.rejects(saveUserBlock(db, body, async () => false), { status: 401 })
  assert.equal(db.state.nonces.size, 1)
  assert.equal(db.state.released, 0)
  assert.deepEqual(await readUserBlocks(db, viewer), [])
})

test('failed writes roll back both the nonce and the block', async () => {
  const db = database()
  const body = claim()
  db.authorize(body)
  db.state.failWrite = true
  await assert.rejects(saveUserBlock(db, body, verified), /database unavailable/)
  assert.equal(db.state.nonces.size, 1)
  assert.deepEqual(await readUserBlocks(db, viewer), [])
  assert.equal(db.state.released, 1)
})

test('self-blocks, invalid inputs, stale signatures, and non-boolean actions are rejected', () => {
  for (const body of [null, claim({ target: viewer }), claim({ address: 'invalid' }), claim({ blocked: 'false' }), claim({ issuedAt: Date.now() - 600_000 }), claim({ nonce: 'invalid' })]) {
    assert.throws(() => validateBlockClaim(body))
  }
})

test('EVM signatures bind the target, action, viewer and nonce', async () => {
  const wallet = Wallet.createRandom()
  const body = claim({ address: wallet.address })
  const message = blockUserMessage(body)
  const signature = await wallet.signMessage(message)
  assert.equal(verifyMessage(message, signature).toLowerCase(), wallet.address.toLowerCase())
  for (const changed of [{ blocked: false }, { target: viewer }, { nonce: 'b'.repeat(32) }, { address: viewer }]) {
    assert.notEqual(verifyMessage(blockUserMessage({ ...body, ...changed }), signature).toLowerCase(), wallet.address.toLowerCase())
  }
})

test('Solana signatures preserve address case and reject modified messages', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const address = bs58.encode(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32))
  const message = blockUserMessage(claim({ address }))
  const signature = bs58.encode(sign(null, Buffer.from(message), privateKey))
  assert.ok(message.includes(address))
  assert.equal(verifySolanaBlockSignature(address, message, signature), true)
  assert.equal(verifySolanaBlockSignature(address, `${message}!`, signature), false)
  assert.equal(verifySolanaBlockSignature(address, message, 'invalid'), false)
})

test('feed predicates bind values and cover reposts with case-sensitive Solana comparisons', () => {
  const addresses = [target, 'Ab'.repeat(16)]
  const filter = blockedFeedFilter(addresses)
  assert.deepEqual(filter.params, [...addresses, ...addresses])
  assert.equal((filter.sql.match(/\?/g) || []).length, filter.params.length)
  assert.match(filter.sql, /blocked_original/)
  assert.match(filter.sql, /ascii_bin/)
  assert.equal(filter.sql.includes(target), false)
  const statuses = blockedFeedFilter(addresses, 's', false)
  assert.deepEqual(statuses.params, addresses)
  assert.equal(statuses.sql.includes('blocked_original'), false)
  assert.deepEqual(blockedFeedFilter([]), { sql: '', params: [] })
  assert.throws(() => blockedFeedFilter(addresses, 'injected'))
})
