import test from 'node:test'
import assert from 'node:assert/strict'
import { allowsRelayPaidFallback, createRelaySubmissionQueue, retryRelayNonce } from './relaySubmission.mjs'

test('rapid submissions sign only after the previous receipt advances the nonce', async () => {
  const enqueue = createRelaySubmissionQueue()
  let nonce = 0
  const signed = []
  let confirm
  const receipt = new Promise((resolve) => { confirm = resolve })
  const first = enqueue('42:burner', async () => {
    signed.push(nonce)
    await receipt
    nonce++
  })
  const second = enqueue('42:burner', async () => { signed.push(nonce) })
  await Promise.resolve()
  assert.deepEqual(signed, [0])
  confirm()
  await Promise.all([first, second])
  assert.deepEqual(signed, [0, 1])
})

test('independent signers are not blocked and a rejected request releases its queue', async () => {
  const enqueue = createRelaySubmissionQueue()
  let release
  const blocked = enqueue('42:alice', () => new Promise((resolve) => { release = resolve }))
  assert.equal(await enqueue('42:bob', async () => 'bob'), 'bob')
  assert.equal(await enqueue('8453:alice', async () => 'base'), 'base')
  release()
  await blocked
  await assert.rejects(enqueue('42:alice', async () => { throw new Error('offline') }), /offline/)
  assert.equal(await enqueue('42:alice', async () => 'recovered'), 'recovered')
})

test('a session nonce conflict is retried once with a newly signed request', async () => {
  let attempts = 0
  const hash = await retryRelayNonce(async () => {
    attempts++
    if (attempts === 1) throw Object.assign(new Error('Nonce already used'), { code: 'RELAY_NONCE_CONFLICT' })
    return '0xconfirmed'
  }, true)
  assert.equal(hash, '0xconfirmed')
  assert.equal(attempts, 2)
})

test('a persistent nonce conflict cannot retry indefinitely', async () => {
  let attempts = 0
  await assert.rejects(retryRelayNonce(async () => {
    attempts++
    throw Object.assign(new Error('Nonce conflict'), { code: 'RELAY_NONCE_CONFLICT' })
  }, true), /Nonce conflict/)
  assert.equal(attempts, 2)
})

test('rate limits, outages, and uncertain submissions are never retried or paid automatically', async () => {
  for (const code of ['RELAY_COOLDOWN', 'RELAY_UNAVAILABLE', 'RELAY_SUBMITTED', 'RELAY_UNSUPPORTED']) {
    let attempts = 0
    const error = Object.assign(new Error(code), { code })
    await assert.rejects(retryRelayNonce(async () => { attempts++; throw error }, true), error)
    assert.equal(attempts, 1)
    assert.equal(allowsRelayPaidFallback(error), false)
  }
})

test('wallet signatures are never automatically prompted twice', async () => {
  let attempts = 0
  await assert.rejects(retryRelayNonce(async () => {
    attempts++
    throw Object.assign(new Error('Nonce conflict'), { code: 'RELAY_NONCE_CONFLICT' })
  }, false), /Nonce conflict/)
  assert.equal(attempts, 1)
})

test('only insufficient relayer funds or a sessionless smart account allows the paid fallback', () => {
  assert.equal(allowsRelayPaidFallback({ code: 'RELAY_INSUFFICIENT_FUNDS' }), true)
  assert.equal(allowsRelayPaidFallback({ code: 'RELAY_NEEDS_SESSION' }), true)
  assert.equal(allowsRelayPaidFallback(new Error('insufficient funds')), false)
  assert.equal(allowsRelayPaidFallback(), false)
})
