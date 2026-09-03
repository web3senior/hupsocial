/**
 * @file lib/lsp3.js
 * @description LSP3Profile helpers for saving a Universal Profile from Hup: the data key, the
 * ERC725Y write ABI, the current onchain document, and the merged JSON a save pins.
 */

import { INTERFACEID_LSP0 } from '@/lib/drops'
import { decodeVerifiableUri, erc725yGetDataAbi, fetchMetadataJson } from '@/lib/lsp4'

// keccak256('LSP3Profile')
export const LSP3_PROFILE_KEY = '0x5ef83ad9559033e6e941db7d7c495acdce616347d28e90c7ce47cbfcfcad3bc5'

// LSP0's setData is payable; the write sends no value
export const erc725ySetDataAbi = [
  {
    type: 'function',
    name: 'setData',
    stateMutability: 'payable',
    inputs: [
      { name: 'dataKey', type: 'bytes32' },
      { name: 'dataValue', type: 'bytes' },
    ],
    outputs: [],
  },
]

export const normalizeIpfsUri = (value) => (value?.startsWith('ipfs://') ? value : `ipfs://${value}`)

const erc165Abi = [
  {
    type: 'function',
    name: 'supportsInterface',
    stateMutability: 'view',
    inputs: [{ name: 'interfaceId', type: 'bytes4' }],
    outputs: [{ name: '', type: 'bool' }],
  },
]

/* Answered per address and kept, because the answer cannot change: an address either is an
   LSP0 account or it is not. A FAILED read is not a "no" and is dropped from the map, so an
   RPC hiccup does not permanently decide that someone has no Universal Profile. */
const universalProfileChecks = new Map()

/**
 * Whether an address is a Universal Profile, asked of the chain via ERC165.
 *
 * Deliberately not "did the LUKSO indexer return a row for it". That indexer is a third party
 * which can be rate limited, blocked or behind, and a profile that IS a Universal Profile still
 * has to be written to — deciding it from a GraphQL reply is what left the onchain sync doing
 * nothing at all for a real UP.
 * @param {object} publicClient A viem client on LUKSO.
 * @param {string} address
 * @returns {Promise<boolean>}
 */
export function isUniversalProfile(publicClient, address) {
  if (!publicClient || !address) return Promise.resolve(false)

  const key = String(address).toLowerCase()
  if (!universalProfileChecks.has(key)) {
    universalProfileChecks.set(
      key,
      publicClient
        .readContract({ address, abi: erc165Abi, functionName: 'supportsInterface', args: [INTERFACEID_LSP0] })
        .catch((error) => {
          console.warn('Could not tell whether this address is a Universal Profile:', error.message)
          universalProfileChecks.delete(key)
          return false
        }),
    )
  }

  return universalProfileChecks.get(key)
}

/**
 * The UP's current LSP3Profile object: `{}` when the key is unset, null when the document it
 * points at could not be read — a save must never proceed blind on null.
 */
export async function readLsp3Profile(publicClient, address) {
  const bytes = await publicClient.readContract({ address, abi: erc725yGetDataAbi, functionName: 'getData', args: [LSP3_PROFILE_KEY] })
  const uri = decodeVerifiableUri(bytes)
  if (!uri) return {}
  const json = await fetchMetadataJson(uri)
  const doc = json?.LSP3Profile
  return doc && typeof doc === 'object' ? doc : null
}

/** LSP3 image entry; `hash` is keccak256 of the served bytes (`hashIpfsContent`), or '0x' when unverified. */
export const lsp3ImageEntry = (url, hash, { width = 0, height = 0 } = {}) => ({
  width,
  height,
  url,
  verification: { method: 'keccak256(bytes)', data: hash || '0x' },
})

/** Editor rows ({ name, url }) from a links array in LSP3 shape ({ title, url }), Hup DB shape ({ name, url }) or JSON text. */
export const linksToRows = (raw) => {
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []

  return parsed
    .filter((link) => link && typeof link === 'object' && typeof link.url === 'string' && link.url.trim() !== '')
    .map((link) => ({ name: String(link.title ?? link.name ?? '').trim(), url: link.url.trim() }))
}

/** LSP3 links from editor rows. */
export const rowsToLsp3Links = (rows) => rows.map((row) => ({ title: String(row.name ?? '').trim(), url: String(row.url ?? '').trim() }))

/** LSP3Profile JSON: Hup's fields over `base`, so images and anything Hup doesn't edit survive the write. */
export const buildLsp3ProfileJson = ({ base = {}, name, description, tags, links, profileImage = null }) => ({
  LSP3Profile: {
    ...base,
    name,
    description,
    links,
    tags,
    profileImage: profileImage ?? base.profileImage ?? [],
    backgroundImage: base.backgroundImage ?? [],
  },
})

/** Pixel size of a picked image, browser only; zeros when it cannot be decoded. */
export const readImageSize = (file) =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    const done = (size) => {
      URL.revokeObjectURL(url)
      resolve(size)
    }
    img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => done({ width: 0, height: 0 })
    img.src = url
  })
