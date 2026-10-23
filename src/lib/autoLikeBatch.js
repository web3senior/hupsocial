export const AUTO_LIKE_BATCH_SIZE = 20
export const AUTO_LIKE_WAIT_MS = 1500

export const isAutoLikeNetwork = (chainId) => [42, 4201].includes(Number(chainId))

/** Collect before signing: a batchLike signature authorizes one owner's exact IDs. */
export const createAutoLikeBatcher = ({ size = AUTO_LIKE_BATCH_SIZE, waitMs = AUTO_LIKE_WAIT_MS } = {}) => {
  const groups = new Map()

  const flush = async (key, group) => {
    if (group.running) return
    clearTimeout(group.timer)
    group.timer = null
    const entries = [...group.pending.values()].slice(0, size)
    if (!entries.length) return
    entries.forEach((entry) => group.pending.delete(String(entry.id)))
    group.running = true

    try {
      const failures = await entries[0].send(entries.map((entry) => entry.id))
      entries.forEach((entry) => {
        const error = failures?.get(String(entry.id))
        if (error) entry.reject(error)
        else entry.resolve()
      })
    } catch (error) {
      entries.forEach((entry) => entry.reject(error))
    } finally {
      group.running = false
      if (group.pending.size) {
        // Requests arriving during confirmation have already waited for this batch.
        void flush(key, group)
      } else {
        groups.delete(key)
      }
    }
  }

  return ({ chainId, owner, id, send }) => {
    const key = `${chainId}:${owner.toLowerCase()}`
    let group = groups.get(key)
    if (!group) {
      group = { pending: new Map(), running: false, timer: null }
      groups.set(key, group)
    }
    const existing = group.pending.get(String(id))
    if (existing) return existing.promise

    let resolve
    let reject
    const promise = new Promise((onResolve, onReject) => {
      resolve = onResolve
      reject = onReject
    })
    group.pending.set(String(id), { id, send, promise, resolve, reject })

    if (!group.running) {
      if (group.pending.size >= size) void flush(key, group)
      else if (!group.timer) group.timer = setTimeout(() => void flush(key, group), waitMs)
    }
    return promise
  }
}

export const enqueueAutoLike = createAutoLikeBatcher()
