/** Hold the signer's queue through confirmation, not just transaction broadcast. */
export const createRelaySubmissionQueue = () => {
  const queues = new Map()

  return (key, task) => {
    const previous = queues.get(key) ?? Promise.resolve()
    const next = previous.then(task, task)
    const settled = next.catch(() => {})
    queues.set(key, settled)
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key)
    })
    return next
  }
}

/** Only an explicitly rejected nonce may be re-signed automatically. */
export const retryRelayNonce = async (task, useSessionKey) => {
  try {
    return await task()
  } catch (error) {
    if (!useSessionKey || error.code !== 'RELAY_NONCE_CONFLICT') throw error
    return task()
  }
}

// Failures that happen before anything is signed or sent, where the relay can never serve
// the request: an empty relayer, or a smart account (Universal Profile) with no session key.
// The wallet prompt that follows is the user's consent to pay.
const PAID_FALLBACK_CODES = new Set(['RELAY_INSUFFICIENT_FUNDS', 'RELAY_NEEDS_SESSION'])

export const allowsRelayPaidFallback = (error) => PAID_FALLBACK_CODES.has(error?.code)
