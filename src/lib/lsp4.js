// Shared LSP4 (LUKSO digital asset metadata) helpers — used by useNftMetadata for
// LSP8 collections and useTokenIcon for LSP7 payment tokens in the browser, and by the
// metadata caches on the server. Isomorphic: only global fetch/atob, which both runtimes have.

import { hexToString } from 'viem'
import { isIPFSHash, resolveStorageUrl } from '@/lib/storageHelper'
import { raceIPFS } from '@/lib/ipfsGateways'

// LSP4 metadata lives in ERC725Y storage — keccak256 data keys per the LSP4 spec
export const LSP4_TOKEN_NAME_KEY = '0xdeba1e292f8ba88238e10ab3c7f88bd4be4fac56cad5194b6ecceaf653468af1'
export const LSP4_METADATA_KEY = '0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e'

export const erc725yGetDataAbi = [
  {
    type: 'function',
    name: 'getData',
    stateMutability: 'view',
    inputs: [{ name: 'dataKey', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
]

// A VerifiableURI (LSP2) is `0x0000` + bytes4 verification method + bytes2 hash length +
// hash + utf8 url. Rather than trusting every collection to encode it perfectly, decode the
// whole payload as text and pull the trailing url out of it. The tail must admit any
// non-control character, not just ASCII: an embedded `data:application/json` payload is the
// url, and collections put µ, emoji and accented names straight into that JSON.
export const decodeVerifiableUri = (bytes) => {
  if (!bytes || bytes === '0x') return null
  let text
  try {
    text = hexToString(bytes)
  } catch {
    return null
  }
  const match = text.match(/(ipfs:\/\/|https?:\/\/|ar:\/\/|data:)[^\u0000-\u001F\u007F]*$/)
  return match ? match[0] : null
}

// LSP4Metadata images are size-variant arrays; the first variant of the first image is the
// canonical one. Icon is the square fallback.
export const pickLsp4Image = (lsp4) => lsp4?.images?.[0]?.[0]?.url || lsp4?.icon?.[0]?.url || null

// For token avatars the square icon is the primary asset and images are the fallback.
export const pickLsp4Icon = (lsp4) => lsp4?.icon?.[0]?.url || lsp4?.images?.[0]?.[0]?.url || null

// A document fetch has to be bounded. The gateway behind NEXT_PUBLIC_IPFS_GATEWAY_URL hands
// back a pinned object in a second or two but takes a full thirty seconds to admit it cannot
// find one — and a collection whose base URI has gone away (XYZ Generation on LUKSO) makes
// every one of its tokens pay that, per visitor, per cache expiry, eight at a time through
// the batch endpoint. Ten seconds is several times a healthy cold fetch and a third of the
// hang; the callers all treat a rejection as "no document" and move on to their fallbacks.
const FETCH_TIMEOUT_MS = 10000

// Once one token's document has timed out, its siblings behind the same prefix will too: a
// base URI is one host or one directory, and the tokens are paths under it. Remembering the
// prefix for a few minutes turns a grid of such tokens from N timeouts into one. In-process
// only, so a recovered host is retried by the next instance — and by this one shortly.
const DEAD_PREFIX_TTL_MS = 5 * 60 * 1000
const deadPrefixes = new Map()

// The part of a URI that a collection's other tokens share, or null when there is nothing
// safe to share. `ipfs://<cid>` names one object, and `https://gateway/ipfs/<cid>` names one
// object on a gateway every collection goes through — marking either "directory" dead would
// take every unrelated collection down with it for the duration.
const sharedPrefixOf = (uri) => {
  const path = String(uri).split(/[?#]/)[0]
  const authorityStart = path.indexOf('://') + 3
  if (authorityStart < 3) return null
  const slash = path.lastIndexOf('/')
  if (slash < authorityStart) return null
  const prefix = path.slice(0, slash)
  return /\/(ipfs|ipns)$/i.test(prefix) ? null : prefix
}

const isDeadPrefix = (prefix) => {
  const until = deadPrefixes.get(prefix)
  if (!until) return false
  if (until > Date.now()) return true
  deadPrefixes.delete(prefix)
  return false
}

// What a gateway says when it has looked for the document and is answering about the
// document, not about itself. Everything else — a timeout, a refused connection, 429, 5xx —
// is a statement about the host, and the host is what the dead-prefix rule remembers.
const DEFINITIVE_STATUSES = new Set([400, 404, 410, 451])

/**
 * Fetches and parses a metadata JSON document from any storage URI.
 *
 * Bounded to FETCH_TIMEOUT_MS, and a prefix that timed out, refused the connection or
 * answered 429/5xx is skipped outright for a few minutes — a 404 is an answer about one
 * token, those are statements about its host. Either way the caller sees what it would have
 * seen after waiting: a rejection or null.
 *
 * An `ipfs://` document is asked of every configured gateway at once and the first to answer
 * wins. One host alone is the wrong bet there: the primary is where our own uploads pin, and a
 * collection's document is almost never one of those — it answered 504 within a second for
 * every LUKSO collection's CID while the gateway that held it was never asked, and the
 * collection cache filled with whatever the indexer remembered instead. The race keeps the
 * same bound: no gateway waits past the clock, and the losers are cancelled.
 *
 * @param {string} uri ipfs://, https:// or a data: URI.
 * @param {{ baseUrl?: string, timeoutMs?: number }} [options] `baseUrl` makes the
 * resolver's relative output (the app's own proxy paths) absolute — required on the server,
 * where fetch has no document origin to resolve against. `timeoutMs` overrides the default bound.
 */
export const fetchMetadataJson = async (uri, options = {}) => {
  if (!uri) return null
  if (uri.startsWith('data:application/json')) {
    const comma = uri.indexOf(',')
    // Only the header before the comma decides the encoding. Collections that embed their
    // artwork inline (Burnt Pix ships the whole SVG as `data:image/svg+xml;base64,…` inside
    // the JSON) would otherwise look base64 because of the *image's* marker, and atob would
    // choke on the plain-text body.
    const isBase64 = comma !== -1 && uri.slice(0, comma).includes(';base64')
    const payload = uri.slice(comma + 1)
    if (isBase64) return JSON.parse(atob(payload))
    // Percent-decoding is best effort — a body containing a bare `%` is not valid
    // percent-encoding but is still valid JSON.
    try {
      return JSON.parse(decodeURIComponent(payload))
    } catch {
      return JSON.parse(payload)
    }
  }

  // Keyed on the onchain URI rather than the gateway URL it resolves to, so the prefix is the
  // collection's own (`ipfs://<cid>`, `https://api.collection.xyz/token`) and never the
  // gateway's.
  const prefix = sharedPrefixOf(uri)
  if (prefix && isDeadPrefix(prefix)) return null
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS

  if (isIPFSHash(uri)) {
    let response
    try {
      response = await raceIPFS(uri.replace(/^ipfs:\/\//, ''), { timeoutMs })
    } catch (error) {
      // Only a round in which every gateway looked and answered about the document is an
      // answer about the document; a host that never answered, or asked us to back off,
      // condemns its directory the way a single-host timeout always did.
      const statuses = error.statuses || []
      const answered = !error.timedOut && statuses.length === error.attempted && statuses.every((status) => DEFINITIVE_STATUSES.has(status))
      if (prefix && !answered) deadPrefixes.set(prefix, Date.now() + DEAD_PREFIX_TTL_MS)
      return null
    }
    return response.json()
  }

  const resolved = resolveStorageUrl(uri)
  if (!resolved) return null
  const target = resolved.startsWith('/') && options.baseUrl ? new URL(resolved, options.baseUrl).toString() : resolved

  let response
  try {
    response = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    // Timed out, or the host refused the connection: the tokens next to this one are not
    // going to fare any better.
    if (prefix) deadPrefixes.set(prefix, Date.now() + DEAD_PREFIX_TTL_MS)
    throw error
  }

  if (response.status === 429 || response.status >= 500) {
    // The host is telling us to back off (chillwhales' bucket answers 503 SlowDownRead under
    // load) — hammering it with the rest of the grid is how that gets worse.
    if (prefix) deadPrefixes.set(prefix, Date.now() + DEAD_PREFIX_TTL_MS)
    return null
  }
  if (!response.ok) return null
  return response.json()
}
