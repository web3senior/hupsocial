import { readFile, statfs } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

export function resourceLevel(used, busy, heavy) {
  if (!Number.isFinite(used) || used < 0 || used > 1) return 'unmonitored'
  return used >= heavy ? 'heavy' : used >= busy ? 'busy' : 'operational'
}

export function resourceMeasurement(used, busy, heavy) {
  const status = resourceLevel(used, busy, heavy)
  return status === 'unmonitored' ? { status } : { status, usagePercent: Math.round(used * 1000) / 10 }
}

export function cpuSnapshot(text) {
  const values = text.split('\n')[0].trim().split(/\s+/).slice(1, 9).map(Number)
  if (values.length !== 8 || values.some((value) => !Number.isFinite(value))) throw new Error('CPU metrics unavailable')
  return { total: values.reduce((sum, value) => sum + value, 0), idle: values[3] + values[4] }
}

export function memoryUsage(text) {
  const total = Number(/^MemTotal:\s+(\d+)/m.exec(text)?.[1])
  const available = Number(/^MemAvailable:\s+(\d+)/m.exec(text)?.[1])
  return total > 0 ? 1 - available / total : NaN
}

let cached
let expiresAt = 0
let pending

export function getResourceHealth() {
  if (cached && Date.now() < expiresAt) return Promise.resolve(cached)
  if (pending) return pending
  pending = (async () => {
    if (process.platform !== 'linux') return Object.fromEntries(['cpu', 'memory', 'disk'].map((key) => [key, { status: 'unmonitored' }]))
    const results = await Promise.allSettled([
      (async () => {
        const before = cpuSnapshot(await readFile('/proc/stat', 'utf8'))
        await delay(250)
        const after = cpuSnapshot(await readFile('/proc/stat', 'utf8'))
        const total = after.total - before.total
        return resourceMeasurement(total > 0 ? 1 - (after.idle - before.idle) / total : NaN, 0.75, 0.9)
      })(),
      readFile('/proc/meminfo', 'utf8').then((text) => resourceMeasurement(memoryUsage(text), 0.85, 0.95)),
      statfs('/').then(({ blocks, bfree, bavail }) => {
        const used = blocks - bfree
        return resourceMeasurement(used + bavail > 0 ? used / (used + bavail) : NaN, 0.85, 0.95)
      }),
    ])
    return Object.fromEntries(['cpu', 'memory', 'disk'].map((key, index) => [key, results[index].status === 'fulfilled' ? results[index].value : { status: 'unmonitored' }]))
  })().then((result) => {
    cached = result
    expiresAt = Date.now() + 30_000
    return result
  }).finally(() => { pending = undefined })
  return pending
}
