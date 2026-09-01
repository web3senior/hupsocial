/**
 * @file lib/drops.js
 * @description Client helpers for the HupDrops launchpad: standard ids, collection param encoding, LSP2 VerifiableURIs, gates.
 */

import { concatHex, encodeAbiParameters, hexToString, isAddress, keccak256, pad, slice, stringToHex, toHex } from 'viem'

// IHupDrops deployer registry ids — engine-side `deployers(standardId)`
export const DROP_STANDARDS = {
  ERC721: 1,
  ERC1155: 2,
  LSP7: 3,
  LSP8: 4,
}

export const LSP4_TOKEN_TYPE_NFT = 1
export const LSP4_TOKEN_TYPE_COLLECTION = 2

// IHupDrops.GateType
export const DROP_GATES = {
  OPEN: 0,
  ALLOWLIST: 1,
  FOLLOWERS: 2,
  ASSET_HOLDERS: 3,
  ASSET_HOLDERS_1155: 4,
  COMMUNITY: 5,
}

/** Mirrors the engine's MAX_PHASES. */
export const MAX_DROP_PHASES = 8

const LUKSO_CHAIN_IDS = new Set([42])

// Chains whose engine registers both token families; empty until one does
const MULTI_FAMILY_CHAIN_IDS = new Set()

export const isLuksoChain = (chainId) => LUKSO_CHAIN_IDS.has(Number(chainId))

export const nativeStandardFamily = (chainId) => (isLuksoChain(chainId) ? 'lsp' : 'erc')

export const dropStandardFamilies = (chainId) =>
  MULTI_FAMILY_CHAIN_IDS.has(Number(chainId)) ? ['lsp', 'erc'] : [nativeStandardFamily(chainId)]

export const dropFamilyLabel = (family) => (family === 'lsp' ? 'LUKSO · LSP7/LSP8' : 'EVM · ERC721/ERC1155')

/** Shape → standard for a family: editions (fungible copies of one artwork), numbered (unique ids). */
export const dropStandardsFor = (chainId, family = nativeStandardFamily(chainId)) =>
  family === 'lsp'
    ? { editions: DROP_STANDARDS.LSP7, numbered: DROP_STANDARDS.LSP8 }
    : { editions: DROP_STANDARDS.ERC1155, numbered: DROP_STANDARDS.ERC721 }

/** Every (standard, shape) row a chain can register a deployer for. */
export const dropStandardRowsFor = (chainId) =>
  dropStandardFamilies(chainId).flatMap((family) => {
    const standards = dropStandardsFor(chainId, family)
    return [
      { id: standards.editions, hint: 'editions', family },
      { id: standards.numbered, hint: 'numbered', family },
    ]
  })

export const isNumberedStandard = (standardId) =>
  Number(standardId) === DROP_STANDARDS.ERC721 || Number(standardId) === DROP_STANDARDS.LSP8

export const isLuksoStandard = (standardId) =>
  Number(standardId) === DROP_STANDARDS.LSP7 || Number(standardId) === DROP_STANDARDS.LSP8

export const dropStandardLabel = (standardId) =>
  ({ 1: 'ERC721', 2: 'ERC1155', 3: 'LSP7', 4: 'LSP8' })[Number(standardId)] ?? 'NFT'

export const gateLabel = (gate) =>
  ({
    [DROP_GATES.OPEN]: 'Open to everyone',
    [DROP_GATES.ALLOWLIST]: 'Allowlist',
    [DROP_GATES.FOLLOWERS]: 'Followers only',
    [DROP_GATES.ASSET_HOLDERS]: 'Asset holders',
    [DROP_GATES.ASSET_HOLDERS_1155]: 'Asset holders',
    [DROP_GATES.COMMUNITY]: 'Community members',
  })[Number(gate)] ?? 'Gated'

// --- VerifiableURI (LSP2) ---

// bytes4(keccak256('keccak256(bytes)')) — the digest is over the exact bytes the URI serves
const VERIFICATION_METHOD_KECCAK_BYTES = '0x8019f9b1'

/** LSP2 VerifiableURI: with `contentBytes` it carries a keccak256 digest, without it the no-verification form. */
export const encodeVerifiableURI = (url, contentBytes = null) => {
  if (contentBytes === null) return concatHex(['0x000000000000', '0x0000', stringToHex(url)])

  return encodeVerifiableURIFromDigest(url, keccak256(typeof contentBytes === 'string' ? stringToHex(contentBytes) : contentBytes))
}

/** VerifiableURI from a precomputed digest (/api/ipfs/hash); a null digest degrades to the no-verification form. */
export const encodeVerifiableURIFromDigest = (url, digest) => {
  if (!digest || digest === '0x') return encodeVerifiableURI(url)

  return concatHex(['0x0000', VERIFICATION_METHOD_KECCAK_BYTES, '0x0020', digest, stringToHex(url)])
}

const imageEntry = (url, hash) => ({ width: 0, height: 0, url, verification: { method: 'keccak256(bytes)', data: hash || '0x' } })

/** Minimal LSP4Metadata JSON for one artwork; hashes are keccak256 of the served bytes (`hashIpfsContent`). */
export const buildLsp4MetadataJson = ({
  name,
  description = '',
  imageUrl = '',
  imageHash = '',
  iconUrl = '',
  iconHash = '',
  backgroundImageUrl = '',
  backgroundImageHash = '',
  links = [],
}) => ({
  LSP4Metadata: {
    name,
    description,
    links,
    icon: iconUrl ? [[imageEntry(iconUrl, iconHash)]] : [],
    images: imageUrl ? [[imageEntry(imageUrl, imageHash)]] : [],
    backgroundImage: backgroundImageUrl ? [[imageEntry(backgroundImageUrl, backgroundImageHash)]] : [],
    assets: [],
    attributes: [],
  },
})

// --- Collection links (website + socials) ---

// Shared with the communities branding form; re-exported under the drop-flavoured names
export { SOCIAL_LINKS as DROP_SOCIALS, buildLinks as buildDropLinks, parseLinks as parseDropLinks } from './socialLinks'

/** ERC725Y identity keys — LSP collections have no name()/symbol()/contractURI(), only getData. */
export const LSP4_DATA_KEYS = {
  name: '0xdeba1e292f8ba88238e10ab3c7f88bd4be4fac56cad5194b6ecceaf653468af1', // keccak256('LSP4TokenName')
  symbol: '0x2f0a68ab07768e01943a599e73362a0e17a63a72e94dd2e384d2c1d4db932756', // keccak256('LSP4TokenSymbol')
  metadata: '0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e', // keccak256('LSP4Metadata')
  creators: '0x114bd03b3a46d48759680d81ebb2b414fda7d030a7105a851867accf1c2352e7', // keccak256('LSP4Creators[]')
}

// bytes10(keccak256('LSP4CreatorsMap')) — the reverse-lookup prefix
const LSP4_CREATORS_MAP_PREFIX = '0x6de85eaf5d982b4e5da0'

/** LSP0ERC725Account's ERC165 id: what a Universal Profile answers true for. */
export const INTERFACEID_LSP0 = '0x24871b3d'

export const MAX_DROP_CREATORS = 8

/** LSP2 array element key: the array key's first 16 bytes, then the index as 16 bytes. */
export const creatorsElementKeyAt = (index) => concatHex([slice(LSP4_DATA_KEYS.creators, 0, 16), pad(toHex(index), { size: 16 })])
const creatorsElementKey = creatorsElementKeyAt

// LSP2 mapping key: bytes10 prefix + two zero bytes + the address
const creatorsMapKey = (address) => concatHex([LSP4_CREATORS_MAP_PREFIX, '0x0000', address.toLowerCase()])

/**
 * setDataBatch writes that make `LSP4Creators[]` read as `creators`. Rewrites the whole array and
 * clears the tail element keys and dropped addresses' map keys from `previous`, so no stale creator survives.
 */
export const encodeCreatorsWrites = (creators, previous = []) => {
  const keys = [LSP4_DATA_KEYS.creators]
  const values = [pad(toHex(creators.length), { size: 16 })]

  creators.forEach((creator, index) => {
    keys.push(creatorsElementKey(index))
    values.push(creator.address.toLowerCase())

    keys.push(creatorsMapKey(creator.address))
    values.push(concatHex([creator.interfaceId ?? '0x00000000', pad(toHex(index), { size: 16 })]))
  })

  for (let index = creators.length; index < previous.length; index++) {
    keys.push(creatorsElementKey(index))
    values.push('0x')
  }

  const kept = new Set(creators.map((creator) => creator.address.toLowerCase()))
  for (const address of previous) {
    if (kept.has(address.toLowerCase())) continue
    keys.push(creatorsMapKey(address))
    values.push('0x')
  }

  return { keys, values }
}

/** LSP8's answer to ERC721's baseURI; the reveal writes it as a VerifiableURI. */
export const LSP8_DATA_KEYS = {
  baseUri: '0x1a7628600c3bac7101f53697f48df381ddc36b9015e7d7c9c5633d1252aa2843', // _LSP8_TOKEN_METADATA_BASE_URI
}

export const decodeDataString = (value) => {
  if (!value || value === '0x') return ''
  try {
    return hexToString(value)
  } catch {
    return ''
  }
}

/** Inverse of encodeVerifiableURI; also accepts the legacy bare-URL encoding. Null when nothing decodes. */
export const decodeVerifiableURI = (value) => {
  if (!value || value === '0x') return null

  const hex = value.slice(2)
  if (hex.length >= 16 && hex.startsWith('0000')) {
    const dataLength = parseInt(hex.slice(12, 16), 16)
    const urlHex = hex.slice(16 + dataLength * 2)
    if (urlHex.length > 0) {
      try {
        return hexToString(`0x${urlHex}`)
      } catch {
        return null
      }
    }
    return null
  }

  try {
    const raw = hexToString(value)
    return /^[a-z]+:\/\//i.test(raw) ? raw : null
  } catch {
    return null
  }
}

// --- Collection constructor params (decoded by the deployer satellites) ---

// `burnable` is last in every constructor tuple so old satellites fail to decode rather than
// mis-decode; it defaults to false (non-burnable)

const encode721 = ({ name, symbol, baseURI = '', uriSuffix = '', contractURI = '', royaltyReceiver, royaltyBps = 0, burnable = false }) =>
  encodeAbiParameters(
    [
      { type: 'string' },
      { type: 'string' },
      { type: 'string' },
      { type: 'string' },
      { type: 'string' },
      { type: 'address' },
      { type: 'uint96' },
      { type: 'bool' },
    ],
    [name, symbol, baseURI, uriSuffix, contractURI, royaltyReceiver, BigInt(royaltyBps), Boolean(burnable)],
  )

const encode1155 = ({ name, symbol, tokenURI = '', contractURI = '', royaltyReceiver, royaltyBps = 0, burnable = false }) =>
  encodeAbiParameters(
    [{ type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'address' }, { type: 'uint96' }, { type: 'bool' }],
    [name, symbol, tokenURI, contractURI, royaltyReceiver, BigInt(royaltyBps), Boolean(burnable)],
  )

const encodeLsp7 = ({ name, symbol, lsp4MetadataValue = '0x', royaltyReceiver, royaltyBps = 0, burnable = false }) =>
  encodeAbiParameters(
    [{ type: 'string' }, { type: 'string' }, { type: 'bytes' }, { type: 'address' }, { type: 'uint96' }, { type: 'bool' }],
    [name, symbol, lsp4MetadataValue, royaltyReceiver, BigInt(royaltyBps), Boolean(burnable)],
  )

const encodeLsp8 = ({
  name,
  symbol,
  tokenType = LSP4_TOKEN_TYPE_NFT,
  lsp4MetadataValue = '0x',
  baseURIValue = '0x',
  royaltyReceiver,
  royaltyBps = 0,
  burnable = false,
}) =>
  encodeAbiParameters(
    [
      { type: 'string' },
      { type: 'string' },
      { type: 'uint256' },
      { type: 'bytes' },
      { type: 'bytes' },
      { type: 'address' },
      { type: 'uint96' },
      { type: 'bool' },
    ],
    [name, symbol, BigInt(tokenType), lsp4MetadataValue, baseURIValue, royaltyReceiver, BigInt(royaltyBps), Boolean(burnable)],
  )

/** ABI-encodes the `_collectionParams` blob `createDrop` forwards to the standard's deployer satellite. */
export const encodeCollectionParams = (standardId, params) => {
  switch (Number(standardId)) {
    case DROP_STANDARDS.ERC721:
      return encode721(params)
    case DROP_STANDARDS.ERC1155:
      return encode1155(params)
    case DROP_STANDARDS.LSP7:
      return encodeLsp7(params)
    case DROP_STANDARDS.LSP8:
      return encodeLsp8(params)
    default:
      throw new Error(`Unknown drop standard ${standardId}`)
  }
}

// --- Allowlist input parsing ---

/** Trims, validates, and case-insensitively dedupes a pasted allowlist for setAllowlistedBatch. */
export const normalizeAllowlist = (addresses) => {
  const seen = new Set()
  const list = []

  for (const raw of addresses) {
    const value = String(raw).trim()
    if (!isAddress(value)) continue

    const key = value.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    list.push(value)
  }

  return list
}

/** The engine's cap on a phase label — bytes, not characters. */
export const MAX_PHASE_NAME_BYTES = 64

export const phaseNameByteLength = (value) => new TextEncoder().encode(String(value ?? '')).length

/** Mirrors the engine's setAllowlistedBatch cap. */
export const ALLOWLIST_BATCH_SIZE = 100

// --- Phase presentation ---

export const PHASE_STATUS = { UPCOMING: 'upcoming', LIVE: 'live', PAUSED: 'paused', ENDED: 'ended' }

/** `startTime`/`endTime` are unix seconds; endTime 0 = open-ended. Paused outranks the clock until the window has closed. */
export const phaseStatus = (phase, nowMs = Date.now()) => {
  const start = Number(phase.startTime) * 1000
  const end = Number(phase.endTime) * 1000

  if (end > 0 && nowMs >= end) return PHASE_STATUS.ENDED
  if (phase.paused) return PHASE_STATUS.PAUSED
  if (nowMs < start) return PHASE_STATUS.UPCOMING
  return PHASE_STATUS.LIVE
}

const dateTimeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' })

export const formatPhaseTime = (unixSeconds) => {
  const value = Number(unixSeconds)
  return value > 0 ? dateTimeFormat.format(new Date(value * 1000)) : null
}
