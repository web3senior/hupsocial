/**
 * @file lib/drops.js
 * @description Client helpers for the HupDrops launchpad: standard ids, collection param encoding, LSP2 VerifiableURIs, gates.
 */

import { concatHex, encodeAbiParameters, hexToString, isAddress, keccak256, pad, slice, stringToHex, toHex, zeroAddress } from 'viem'
import { LSP4_CREATORS_ARRAY_KEY, LSP4_METADATA_KEY, LSP4_TOKEN_NAME_KEY, LSP4_TOKEN_SYMBOL_KEY, LSP8_TOKEN_METADATA_BASE_URI_KEY } from './lsp4'

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

/** The gates that check a balance on a contract the creator names, and so need one configured. */
export const isAssetGate = (gate) => gate === DROP_GATES.ASSET_HOLDERS || gate === DROP_GATES.ASSET_HOLDERS_1155

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
    // Flat per spec — only `images` nests variants
    icon: iconUrl ? [imageEntry(iconUrl, iconHash)] : [],
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
  name: LSP4_TOKEN_NAME_KEY,
  symbol: LSP4_TOKEN_SYMBOL_KEY,
  metadata: LSP4_METADATA_KEY,
  creators: LSP4_CREATORS_ARRAY_KEY,
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
  baseUri: LSP8_TOKEN_METADATA_BASE_URI_KEY,
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

/**
 * Whether every token id resolves to one shared metadata document — the placeholder state a
 * numbered drop launches in when it ships without per-token artwork. The launcher writes the
 * collection document terminated with a fragment, which gateways ignore, so id 1 and id 900 fetch
 * the same file until the creator points the base URI at a folder of their own.
 */
export const sharesOneTokenDocument = (tokenUri) => typeof tokenUri === 'string' && tokenUri.includes('#')

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

// --- Payment splits ---

/** What `createDrop` takes when the creator keeps everything: no split, proceeds to the creator. */
export const NO_SPLITS = { payoutDestination: zeroAddress, payout: [], royalty: [] }

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

// --- Engine reads ---

/**
 * getDrop, in the shape every deployed engine answers with. HupDrops 1.1.0 appends `featured` to
 * the record, and decoding that longer answer with this tuple simply ignores the extra word — so
 * reads work against both, where the full ABI cannot decode a drop created before 1.1.0 at all.
 */
export const DROP_RECORD_ABI = [
  {
    name: 'getDrop',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'dropId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'collection', type: 'address' },
          { name: 'creator', type: 'address' },
          { name: 'standardId', type: 'uint256' },
          { name: 'maxSupply', type: 'uint256' },
          { name: 'minted', type: 'uint256' },
          { name: 'referralBps', type: 'uint256' },
          { name: 'createdAt', type: 'uint64' },
          { name: 'closed', type: 'bool' },
        ],
      },
    ],
  },
]

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

// --- Phase scheduling (form model) ---

/** How the forms ask for a start. The engine only ever sees a timestamp and `paused`. */
export const DROP_START_MODES = { NOW: 'now', IN: 'in', AT: 'at', MANUAL: 'manual' }

export const DROP_END_MODES = { NEVER: 'never', AFTER: 'after', AT: 'at' }

export const DURATION_UNITS = [
  { id: 'minutes', label: 'minutes', seconds: 60 },
  { id: 'hours', label: 'hours', seconds: 3600 },
  { id: 'days', label: 'days', seconds: 86400 },
  { id: 'weeks', label: 'weeks', seconds: 604800 },
]

/** The lengths drops actually run for, so the common case is one tap. */
export const DURATION_PRESETS = [
  { amount: '1', unit: 'hours' },
  { amount: '24', unit: 'hours' },
  { amount: '3', unit: 'days' },
  { amount: '7', unit: 'days' },
  { amount: '30', unit: 'days' },
]

const unitSeconds = (unit) => DURATION_UNITS.find((entry) => entry.id === unit)?.seconds ?? 3600

const durationSeconds = (amount, unit) => {
  const value = Number(amount)
  return Number.isFinite(value) && value > 0 ? Math.round(value * unitSeconds(unit)) : 0
}

export const emptySchedule = (overrides = {}) => ({
  startMode: DROP_START_MODES.NOW,
  startIn: '',
  startInUnit: 'hours',
  startAt: '',
  endMode: DROP_END_MODES.NEVER,
  runFor: '',
  runForUnit: 'days',
  endAt: '',
  ...overrides,
})

export const formatDuration = (amount, unit) => {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) return ''
  const label = DURATION_UNITS.find((entry) => entry.id === unit)?.label ?? unit
  return `${value} ${value === 1 ? label.replace(/s$/, '') : label}`
}

const pad2 = (value) => String(value).padStart(2, '0')

/** `datetime-local` reads and writes local wall-clock time, never an ISO string. */
export const toDateTimeLocal = (ms) => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/**
 * Turns a form schedule into what the engine takes.
 * A length is measured from the resolved start — for a hand-started phase, that is creation time.
 * `errorField` says which half of the control is wrong, so the warning lands under it.
 * @returns {{ startTime: bigint, endTime: bigint, paused: boolean, error: string|null, errorField: 'start'|'end'|null }}
 */
export const resolveSchedule = (schedule, nowMs = Date.now()) => {
  const now = Math.floor(nowMs / 1000)
  const value = { ...emptySchedule(), ...(schedule ?? {}) }
  let error = null
  let errorField = null
  const fail = (field, message) => {
    if (error) return
    error = message
    errorField = field
  }
  // A minute of slack: block timestamps lag the browser clock, and a start in the future never opens
  let start = now - 60

  if (value.startMode === DROP_START_MODES.IN) {
    const offset = durationSeconds(value.startIn, value.startInUnit)
    if (offset === 0) fail('start', 'say how long until this phase opens')
    start = now + offset
  } else if (value.startMode === DROP_START_MODES.AT) {
    const at = Math.floor(new Date(value.startAt).getTime() / 1000)
    if (!value.startAt || Number.isNaN(at)) fail('start', 'pick the date this phase opens')
    else start = at
  }

  let end = 0
  if (value.endMode === DROP_END_MODES.AFTER) {
    const length = durationSeconds(value.runFor, value.runForUnit)
    if (length === 0) fail('end', 'say how long this phase runs')
    else end = Math.max(start, now) + length
  } else if (value.endMode === DROP_END_MODES.AT) {
    const at = Math.floor(new Date(value.endAt).getTime() / 1000)
    if (!value.endAt || Number.isNaN(at)) fail('end', 'pick the date this phase closes')
    else end = at
  }

  if (!error && end > 0) {
    if (end <= now) fail('end', 'it has to end in the future')
    else if (end <= start) fail('end', 'it has to end after it starts')
  }

  return { startTime: BigInt(start), endTime: BigInt(end), paused: value.startMode === DROP_START_MODES.MANUAL, error, errorField }
}

/** `resolveSchedule` errors are clauses, so they read either alone or behind a "Phase 2: " prefix. */
export const scheduleErrorMessage = (error, prefix = '') =>
  prefix ? `${prefix}${error}` : `${error.charAt(0).toUpperCase()}${error.slice(1)}`

/** One line of plain English about a schedule, for the review step. */
export const describeSchedule = (schedule, nowMs = Date.now()) => {
  const value = { ...emptySchedule(), ...(schedule ?? {}) }
  const { startTime, endTime } = resolveSchedule(value, nowMs)

  const opens =
    value.startMode === DROP_START_MODES.MANUAL
      ? 'opens when you start it'
      : value.startMode === DROP_START_MODES.IN
        ? `opens in ${formatDuration(value.startIn, value.startInUnit) || '—'}`
        : value.startMode === DROP_START_MODES.AT
          ? `opens ${formatPhaseTime(startTime) ?? '—'}`
          : 'opens right away'

  const closes =
    value.endMode === DROP_END_MODES.NEVER
      ? 'no end date'
      : value.endMode === DROP_END_MODES.AFTER
        ? `runs ${formatDuration(value.runFor, value.runForUnit) || '—'}`
        : `until ${formatPhaseTime(endTime) ?? '—'}`

  return `${opens} · ${closes}`
}

/** True once the creator has touched the schedule, so an untouched draft stays empty. */
export const scheduleIsSet = (schedule) => {
  const value = { ...emptySchedule(), ...(schedule ?? {}) }
  return value.startMode !== DROP_START_MODES.NOW || value.endMode !== DROP_END_MODES.NEVER
}

/** The next phase picks up where the last one ends, so a two-phase drop needs no arithmetic. */
export const scheduleFollowing = (previous) => {
  const prev = { ...emptySchedule(), ...(previous ?? {}) }
  if (prev.endMode === DROP_END_MODES.AT && prev.endAt) {
    return emptySchedule({ startMode: DROP_START_MODES.AT, startAt: prev.endAt })
  }
  if (prev.endMode === DROP_END_MODES.AFTER) {
    const { endTime } = resolveSchedule(prev)
    if (endTime > 0n) return emptySchedule({ startMode: DROP_START_MODES.AT, startAt: toDateTimeLocal(Number(endTime) * 1000) })
  }
  return emptySchedule()
}

/** Draft restore: a saved schedule is untrusted JSON. */
export const sanitizeSchedule = (value) => {
  const str = (input, max) => (typeof input === 'string' ? input.slice(0, max) : '')
  const unit = (input, fallback) => (DURATION_UNITS.some((entry) => entry.id === input) ? input : fallback)
  return emptySchedule({
    startMode: Object.values(DROP_START_MODES).includes(value?.startMode) ? value.startMode : DROP_START_MODES.NOW,
    startIn: str(value?.startIn, 10),
    startInUnit: unit(value?.startInUnit, 'hours'),
    startAt: str(value?.startAt, 40),
    endMode: Object.values(DROP_END_MODES).includes(value?.endMode) ? value.endMode : DROP_END_MODES.NEVER,
    runFor: str(value?.runFor, 10),
    runForUnit: unit(value?.runForUnit, 'days'),
    endAt: str(value?.endAt, 40),
  })
}

// --- Card presentation ---

/** What an embedded drop card shows; absent flags mean show, so posts from before the toggles render in full. */
export const normalizeDropCardOptions = (show) => ({
  stats: show?.stats !== false,
  pieces: show?.pieces !== false,
  mint: show?.mint !== false,
})

/** Newest-first ids for the pieces strip: both numbered collections mint 1..minted, LSP8 as bytes32 of the same number. */
export const latestMintedTokenIds = (minted, standardId, count = 3) => {
  const ids = []
  for (let id = Number(minted); id >= 1 && ids.length < count; id--) {
    ids.push(Number(standardId) === DROP_STANDARDS.LSP8 ? toHex(BigInt(id), { size: 32 }) : String(id))
  }
  return ids
}
