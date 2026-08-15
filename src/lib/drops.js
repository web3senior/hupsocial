/**
 * @file lib/drops.js
 * @description Client helpers for the HupDrops NFT launchpad: standard-id mapping per chain,
 * collection constructor-param encoding for the per-standard deployer satellites, LSP2
 * VerifiableURI encoding for LUKSO metadata keys, gate metadata, and the merkle allowlist
 * builder whose leaves/pair-hashing match the engine's MerkleProof.verify exactly
 * (OpenZeppelin StandardMerkleTree convention: double-hashed abi-encoded address leaves,
 * commutative sorted-pair hashing).
 */

import { concatHex, encodeAbiParameters, hexToString, isAddress, keccak256, stringToHex } from 'viem'

// IHupDrops deployer registry ids — engine-side `deployers(standardId)`
export const DROP_STANDARDS = {
  ERC721: 1,
  ERC1155: 2,
  LSP7: 3,
  LSP8: 4,
}

// LSP4TokenType values (LSP7/LSP8 constructor + LSP8 metadata resolution)
export const LSP4_TOKEN_TYPE_NFT = 1
export const LSP4_TOKEN_TYPE_COLLECTION = 2

// IHupDrops.GateType
export const DROP_GATES = {
  OPEN: 0,
  ALLOWLIST: 1,
  FOLLOWERS: 2,
  ASSET_HOLDERS: 3,
  ASSET_HOLDERS_1155: 4,
}

const LUKSO_CHAIN_IDS = new Set([42, 4201])

export const isLuksoChain = (chainId) => LUKSO_CHAIN_IDS.has(Number(chainId))

/**
 * The two shapes a creator picks between, mapped to the chain's native pair:
 * editions (fungible copies of one artwork) and numbered (unique sequential ids).
 */
export const dropStandardsFor = (chainId) =>
  isLuksoChain(chainId)
    ? { editions: DROP_STANDARDS.LSP7, numbered: DROP_STANDARDS.LSP8 }
    : { editions: DROP_STANDARDS.ERC1155, numbered: DROP_STANDARDS.ERC721 }

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
  })[Number(gate)] ?? 'Gated'

// --- VerifiableURI (LSP2) ---

// bytes4(keccak256('keccak256(bytes)')) — the LSP2 verification method that says "this digest
// is over the exact bytes the URI serves". LUKSO's own bridged assets encode LSP4Metadata this
// way, and it is the only honest label for a digest taken from a gateway response: a
// keccak256(utf8) claim would invite a verifier to re-stringify the parsed JSON and compare,
// which fails the moment a pinning service serves different whitespace than we posted.
const VERIFICATION_METHOD_KECCAK_BYTES = '0x8019f9b1'

/**
 * Encodes an LSP2 VerifiableURI for LUKSO data keys (`LSP4Metadata`,
 * `LSP8TokenMetadataBaseURI`). With `contentBytes` (the exact bytes the URI resolves to) the
 * value carries a keccak256 digest and verifies offchain; without, the no-verification form
 * (eight zero bytes + URI) is produced — the norm for base URIs, whose per-token content can't
 * be pinned by one digest.
 */
export const encodeVerifiableURI = (url, contentBytes = null) => {
  if (contentBytes === null) return concatHex(['0x000000000000', '0x0000', stringToHex(url)])

  return encodeVerifiableURIFromDigest(url, keccak256(typeof contentBytes === 'string' ? stringToHex(contentBytes) : contentBytes))
}

/**
 * Same VerifiableURI, built from a digest someone else computed — what /api/ipfs/hash returns
 * for a pinned CID. Publishers hash the bytes the gateway actually serves (a re-serialized JSON
 * or a transcoded image is not byte-identical to what was uploaded), so the digest arrives
 * ready-made rather than as content. A null digest degrades to the no-verification form, which
 * keeps a gateway hiccup from blocking a mint.
 */
export const encodeVerifiableURIFromDigest = (url, digest) => {
  if (!digest || digest === '0x') return encodeVerifiableURI(url)

  return concatHex(['0x0000', VERIFICATION_METHOD_KECCAK_BYTES, '0x0020', digest, stringToHex(url)])
}

/**
 * One LSP4 image entry — the media URL plus the keccak256 of the bytes it serves, so a consumer
 * can prove the artwork behind the CID is the one the collection published. `data: '0x'` is the
 * honest empty state when the digest couldn't be computed: an absent hash, never a wrong one.
 */
const imageEntry = (url, hash) => ({ width: 0, height: 0, url, verification: { method: 'keccak256(bytes)', data: hash || '0x' } })

/**
 * Minimal LSP4Metadata JSON for a single-artwork drop. The caller uploads the stringified
 * result to IPFS and encodes the VerifiableURI over those exact bytes. `backgroundImageUrl`
 * follows Universal Page's convention of carrying a collection banner inside LSP4Metadata
 * (same nested shape as images).
 *
 * Every media entry carries the keccak256 of its bytes — hash them with `hashIpfsContent` from
 * lib/ipfs.js once the CID is pinned and pass them here. Omitted hashes publish an empty
 * `data`, exactly what an unverifiable asset looks like.
 */
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
    // LSP4 keeps the small square logo (`icon`, what wallets and explorers show next to the
    // asset) separate from the artwork gallery — the artwork stands in when none is set
    icon: iconUrl ? [[imageEntry(iconUrl, iconHash)]] : [],
    images: imageUrl ? [[imageEntry(imageUrl, imageHash)]] : [],
    backgroundImage: backgroundImageUrl ? [[imageEntry(backgroundImageUrl, backgroundImageHash)]] : [],
    assets: [],
    attributes: [],
  },
})

// --- Collection links (website + socials) ---

// The link model itself is shared with the communities branding form, so it lives in
// lib/socialLinks.js — re-exported here under the drop-flavoured names this module's callers
// already import.
export { SOCIAL_LINKS as DROP_SOCIALS, buildLinks as buildDropLinks, parseLinks as parseDropLinks } from './socialLinks'

/**
 * The ERC725Y data keys LSP7/LSP8 collections store their identity under — LSP collections
 * have no name()/symbol()/contractURI() functions, so readers must go through getData.
 * Values from @lukso/lsp4-contracts LSP4Constants.sol.
 */
export const LSP4_DATA_KEYS = {
  name: '0xdeba1e292f8ba88238e10ab3c7f88bd4be4fac56cad5194b6ecceaf653468af1', // keccak256('LSP4TokenName')
  symbol: '0x2f0a68ab07768e01943a599e73362a0e17a63a72e94dd2e384d2c1d4db932756', // keccak256('LSP4TokenSymbol')
  metadata: '0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e', // keccak256('LSP4Metadata')
}

/** Raw utf8 bytes from getData → string, empty-safe. */
export const decodeDataString = (value) => {
  if (!value || value === '0x') return ''
  try {
    return hexToString(value)
  } catch {
    return ''
  }
}

/**
 * Decodes an LSP2 VerifiableURI back to its URL — the inverse of encodeVerifiableURI. Handles
 * both forms it produces (keccak-verified and the eight-zero-byte no-verification form), plus
 * the legacy raw-string encoding some older assets carry. Returns null when nothing decodes.
 */
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

  // Legacy assets stored the bare URL bytes with no VerifiableURI envelope
  try {
    const raw = hexToString(value)
    return /^[a-z]+:\/\//i.test(raw) ? raw : null
  } catch {
    return null
  }
}

// --- Collection constructor params (decoded by the deployer satellites) ---

const encode721 = ({ name, symbol, baseURI = '', uriSuffix = '', contractURI = '', royaltyReceiver, royaltyBps = 0 }) =>
  encodeAbiParameters(
    [{ type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'address' }, { type: 'uint96' }],
    [name, symbol, baseURI, uriSuffix, contractURI, royaltyReceiver, BigInt(royaltyBps)],
  )

const encode1155 = ({ name, symbol, tokenURI = '', contractURI = '', royaltyReceiver, royaltyBps = 0 }) =>
  encodeAbiParameters(
    [{ type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'address' }, { type: 'uint96' }],
    [name, symbol, tokenURI, contractURI, royaltyReceiver, BigInt(royaltyBps)],
  )

const encodeLsp7 = ({ name, symbol, lsp4MetadataValue = '0x', royaltyReceiver, royaltyBps = 0 }) =>
  encodeAbiParameters(
    [{ type: 'string' }, { type: 'string' }, { type: 'bytes' }, { type: 'address' }, { type: 'uint96' }],
    [name, symbol, lsp4MetadataValue, royaltyReceiver, BigInt(royaltyBps)],
  )

const encodeLsp8 = ({ name, symbol, tokenType = LSP4_TOKEN_TYPE_NFT, lsp4MetadataValue = '0x', baseURIValue = '0x', royaltyReceiver, royaltyBps = 0 }) =>
  encodeAbiParameters(
    [{ type: 'string' }, { type: 'string' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'bytes' }, { type: 'address' }, { type: 'uint96' }],
    [name, symbol, BigInt(tokenType), lsp4MetadataValue, baseURIValue, royaltyReceiver, BigInt(royaltyBps)],
  )

/**
 * ABI-encodes the `_collectionParams` blob `createDrop` forwards to the standard's deployer
 * satellite. Shapes are per standard — see the deployer contracts' `deploy` NatSpec.
 */
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

// --- Merkle allowlist (engine-compatible) ---

/**
 * Leaf for one allowlisted address — the OpenZeppelin StandardMerkleTree double-hash the
 * engine verifies against: keccak256(bytes.concat(keccak256(abi.encode(address)))).
 */
export const allowlistLeaf = (address) => keccak256(keccak256(encodeAbiParameters([{ type: 'address' }], [address])))

const hashPair = (a, b) => (a.toLowerCase() < b.toLowerCase() ? keccak256(concatHex([a, b])) : keccak256(concatHex([b, a])))

/**
 * Normalizes a pasted allowlist: trims, validates, lowercases, dedupes. Returns checksummed
 * inputs as-is (case only matters for dedupe).
 */
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

/**
 * Builds the full merkle level stack for an allowlist. Level 0 is the sorted leaves; each
 * level pairs with commutative (sorted-pair) hashing, promoting an unpaired last node — the
 * layout OpenZeppelin's MerkleProof.verify walks.
 */
const buildLevels = (addresses) => {
  const leaves = addresses.map(allowlistLeaf).sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
  const levels = [leaves]

  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1]
    const next = []

    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i])
    }

    levels.push(next)
  }

  return levels
}

/**
 * Merkle root for an allowlist — what `PhaseInput.gateData` carries for Allowlist gates.
 */
export const allowlistRoot = (addresses) => {
  const list = normalizeAllowlist(addresses)
  if (list.length === 0) return null

  const levels = buildLevels(list)
  return levels[levels.length - 1][0]
}

/**
 * Merkle proof for one address against an allowlist, or null when the address isn't on it.
 * The DropCard builds this client-side from the published allowlist file at mint time.
 */
export const allowlistProof = (addresses, address) => {
  const list = normalizeAllowlist(addresses)
  if (!isAddress(address ?? '')) return null

  const target = allowlistLeaf(address).toLowerCase()
  const levels = buildLevels(list)

  let index = levels[0].findIndex((leaf) => leaf.toLowerCase() === target)
  if (index === -1) return null

  const proof = []
  for (let level = 0; level < levels.length - 1; level++) {
    const nodes = levels[level]
    const sibling = index % 2 === 0 ? index + 1 : index - 1
    if (sibling < nodes.length) proof.push(nodes[sibling])
    index = Math.floor(index / 2)
  }

  return proof
}

// --- Phase presentation ---

export const PHASE_STATUS = { UPCOMING: 'upcoming', LIVE: 'live', PAUSED: 'paused', ENDED: 'ended' }

/**
 * Where a phase sits relative to now. `startTime`/`endTime` are unix seconds (bigint or
 * number); endTime 0 = open-ended. A phase its creator paused never mints whatever its window
 * says, so the switch outranks the clock — except once the window has closed for good, where
 * "Ended" is the truer thing to show.
 */
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
