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

// The same bands cidex grades with, so "points to the next grade" is never off by one
export const GRADE_BANDS = [
  ['A', 85],
  ['B', 70],
  ['C', 55],
  ['D', 40],
  ['F', 0],
]

export const gradeFor = (score) => GRADE_BANDS.find(([, floor]) => Number(score) >= floor)?.[0] || 'F'

/**
 * The grade one step up and how far away it is — the number a creator can act on.
 * @param {number} score
 * @returns {{ grade: string, points: number }|null} Null at the top.
 */
export const nextGradeTarget = (score) => {
  const value = Number(score) || 0
  const above = [...GRADE_BANDS].reverse().find(([, floor]) => floor > value)
  return above ? { grade: above[0], points: above[1] - value } : null
}

/**
 * The four categories said plainly, one line each, for a reader who has never heard of a
 * gateway or a digest. Tone drives the icon; the number stays available beside it.
 * @param {{ categories: Object, badges: string[], contract?: Object }} audit
 * @returns {Array<{ key: string, label: string, text: string, tone: string, value: number }>}
 */
export const plainCategories = ({ categories = {}, badges = [], contract = null }) => {
  const has = (id) => badges.includes(id)
  const storage = has('content-lost')
    ? { tone: 'bad', text: 'The files could not be found anywhere.' }
    : has('onchain')
      ? { tone: 'good', text: 'The files are stored on the blockchain itself — they cannot go missing.' }
      : has('arweave')
        ? { tone: 'good', text: 'The files are on Arweave, paid for once and kept permanently.' }
        : has('web2')
          ? { tone: 'warn', text: 'At least one file sits on an ordinary web server — it vanishes if that site goes down.' }
          : has('ipfs')
            ? { tone: (categories.storage ?? 0) >= 70 ? 'good' : 'warn', text: 'The files are on IPFS — safe for as long as at least one copy stays pinned.' }
            : { tone: 'neutral', text: 'Where the files live could not be worked out.' }

  const availability = categories.availability ?? 0
  const reach =
    availability >= 100
      ? { tone: 'good', text: 'Every file opened when Hup checked just now.' }
      : availability >= 70
        ? { tone: 'warn', text: 'Most files opened, but not all of them.' }
        : availability > 0
          ? { tone: 'bad', text: 'Several files did not open.' }
          : { tone: 'bad', text: 'Nothing could be opened.' }

  const integrity = has('hash-mismatch')
    ? { tone: 'bad', text: 'What is being served is not what was promised onchain.' }
    : has('hash-verified')
      ? { tone: 'good', text: 'The files match the fingerprint stored onchain — they are the originals.' }
      : { tone: 'neutral', text: 'No onchain fingerprint to check the files against.' }

  const control = contract?.isProxy
    ? { tone: 'warn', text: 'The contract’s code can be swapped by its owner.' }
    : contract && !contract.mutable
      ? { tone: 'good', text: 'Nobody can change where the files point — not even the creator.' }
      : { tone: 'warn', text: 'The owner can still change where the files point.' }

  return [
    { key: 'storage', label: 'Where the files live', value: categories.storage ?? 0, ...storage },
    { key: 'availability', label: 'Do they open today?', value: availability, ...reach },
    { key: 'integrity', label: 'Are they the originals?', value: categories.integrity ?? 0, ...integrity },
    { key: 'contract', label: 'Can anyone change them?', value: categories.contract ?? 0, ...control },
  ]
}

/**
 * What would raise the score, as things a person can go and do, most damaging first. Empty
 * means there is nothing to fix. `studio` and `explorer` are the pages an action links to.
 * @param {{ badges: string[], categories: Object, contract?: Object, studio?: string|null, explorer?: string|null }} audit
 */
export const improvementsFor = ({ badges = [], categories = {}, contract = null, studio = null, explorer = null }) => {
  const has = (id) => badges.includes(id)
  const steps = []
  const fix = (id, title, text, action = null) => steps.push({ id, title, text, action })

  if (has('content-lost')) fix('lost', 'Bring the files back', 'None of the artwork could be found. Upload it again and point the collection at the new files.', studio && { label: 'Open in Studio', href: studio })
  if (has('web2')) fix('web2', 'Move the files off the web server', 'A website disappears the day its hosting stops being paid. Upload the files to IPFS or Arweave and point the collection there.', studio && { label: 'Open in Studio', href: studio })
  if (has('hash-mismatch')) fix('hash', 'Serve the original files', 'What is served today is not what was committed onchain. Pin the originals again, or point the collection at where they really are.', studio && { label: 'Open in Studio', href: studio })
  if (has('at-risk') || (has('ipfs') && (categories.availability ?? 100) < 100)) {
    fix('pin', 'Keep more than one copy pinned', 'IPFS only keeps what someone pins. Pin the files with a second provider — Filebase, Pinata or web3.storage — so one lapsed subscription cannot take them down.')
  }
  if (has('no-metadata')) fix('metadata', 'Give the collection its metadata', 'No metadata could be found at all. Point the collection at a document describing it.', studio && { label: 'Open in Studio', href: studio })
  if (has('unverified-source')) fix('source', 'Verify the contract on the explorer', 'Publishing the source lets anyone confirm what the contract does. Explorers verify it from the compiler settings in a minute or two.', explorer && { label: 'Open the explorer', href: explorer, external: true })
  if (has('unlinked-creator') || has('partly-verified-creator')) fix('creator', 'Claim the collection from your profile', 'Add it to your Universal Profile’s issued assets, so wallets and marketplaces can show it is really yours.')
  if (has('upgradeable')) fix('proxy', 'Lock the code', 'A proxy lets the owner swap the code behind this address. Once the collection is finished, give up the right to upgrade it.')
  if (contract?.mutable && !contract?.isProxy && !has('content-lost') && !has('web2') && !has('hash-mismatch')) {
    fix('freeze', 'Freeze the metadata once the artwork is final', 'While the pointers can still move, collectors are trusting you not to move them. Hup drop collections have a Freeze switch in the manage panel.')
  }

  return steps
}

/** A CID or URL shortened for a table cell. */
export const shortenReference = (value, keep = 10) => {
  if (!value || typeof value !== 'string') return '—'
  if (value.length <= keep * 2 + 1) return value
  return `${value.slice(0, keep)}…${value.slice(-keep)}`
}
