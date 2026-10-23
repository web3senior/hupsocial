import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutoLikeBatcher, isAutoLikeNetwork } from './autoLikeBatch.js'

test('flushes a partial batch after the collection window and deduplicates IDs', async () => {
  const enqueue = createAutoLikeBatcher({ waitMs: 10 })
  const calls = []
  const request = { chainId: 42, owner: '0xAlice', id: 1, send: async (ids) => { calls.push(ids) } }
  const first = enqueue(request)
  assert.equal(enqueue({ ...request, id: '1' }), first)
  await first
  assert.deepEqual(calls, [[1]])
})

test('flushes at 20 and serializes later batches until confirmation', async () => {
  const enqueue = createAutoLikeBatcher({ waitMs: 10 })
  const calls = []
  let confirm
  const receipt = new Promise((resolve) => { confirm = resolve })
  const send = async (ids) => {
    calls.push(ids)
    if (calls.length === 1) await receipt
  }
  const pending = Array.from({ length: 41 }, (_, id) => enqueue({ chainId: 42, owner: 'alice', id, send }))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].length, 20)
  confirm()
  await Promise.all(pending)
  assert.deepEqual(calls.map((ids) => ids.length), [20, 20, 1])
})

test('isolates owners and chains and recovers after a failed send', async () => {
  const enqueue = createAutoLikeBatcher({ size: 1 })
  const failure = new Error('Relay unavailable')
  const failed = enqueue({ chainId: 42, owner: 'alice', id: 1, send: async () => { throw failure } })
  const calls = []
  const send = async (ids) => { calls.push(ids) }
  await Promise.all([
    assert.rejects(failed, failure),
    enqueue({ chainId: 42, owner: 'bob', id: 2, send }),
    enqueue({ chainId: 4201, owner: 'alice', id: 3, send }),
  ])
  await enqueue({ chainId: 42, owner: 'alice', id: 4, send })
  assert.deepEqual(calls, [[2], [3], [4]])
  assert.equal(isAutoLikeNetwork(42), true)
  assert.equal(isAutoLikeNetwork(4201), true)
  assert.equal(isAutoLikeNetwork(1), false)
})

test('rejects invalid posts individually while settling valid posts', async () => {
  const enqueue = createAutoLikeBatcher({ size: 2 })
  const error = new Error('Deleted post')
  const send = async () => new Map([['2', error]])
  const valid = enqueue({ chainId: 42, owner: 'alice', id: 1, send })
  const invalid = enqueue({ chainId: 42, owner: 'alice', id: 2, send })
  await Promise.all([valid, assert.rejects(invalid, error)])
})
