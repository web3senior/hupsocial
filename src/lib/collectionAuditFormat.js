/**
 * @file lib/collectionAuditFormat.js
 * @description Copy and colour for the permanence audit — badge ids, storage classes and
 * score categories as cidex's engine emits them, spelled out for the report and the chips.
 * Client-safe: no database, no viem.
 */

export const AUDIT_WEIGHTS = { storage: 0.45, availability: 0.25, integrity: 0.15, contract: 0.15 }

export const AUDIT_CATEGORIES = [
  { key: 'storage', label: 'Where the bytes live', hint: 'Onchain beats Arweave beats IPFS beats a web server; more IPFS providers score higher' },
  { key: 'availability', label: 'Reachable now', hint: 'How much of the sampled content could actually be fetched' },
  { key: 'integrity', label: 'Bytes match the chain', hint: 'Served bytes hashed against the digest committed onchain (LSP2 VerifiableURI)' },
  { key: 'contract', label: 'Contract trust', hint: 'Verified source, no proxy, renounced or linked creators' },
]

export const GRADE_COLORS = { A: '#16a34a', B: '#65a30d', C: '#d97706', D: '#ea580c', F: '#dc2626' }

export const gradeColor = (grade) => GRADE_COLORS[grade] || 'var(--text-muted, #888)'

// Only badges the engine emits; tone drives the chip colour
export const AUDIT_BADGES = {
  onchain: { label: 'Fully onchain', tone: 'good', hint: 'Every sampled document and artwork is inline data — nothing to pin, nothing to lose' },
  'partly-onchain': { label: 'Partly onchain', tone: 'good', hint: 'Some of the sampled content is inline data' },
  ipfs: { label: 'IPFS', tone: 'neutral', hint: 'Content-addressed: the bytes survive as long as someone pins them' },
  arweave: { label: 'Arweave', tone: 'good', hint: 'Paid-once permanent storage' },
  web2: { label: 'Web2 host', tone: 'warn', hint: 'At least one pointer depends on an ordinary web server staying up' },
  'content-lost': { label: 'Content lost', tone: 'bad', hint: 'None of the sampled artwork could be fetched from anywhere' },
  'at-risk': { label: 'At risk', tone: 'warn', hint: 'Some bytes were unreachable, or no IPFS node advertises them' },
  'hash-verified': { label: 'Hash verified', tone: 'good', hint: 'The bytes served today match the digest committed onchain' },
  'hash-mismatch': { label: 'Hash mismatch', tone: 'bad', hint: 'The bytes served today are not what the chain committed to' },
  'verified-source': { label: 'Verified source', tone: 'good', hint: 'The contract source is published and matches the deployed bytecode' },
  'unverified-source': { label: 'Unverified source', tone: 'warn', hint: 'No explorer holds verified source for this contract' },
  upgradeable: { label: 'Upgradeable', tone: 'warn', hint: 'A proxy: the code behind this address can change' },
  immutable: { label: 'Immutable metadata', tone: 'good', hint: 'No setter and no owner can move the pointers' },
  'verified-creator': { label: 'Verified creator', tone: 'good', hint: "The creator's Universal Profile lists this collection under its issued assets" },
  'partly-verified-creator': { label: 'Creator partly verified', tone: 'neutral', hint: 'Some of the named creators claim this collection back, others do not' },
  'unlinked-creator': { label: 'Unclaimed by creator', tone: 'warn', hint: 'LSP4Creators names a profile that does not list this collection back' },
  'no-metadata': { label: 'No metadata', tone: 'bad', hint: 'The audit found no metadata pointer to follow' },
}

export const describeBadge = (id) => AUDIT_BADGES[id] || { label: id, tone: 'neutral', hint: null }

export const STORAGE_CLASSES = {
  onchain: { label: 'Onchain', tone: 'good' },
  ipfs: { label: 'IPFS', tone: 'neutral' },
  'ipfs-gateway': { label: 'IPFS via gateway', tone: 'neutral' },
  arweave: { label: 'Arweave', tone: 'good' },
  web2: { label: 'Web server', tone: 'warn' },
  none: { label: 'Missing', tone: 'bad' },
  unknown: { label: 'Unrecognised', tone: 'bad' },
}

export const describeStorageClass = (cls) => STORAGE_CLASSES[cls] || STORAGE_CLASSES.unknown

export const KIND_LABELS = { lsp8: 'LSP8', lsp7: 'LSP7', erc721: 'ERC721', erc1155: 'ERC1155', unknown: 'Unknown standard' }

export const ROLE_LABELS = { artwork: 'Artwork', icon: 'Icon', banner: 'Banner', asset: 'Asset', doc: 'Metadata' }

export const HASH_LABELS = {
  pass: { label: 'Matches', tone: 'good' },
  fail: { label: 'Mismatch', tone: 'bad' },
  none: { label: 'No digest', tone: 'neutral' },
  unchecked: { label: 'Not hashed', tone: 'neutral' },
  'n/a': { label: '—', tone: 'neutral' },
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/**
 * "3 hours ago" for an ISO timestamp or Date, via Intl.
 * @param {string|Date|null} value
 * @returns {string|null}
 */
export const formatRelativeTime = (value) => {
  if (!value) return null
  const then = value instanceof Date ? value.getTime() : Date.parse(value)
  if (!Number.isFinite(then)) return null
  const seconds = Math.round((then - Date.now()) / 1000)
  const steps = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
    [Infinity, 'year'],
  ]
  let amount = seconds
  for (const [size, unit] of steps) {
    if (Math.abs(amount) < size) return RELATIVE.format(Math.round(amount), unit)
    amount /= size
  }
  return null
}

/** A CID or URL shortened for a table cell. */
export const shortenReference = (value, keep = 10) => {
  if (!value || typeof value !== 'string') return '—'
  if (value.length <= keep * 2 + 1) return value
  return `${value.slice(0, keep)}…${value.slice(-keep)}`
}
