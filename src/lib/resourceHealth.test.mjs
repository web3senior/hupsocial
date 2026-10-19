import test from 'node:test'
import assert from 'node:assert/strict'
import { cpuSnapshot, memoryUsage, resourceLevel, resourceMeasurement } from './resourceHealth.mjs'
import { createStatusMonitor } from './publicStatus.mjs'

test('thresholds include their boundaries and reject unavailable measurements', () => {
  assert.deepEqual(resourceMeasurement(0.12345, 0.75, 0.9), { status: 'operational', usagePercent: 12.3 })
  assert.deepEqual(resourceMeasurement(NaN, 0.75, 0.9), { status: 'unmonitored' })
  assert.equal(resourceLevel(0.74, 0.75, 0.9), 'operational')
  assert.equal(resourceLevel(0.75, 0.75, 0.9), 'busy')
  assert.equal(resourceLevel(0.9, 0.75, 0.9), 'heavy')
  assert.equal(resourceLevel(NaN, 0.75, 0.9), 'unmonitored')
  assert.equal(resourceLevel(1.1, 0.75, 0.9), 'unmonitored')
})

test('publishes only bounded percentages for resource checks', async () => {
  const monitor = createStatusMonitor([
    { id: 'resource-cpu', check: async () => ({ status: 'busy', usagePercent: 80, privateValue: 'secret' }) },
    { id: 'resource-disk', check: async () => ({ status: 'heavy', usagePercent: 101 }) },
  ])
  const report = await monitor()
  assert.equal(report.services[0].usagePercent, 80)
  assert.equal(report.services[0].status, 'busy')
  assert.equal('privateValue' in report.services[0], false)
  assert.equal('usagePercent' in report.services[1], false)
})

test('memory counts reclaimable cache as available; CPU excludes duplicate guest counters', () => {
  assert.equal(memoryUsage('MemTotal: 1000 kB\nMemFree: 10 kB\nMemAvailable: 600 kB'), 0.4)
  assert.ok(Number.isNaN(memoryUsage('MemTotal: 1000 kB')))
  assert.deepEqual(cpuSnapshot('cpu 100 0 50 800 50 0 0 0 20 0\ncpu0 1'), { total: 1000, idle: 850 })
})

test('resource pressure is preserved and does not mask a service disruption', async () => {
  const checks = [{ id: 'cpu', check: async () => 'heavy' }]
  assert.equal((await createStatusMonitor(checks)()).status, 'heavy')
  checks.push({ id: 'data', check: async () => { throw new Error('Unavailable') } })
  assert.equal((await createStatusMonitor(checks)()).status, 'disrupted')
})
