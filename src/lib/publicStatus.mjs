// Coalesce requests so a public status check cannot fan out into repeated upstream work.
export function createStatusMonitor(checks, { ttlMs = 30_000, timeoutMs = 6_000, now = Date.now } = {}) {
  let cached
  let expiresAt = 0
  let pending

  return function getStatus() {
    if (cached && now() < expiresAt) return Promise.resolve(cached)
    if (pending) return pending

    pending = Promise.all(checks.map(async ({ id, name, description, check }) => {
      const controller = new AbortController()
      let timer
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => check(controller.signal)),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort()
              reject(new Error('Health check timed out'))
            }, timeoutMs)
          }),
        ])
        const status = typeof result === 'object' && result ? result.status : result
        const service = { id, name, description, status: ['unmonitored', 'busy', 'heavy'].includes(status) ? status : 'operational' }
        if (id.startsWith('resource-') && service.status !== 'unmonitored' && Number.isFinite(result?.usagePercent) && result.usagePercent >= 0 && result.usagePercent <= 100) {
          service.usagePercent = result.usagePercent
        }
        return service
      } catch {
        // Never expose upstream errors, database details, or credentials publicly.
        return { id, name, description, status: 'disrupted' }
      } finally {
        clearTimeout(timer)
      }
    })).then((services) => {
      const status = services.some((service) => service.status === 'disrupted')
        ? 'disrupted'
        : services.some((service) => service.status === 'heavy') ? 'heavy'
          : services.some((service) => service.status === 'busy') ? 'busy'
            : services.some((service) => service.status === 'unmonitored') ? 'unmonitored' : 'operational'
      cached = { status, checkedAt: new Date(now()).toISOString(), services }
      expiresAt = now() + ttlMs
      return cached
    }).finally(() => {
      pending = undefined
    })

    return pending
  }
}
