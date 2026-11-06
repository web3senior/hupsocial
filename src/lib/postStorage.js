// Shared reference rules; hosted URLs deliberately have no IPFS fallback.
export const HOSTED_PATH = '/api/post-storage/files/'
export const STORAGE_MODES = ['ipfs', 'hosted']

export function hostedKey(uri, origin) {
  try {
    const url = new URL(uri, origin)
    if (url.origin !== new URL(origin).origin || url.username || url.password || url.search || url.hash) return null
    const key = url.pathname.startsWith(HOSTED_PATH) ? url.pathname.slice(HOSTED_PATH.length) : ''
    return /^[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/.test(key) ? key : null
  } catch {
    return null
  }
}

export function collectStorageReferences(value) {
  const refs = new Set()
  const visit = (entry) => {
    if (typeof entry === 'string') {
      if (/^ipfs:\/\/[A-Za-z0-9]+$/.test(entry) || /^https?:\/\/[^\s]+\/api\/post-storage\/files\/[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/.test(entry)) refs.add(entry)
    } else if (Array.isArray(entry)) entry.forEach(visit)
    else if (entry && typeof entry === 'object') Object.values(entry).forEach(visit)
  }
  visit(value)
  return [...refs]
}
