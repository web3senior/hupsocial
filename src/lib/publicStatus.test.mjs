import test from 'node:test'
import assert from 'node:assert/strict'
import { createStatusMonitor } from './publicStatus.mjs'

test('coalesces concurrent checks and refreshes after the cache expires', async () => {
  let time = 0
  let calls = 0
  const monitor = createStatusMonitor([
    { id: 'data', name: 'Data', description: 'Database', check: async () => { calls++ } },
  ], { now: () => time, ttlMs: 100 })
  const [first, second] = await Promise.all([monitor(), monitor()])
  assert.equal(calls, 1)
  assert.equal(first, second)
  assert.equal(first.status, 'operational')
  time = 99
  await monitor()
  assert.equal(calls, 1)
  time = 100
  await monitor()
  assert.equal(calls, 2)
})

test('reports failures without exposing upstream details', async () => {
  const monitor = createStatusMonitor([
    { id: 'data', name: 'Data', description: 'Database', check: async () => { throw new Error('private database credentials') } },
    { id: 'media', name: 'Media', description: 'Storage', check: async () => 'unmonitored' },
  ])
  const report = await monitor()
  assert.equal(report.status, 'disrupted')
  assert.equal(report.services[0].status, 'disrupted')
  assert.equal(report.services[1].status, 'unmonitored')
  assert.equal(JSON.stringify(report).includes('private'), false)
})

test('bounds a hung check and aborts its upstream work', async () => {
  let signal
  const monitor = createStatusMonitor([
    { id: 'live', name: 'Live', description: 'Streams', check: (value) => { signal = value; return new Promise(() => {}) } },
  ], { timeoutMs: 10 })
  const report = await monitor()
  assert.equal(report.status, 'disrupted')
  assert.equal(signal.aborted, true)
})

test('does not claim full availability when a check is unconfigured', async () => {
  const monitor = createStatusMonitor([
    { id: 'media', name: 'Media', description: 'Storage', check: async () => 'unmonitored' },
  ])
  assert.equal((await monitor()).status, 'unmonitored')
})
