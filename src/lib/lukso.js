/**
 * @file lib/lukso.js
 * @description Universal Profiles read from LUKSO itself.
 *
 * A profile lives in the wallet's own ERC725Y storage under the LSP3Profile key: a
 * VerifiableURI pointing at the JSON document. That is the source. The Envio GraphQL index is
 * a copy of it, and asking a copy put a third party on the critical path of every avatar,
 * byline and header chip in the app — one that answers 403 to some networks outright and is
 * behind the chain by however long its own sync takes.
 *
 * The document shape callers get is the one the index used to serve (`profileImages`,
 * `backgroundImages`, `lastMetadataUpdate`), so the profile read, its row cache and the
 * Hup-first sync stamp all keep working on it unchanged.
 */

import { keccak256 } from 'viem'
import { isEvmAddress } from '@/lib/address'
import { mapWithConcurrency } from '@/lib/concurrency'
import { decodeVerifiableUri, erc725yGetDataAbi, fetchMetadataJson } from '@/lib/lsp4'
import { LSP3_PROFILE_KEY } from '@/lib/lsp3'
import { getServerPublicClient } from '@/lib/serverPublicClient'

const LUKSO_CHAIN_ID = 42

// A hung gateway must cost the profile, never the request that asked for it
const DOCUMENT_TIMEOUT_MS = 6000

// Documents are IPFS fetches; the pointers beside them are one RPC call however many there are
const DOCUMENT_CONCURRENCY = 6
const POINTER_BATCH = 40

/**
 * What "the profile changed" means with no indexer block number to lean on: the pointer itself.
 * Hashed and cut to 16 bytes because `users.profile_indexed_stamp` is varchar(64) and a base32
 * CIDv1 URI is longer than that on its own — every consumer only ever compares it for equality.
 */
const pointerStamp = (pointer) => (pointer && pointer !== '0x' ? keccak256(pointer).slice(0, 34) : '')

/**
 * LSP3 image variants as the `{ src }` list the profile read consumes, largest first: the avatar
 * proxy downscales to the rung it needs and never enlarges, so the biggest file on offer is what
 * keeps a retina avatar sharp. Written-by-hand documents put a bare string or a nested array
 * where the spec asks for one flat list, and all three shapes are read here.
 */
const imageEntries = (field) => {
  const flat = Array.isArray(field) ? field.flat() : field ? [field] : []

  return flat
    .map((entry) => (typeof entry === 'string' ? { url: entry, width: 0 } : entry))
    .filter((entry) => entry && typeof entry.url === 'string' && entry.url.trim() !== '')
    .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0))
    .map((entry) => ({ src: entry.url }))
}

const textOf = (value) => (typeof value === 'string' ? value : null)

const linkEntries = (field) =>
  (Array.isArray(field) ? field : [])
    .filter((link) => link && typeof link === 'object' && typeof link.url === 'string' && link.url.trim() !== '')
    .map((link) => ({ title: String(link.title ?? '').trim(), url: link.url.trim() }))

/** The LSP3 document in the shape the profile read consumes. */
const shapeProfile = (address, pointer, doc) => ({
  id: address.toLowerCase(),
  name: textOf(doc.name) ?? '',
  /* The index's own "name#tag" rendering has no onchain equivalent — the displayName memo in
     components/Profile.jsx rebuilds one from the name and the address. */
  fullName: null,
  description: textOf(doc.description),
  tags: (Array.isArray(doc.tags) ? doc.tags : []).filter((tag) => typeof tag === 'string'),
  links: linkEntries(doc.links),
  profileImages: imageEntries(doc.profileImage),
  backgroundImages: imageEntries(doc.backgroundImage),
  lastMetadataUpdate: pointerStamp(pointer),
})

/**
 * Every wallet's LSP3 pointer in one round trip. A per-item failure is an answer — nothing
 * implementing ERC725Y is at that address — while a thrown call is the chain not answering at
 * all, which must never be mistaken for "this wallet has no profile".
 */
async function readPointers(client, addresses) {
  const pointers = new Map()

  for (let start = 0; start < addresses.length; start += POINTER_BATCH) {
    const chunk = addresses.slice(start, start + POINTER_BATCH)
    const results = await client.multicall({
      allowFailure: true,
      contracts: chunk.map((address) => ({
        address,
        abi: erc725yGetDataAbi,
        functionName: 'getData',
        args: [LSP3_PROFILE_KEY],
      })),
    })

    results.forEach((result, index) => pointers.set(chunk[index], result.status === 'success' ? result.result : null))
  }

  return pointers
}

/** The document a pointer names, or null when it names nothing readable. */
async function readDocument(pointer, timeoutMs) {
  const uri = decodeVerifiableUri(pointer)
  if (!uri) return null

  const json = await fetchMetadataJson(uri, { baseUrl: process.env.NEXT_PUBLIC_BASE_URL, timeoutMs }).catch(() => null)
  const doc = json?.LSP3Profile

  return doc && typeof doc === 'object' ? doc : null
}

/**
 * Universal Profiles for a list of wallets, read from LUKSO.
 *
 * @param {string[]} addresses Wallet addresses, any casing.
 * @param {{ timeoutMs?: number }} [options] Bound on a single document fetch.
 * @returns {Promise<Map<string, object|null>>} Keyed by lowercase address. A key present with
 *   null means the chain answered and that wallet publishes no profile — safe to remember. A
 *   key that is absent was never answered for, and must not be cached as anything.
 */
export async function readUniversalProfiles(addresses, { timeoutMs = DOCUMENT_TIMEOUT_MS } = {}) {
  const answers = new Map()
  const wanted = []
  const seen = new Set()

  for (const address of addresses ?? []) {
    if (typeof address !== 'string') continue
    const key = address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    // Base58 is not an address the LUKSO chain has anything to say about, and it can never be a
    // Universal Profile — an answer, not a failed lookup.
    if (!isEvmAddress(address)) {
      answers.set(key, null)
      continue
    }

    wanted.push({ key, address })
  }

  if (wanted.length === 0) return answers

  const client = getServerPublicClient(LUKSO_CHAIN_ID)
  if (!client) {
    console.error('Configuration Error: no server RPC endpoint for LUKSO')
    return answers
  }

  let pointers
  try {
    pointers = await readPointers(client, wanted.map((entry) => entry.address))
  } catch (error) {
    console.error('LUKSO profile read failed:', error.shortMessage || error.message)
    return answers
  }

  const documents = await mapWithConcurrency(wanted, DOCUMENT_CONCURRENCY, async (entry) => {
    const pointer = pointers.get(entry.address)
    if (!pointer || pointer === '0x') return null

    const doc = await readDocument(pointer, timeoutMs)
    return doc ? shapeProfile(entry.address, pointer, doc) : null
  })

  wanted.forEach((entry, index) => answers.set(entry.key, documents[index]))

  return answers
}

/**
 * One wallet's Universal Profile, read from LUKSO.
 *
 * @param {string} addr Wallet address, any casing.
 * @param {{ timeoutMs?: number }} [options] Bound on the document fetch.
 * @returns {Promise<{ answered: boolean, profile: object|null }>} `answered` false means the
 *   chain could not be reached — callers fall back without remembering anything.
 */
export async function readUniversalProfile(addr, options) {
  if (!addr) return { answered: false, profile: null }

  const key = String(addr).toLowerCase()
  const answers = await readUniversalProfiles([addr], options)

  return answers.has(key) ? { answered: true, profile: answers.get(key) } : { answered: false, profile: null }
}
