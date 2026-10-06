import { createReadable } from 'readable-sdk'
import { robinhood } from '@/config/contracts'
import { getServerPublicClient } from '@/lib/serverPublicClient'

// Through the server's pinned Robinhood client, never config/readable's: that one is wagmi's
export const readableServerRegistry = createReadable({ client: getServerPublicClient(robinhood.id) })

/**
 * A stored Readable number as the profile serves it. Checked against the registry when saved, so
 * this only keeps a hand-edited row from serving something that is not text.
 * @param {unknown} value
 * @returns {string|null}
 */
export function readStoredReadableNumber(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text && text.length <= 320 ? text : null
}
