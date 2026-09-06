/**
 * @file lib/nftInspect.js
 * @description The pure half of the token inspector: where a URI points, what a data: URI
 * carries, which outside resources a piece of SVG or HTML art pulls in, and the verdict those
 * facts add up to. Isomorphic — the server computes with it, the page labels with it.
 */

// --- where a URI points ---

const CID_PATTERN = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,}|z[1-9A-HJ-NP-Za-km-z]{40,}|f[0-9a-f]{50,})$/i

export const isCidLike = (value) => CID_PATTERN.test(String(value || ''))

const hostOf = (url) => {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * Where a URI's bytes live. The class decides both how the layer is fetched and how it scores.
 * @param {string|null} uri
 * @returns {{cls: string, cid?: string, root?: string, url?: string, host?: string}}
 */
export function classifyUri(uri) {
  if (!uri || typeof uri !== 'string') return { cls: 'none' }
  const value = uri.trim()
  if (/^data:/i.test(value)) return { cls: 'onchain' }

  if (/^ipfs:\/\//i.test(value)) {
    const path = value.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//i, '').replace(/^\/+/, '')
    const root = path.split(/[/?#]/)[0]
    return isCidLike(root) ? { cls: 'ipfs', cid: path.split('#')[0], root } : { cls: 'unknown', url: value }
  }
  if (/^ar:\/\//i.test(value)) {
    const id = value.replace(/^ar:\/\//i, '')
    return { cls: 'arweave', url: `https://arweave.net/${id}`, host: 'arweave.net' }
  }
  if (/^https?:\/\//i.test(value)) {
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      return { cls: 'unknown', url: value }
    }
    const host = parsed.hostname
    if (/(^|\.)arweave\.net$/i.test(host) || /(^|\.)ar-io\.net$/i.test(host)) return { cls: 'arweave', url: value, host }

    const pathMatch = parsed.pathname.match(/\/(?:ipfs|image)\/([^/?#]+)(\/[^?#]*)?/i)
    if (pathMatch && isCidLike(pathMatch[1])) {
      return { cls: 'ipfs-gateway', cid: `${pathMatch[1]}${pathMatch[2] || ''}`, root: pathMatch[1], url: value, host }
    }
    const subdomain = host.match(/^([a-z0-9]+)\.ipfs\./i)
    if (subdomain && isCidLike(subdomain[1])) {
      return { cls: 'ipfs-gateway', cid: `${subdomain[1]}${parsed.pathname === '/' ? '' : parsed.pathname}`, root: subdomain[1], url: value, host }
    }
    return { cls: 'web2', url: value, host }
  }
  if (/^(javascript|about|mailto|blob|tel|#):?/i.test(value) || value.startsWith('#')) return { cls: 'unknown', url: value }
  // No scheme: a path resolved against whatever served the document that named it
  return { cls: 'relative', url: value }
}

// --- data: URIs ---

const TEXT_MIME = /^(text\/|image\/svg|application\/(json|javascript|ecmascript|xml|xhtml\+xml|ld\+json|x-javascript))/i

/** Whether bytes of this type are worth reading as text — scanned for dependencies, shown raw. */
export const isTextMime = (mime) => TEXT_MIME.test(String(mime || ''))

const bytesFromBase64 = (payload) => {
  const clean = payload.replace(/\s+/g, '')
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(clean, 'base64'))
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const utf8 = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: false })

/**
 * Decodes a data: URI into its type, encoding and bytes.
 * @param {string} uri
 * @returns {{mime: string, charset: string|null, encoding: 'base64'|'percent'|'plain', bytes: Uint8Array, size: number, text: string|null}|null}
 */
export function decodeDataUri(uri) {
  if (typeof uri !== 'string' || !/^data:/i.test(uri)) return null
  const comma = uri.indexOf(',')
  if (comma === -1) return null
  const header = uri.slice(5, comma)
  const payload = uri.slice(comma + 1)
  const parts = header.split(';')
  const mime = (parts[0] || 'text/plain').toLowerCase()
  const charset = parts.find((part) => /^charset=/i.test(part))?.slice(8) || null
  const isBase64 = parts.some((part) => part.toLowerCase() === 'base64')

  let bytes
  let encoding
  try {
    if (isBase64) {
      bytes = bytesFromBase64(payload)
      encoding = 'base64'
    } else {
      let text
      try {
        text = decodeURIComponent(payload)
        encoding = text === payload ? 'plain' : 'percent'
      } catch {
        text = payload
        encoding = 'plain'
      }
      bytes = utf8.encode(text)
    }
  } catch {
    return null
  }
  return { mime, charset, encoding, bytes, size: bytes.length, text: isTextMime(mime) ? decoder.decode(bytes) : null }
}

// --- what a piece of art reaches out for ---

const NAMESPACE_HOSTS = /^(www\.)?w3\.org$/i
const SKIP_SCHEMES = /^(data|javascript|about|mailto|blob|tel):/i

const attrValue = (attrs, name) => {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return match ? (match[1] ?? match[2] ?? match[3] ?? '').trim() : null
}

const TAG_KINDS = {
  script: 'script',
  link: 'stylesheet',
  img: 'image',
  image: 'image',
  feimage: 'image',
  use: 'image',
  iframe: 'embed',
  embed: 'embed',
  object: 'embed',
  source: 'media',
  video: 'media',
  audio: 'media',
  track: 'media',
  'font-face-uri': 'font',
}

const FONT_EXTENSION = /\.(woff2?|ttf|otf|eot)([?#]|$)/i

/**
 * Every outside resource a document would fetch to render: script and stylesheet tags, images,
 * fonts, CSS url() and @import, JS imports, fetch and XHR targets. Inline data: URIs are not
 * dependencies (they travel with the document) and are collected separately. A `#fragment`,
 * an XML namespace and a `javascript:` handler are identifiers, not fetches.
 *
 * Deliberately conservative: bare URL strings in code are ignored, because an inlined library
 * is full of documentation links and error-message URLs that nothing ever downloads.
 *
 * @param {string} text The document, CSS or script source.
 * @param {{parentCls?: string}} [context] Storage class of the document itself — a relative
 * path resolves against the same host, or against nothing when the document is inline data.
 * @returns {Array<{url: string, kind: string, cls: string, host: string|null, relative: boolean}>}
 */
export function scanDependencies(text, { parentCls = 'unknown' } = {}) {
  if (typeof text !== 'string' || !text) return []
  const found = new Map()
  const add = (url, kind) => {
    const value = String(url || '').trim()
    if (!value || value.startsWith('#') || SKIP_SCHEMES.test(value) || found.has(value)) return
    const location = classifyUri(value)
    if (location.cls === 'unknown' && !/^[a-z][a-z0-9+.-]*:/i.test(value)) return
    if (location.cls === 'unknown') return
    if (location.host && NAMESPACE_HOSTS.test(location.host)) return
    const relative = location.cls === 'relative'
    // A relative path inside inline data has nothing to resolve against: it is a fetch that
    // can only fail. Inside a hosted document it lands on the same storage as the document.
    const cls = relative ? (parentCls === 'onchain' || parentCls === 'none' ? 'unresolvable' : parentCls) : location.cls
    found.set(value, { url: value, kind: FONT_EXTENSION.test(value) ? 'font' : kind, cls, host: location.host || null, cid: location.cid || null, relative })
  }

  // Markup: every tag that carries a fetchable attribute
  const tagPattern = /<([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*)>/g
  let match
  while ((match = tagPattern.exec(text)) !== null) {
    const tag = match[1].toLowerCase()
    const attrs = match[2]
    const kind = TAG_KINDS[tag]
    if (!kind) continue
    const candidates = [attrValue(attrs, 'src'), attrValue(attrs, 'href'), attrValue(attrs, 'xlink:href'), attrValue(attrs, 'data'), attrValue(attrs, 'poster'), attrValue(attrs, 'srcset')?.split(',')[0]?.trim().split(/\s+/)[0]]
    let resolvedKind = kind
    if (tag === 'link') {
      const rel = (attrValue(attrs, 'rel') || '').toLowerCase()
      const as = (attrValue(attrs, 'as') || '').toLowerCase()
      if (/icon|manifest|canonical|alternate|author|license|dns-prefetch|preconnect/.test(rel)) continue
      resolvedKind = rel.includes('stylesheet') ? 'stylesheet' : as === 'font' ? 'font' : as === 'script' || rel.includes('modulepreload') ? 'script' : as === 'image' ? 'image' : 'stylesheet'
    }
    for (const candidate of candidates) if (candidate) add(candidate, resolvedKind)
  }

  // Styles: url() and @import, inline or in a stylesheet
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi
  while ((match = urlPattern.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 400), match.index)
    add(match[2], /@font-face/i.test(before) && !/\}/.test(before.slice(before.lastIndexOf('@font-face'))) ? 'font' : 'style-asset')
  }
  const importPattern = /@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/gi
  while ((match = importPattern.exec(text)) !== null) add(match[1], 'stylesheet')

  // Script: module imports, dynamic imports, workers, network calls, assigned sources
  const scriptPatterns = [
    [/\bimport\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g, 'script'],
    [/\bimport\(\s*['"]([^'"]+)['"]/g, 'script'],
    [/\bimportScripts\(\s*['"]([^'"]+)['"]/g, 'script'],
    [/\bnew\s+(?:Worker|SharedWorker)\(\s*['"]([^'"]+)['"]/g, 'script'],
    [/\bfetch\(\s*['"]([^'"]+)['"]/g, 'fetch'],
    [/\.open\(\s*['"][A-Za-z]+['"]\s*,\s*['"]([^'"]+)['"]/g, 'fetch'],
    [/\bnew\s+(?:WebSocket|EventSource)\(\s*['"]([^'"]+)['"]/g, 'fetch'],
    [/\bnew\s+Image\([^)]*\)[^;]{0,80}?\.src\s*=\s*['"]([^'"]+)['"]/g, 'image'],
    [/\.src\s*=\s*['"]((?:https?:|ipfs:|ar:)[^'"]+)['"]/g, 'media'],
    [/\bloadImage\(\s*['"]([^'"]+)['"]/g, 'image'],
    [/\bloadFont\(\s*['"]([^'"]+)['"]/g, 'font'],
    [/\bloadJSON\(\s*['"]([^'"]+)['"]/g, 'fetch'],
    [/\bloadStrings\(\s*['"]([^'"]+)['"]/g, 'fetch'],
  ]
  for (const [pattern, kind] of scriptPatterns) {
    while ((match = pattern.exec(text)) !== null) add(match[1], kind)
  }

  return [...found.values()]
}

const EMBEDDED_LIMIT = 24

/**
 * Inline data: URIs nested inside a document — fonts in an SVG, an image in an HTML page, a
 * script in a page — largest first. These render with the document and never leave the chain.
 * @param {string} text
 * @returns {Array<{uri: string, mime: string, encoding: string, size: number}>}
 */
export function findEmbeddedDataUris(text) {
  if (typeof text !== 'string' || !text) return []
  const pattern = /data:[a-z0-9.+\-]+\/[a-z0-9.+\-]+(?:;[a-z0-9=\-]+)*,[^'")\s<>]*/gi
  const found = []
  const seen = new Set()
  let match
  while ((match = pattern.exec(text)) !== null && found.length < EMBEDDED_LIMIT * 4) {
    const uri = match[0]
    const key = `${uri.length}:${uri.slice(0, 96)}`
    if (seen.has(key)) continue
    seen.add(key)
    const decoded = decodeDataUri(uri)
    if (!decoded) continue
    found.push({ uri, mime: decoded.mime, encoding: decoded.encoding, size: decoded.size })
  }
  return found.sort((a, b) => b.size - a.size).slice(0, EMBEDDED_LIMIT)
}

// --- the verdict ---

export const INSPECT_LEVELS = {
  onchain: { label: 'Fully onchain', tone: 'good', hint: 'Metadata and artwork are inline data; nothing outside the chain is needed to render it' },
  'onchain-dependencies': { label: 'Onchain, with outside dependencies', tone: 'warn', hint: 'The token itself is inline data, but its artwork loads something from outside the chain to render' },
  'partly-onchain': { label: 'Partly onchain', tone: 'warn', hint: 'One of the metadata document or the artwork is inline data; the other lives in storage' },
  'offchain-decentralized': { label: 'Offchain, on content-addressed storage', tone: 'neutral', hint: 'Metadata and artwork live on IPFS or Arweave: safe for as long as someone keeps them' },
  'offchain-centralized': { label: 'Offchain, on a web server', tone: 'bad', hint: 'At least one of the document or the artwork depends on an ordinary web host staying up' },
  unknown: { label: 'Could not be decoded', tone: 'neutral', hint: 'No metadata could be read for this token' },
}

export const describeLevel = (level) => INSPECT_LEVELS[level] || INSPECT_LEVELS.unknown

export const STORAGE_CLASSES = {
  onchain: { label: 'Onchain', tone: 'good' },
  ipfs: { label: 'IPFS', tone: 'neutral' },
  'ipfs-gateway': { label: 'IPFS via gateway', tone: 'neutral' },
  arweave: { label: 'Arweave', tone: 'good' },
  web2: { label: 'Web server', tone: 'warn' },
  relative: { label: 'Same host', tone: 'neutral' },
  unresolvable: { label: 'Unresolvable', tone: 'bad' },
  none: { label: 'Missing', tone: 'bad' },
  unknown: { label: 'Unrecognised', tone: 'bad' },
}

export const describeStorageClass = (cls) => STORAGE_CLASSES[cls] || STORAGE_CLASSES.unknown

export const LAYER_ROLES = {
  pointer: 'Token pointer',
  metadata: 'Metadata document',
  image: 'Artwork',
  image_data: 'Inline artwork',
  animation: 'Animation',
  icon: 'Icon',
  banner: 'Background',
  asset: 'Asset',
  embedded: 'Embedded',
}

export const DEPENDENCY_KINDS = {
  script: 'Script',
  stylesheet: 'Stylesheet',
  image: 'Image',
  font: 'Font',
  media: 'Media',
  embed: 'Embedded page',
  fetch: 'Network call',
  'style-asset': 'Style asset',
}

const isIpfs = (cls) => cls === 'ipfs' || cls === 'ipfs-gateway'
const isDecentralized = (cls) => isIpfs(cls) || cls === 'arweave'

const whereText = (cls, what) => {
  switch (cls) {
    case 'onchain':
      return `${what} is inline data — it comes straight out of the contract.`
    case 'ipfs':
    case 'ipfs-gateway':
      return `${what} is on IPFS: content-addressed, kept for as long as someone pins it.`
    case 'arweave':
      return `${what} is on Arweave, paid for once and kept permanently.`
    case 'web2':
      return `${what} is on an ordinary web server — it vanishes if that site goes down.`
    case 'none':
      return `${what} is missing.`
    default:
      return `${what} points somewhere this inspector does not recognise.`
  }
}

const whereTone = (cls) => (cls === 'onchain' || cls === 'arweave' ? 'good' : isIpfs(cls) ? 'neutral' : cls === 'web2' ? 'warn' : 'bad')

/**
 * The five questions a collector asks, answered from the layers, and the level they add up to.
 * @param {Object} facts
 * @param {Object|null} facts.metadata The metadata layer.
 * @param {Object|null} facts.artwork The primary artwork layer (image, else animation).
 * @param {Object|null} facts.animation The animation layer when separate from the artwork.
 * @param {Array} facts.dependencies Every outside resource any layer reaches for.
 * @param {Array|null} facts.renderers Contracts touched while the pointer was computed; null when unknown.
 * @param {Object} facts.contract Mutability facts.
 * @param {boolean|null} facts.exists Whether the id has an owner.
 * @returns {{level: string, checks: Array, summary: string}}
 */
export function verdictFor({ metadata, artwork, animation = null, dependencies = [], renderers = null, contract = {}, exists = null }) {
  const metadataCls = metadata?.cls || 'none'
  const metadataReachable = metadata && metadata.reachable !== false && (metadata.cls === 'onchain' || metadata.json)
  const artworkCls = artwork?.cls || 'none'
  const external = dependencies.filter((dependency) => dependency.cls !== 'onchain')
  const hasCode = Boolean(artwork?.scanned || animation?.scanned)

  const checks = []

  checks.push({
    key: 'metadata',
    label: 'Metadata',
    tone: metadataReachable ? whereTone(metadataCls) : 'bad',
    text: !metadata
      ? 'No metadata pointer could be read for this token.'
      : !metadataReachable
        ? `${whereText(metadataCls, 'The document')} It could not be fetched just now.`
        : `${whereText(metadataCls, 'The document')}${metadata.hash === 'pass' ? ' It matches the hash committed onchain.' : metadata.hash === 'fail' ? ' It does NOT match the hash committed onchain.' : ''}`,
  })

  checks.push({
    key: 'artwork',
    label: 'Artwork',
    tone: !artwork ? 'bad' : artwork.reachable === false ? 'bad' : whereTone(artworkCls),
    text: !artwork
      ? 'The document names no artwork.'
      : artwork.reachable === false
        ? `${whereText(artworkCls, 'The artwork')} It could not be fetched just now.`
        : `${whereText(artworkCls, 'The artwork')}${artwork.mime ? ` (${artwork.mime}${artwork.size ? `, ${formatBytes(artwork.size)}` : ''})` : ''}${animation && animation !== artwork ? ` The animation ${animation.cls === 'onchain' ? 'is inline data too' : `lives on ${describeStorageClass(animation.cls).label.toLowerCase()}`}.` : ''}`,
  })

  const onchainDeps = dependencies.length - external.length
  checks.push({
    key: 'dependencies',
    label: 'Dependencies',
    tone: !hasCode ? 'neutral' : external.length === 0 ? 'good' : external.some((dependency) => dependency.cls === 'web2' || dependency.cls === 'unresolvable') ? 'bad' : 'warn',
    text: !hasCode
      ? 'The artwork is a plain file with no code inside it — there is nothing for it to load.'
      : dependencies.length === 0
        ? 'The artwork is self-contained: no scripts, fonts or images are loaded from anywhere.'
        : external.length === 0
          ? `Everything the artwork loads (${onchainDeps}) travels inside it as inline data.`
          : `The artwork loads ${external.length} ${external.length === 1 ? 'resource' : 'resources'} from outside: ${summariseHosts(external)}.`,
  })

  const foreign = Array.isArray(renderers) ? renderers.filter((entry) => entry.role !== 'implementation') : null
  const proxied = foreign?.some((entry) => entry.isProxy) || false
  checks.push({
    key: 'rendering',
    label: 'Rendering',
    tone: renderers === null ? 'neutral' : proxied ? 'warn' : 'good',
    text:
      renderers === null
        ? 'Which contracts take part in rendering could not be traced on this network.'
        : foreign.length === 0
          ? 'The collection contract answers for the token on its own — no renderer or library contract is involved.'
          : `${foreign.length} other ${foreign.length === 1 ? 'contract takes' : 'contracts take'} part in rendering${proxied ? ', and at least one of them is upgradeable' : ', none of them upgradeable'}.`,
  })

  checks.push({
    key: 'mutability',
    label: 'Can it change?',
    tone: contract.isProxy ? 'warn' : contract.frozen || contract.mutable === false ? 'good' : 'warn',
    text: contract.isProxy
      ? 'The collection is a proxy: its owner can swap the code behind the address, pointers and all.'
      : contract.frozen
        ? 'The collection froze its metadata — what this token points at can never change again.'
        : contract.mutable === false
          ? 'Nobody can change where this token points — not even the creator.'
          : contract.renounced
            ? 'Ownership was renounced, so the setters that remain have nobody to call them.'
            : `The owner can still change where this token points${contract.setters?.length ? ` (${contract.setters.join(', ')})` : ''}.`,
  })

  let level
  if (!metadata || (!metadataReachable && metadataCls !== 'onchain')) level = 'unknown'
  else if (metadataCls === 'onchain' && artworkCls === 'onchain') level = external.length > 0 ? 'onchain-dependencies' : 'onchain'
  else if (metadataCls === 'onchain' || artworkCls === 'onchain') level = 'partly-onchain'
  else if (isDecentralized(metadataCls) && (isDecentralized(artworkCls) || artworkCls === 'none')) level = external.some((dependency) => dependency.cls === 'web2') ? 'offchain-centralized' : 'offchain-decentralized'
  else level = 'offchain-centralized'

  const summary = summaryFor({ level, metadataCls, artworkCls, external, foreign, contract, exists })
  return { level, checks, summary }
}

const summariseHosts = (dependencies) => {
  const hosts = [...new Set(dependencies.map((dependency) => (dependency.cls === 'unresolvable' ? 'a path that cannot resolve' : dependency.host || describeStorageClass(dependency.cls).label.toLowerCase())))]
  return hosts.length <= 3 ? hosts.join(', ') : `${hosts.slice(0, 3).join(', ')} and ${hosts.length - 3} more`
}

const summaryFor = ({ level, metadataCls, artworkCls, external, foreign, contract, exists }) => {
  const opening = {
    onchain: 'This token lives entirely onchain: the metadata and the artwork are inline data',
    'onchain-dependencies': `This token is inline data, but its artwork pulls ${external.length} ${external.length === 1 ? 'resource' : 'resources'} from outside the chain to render`,
    'partly-onchain': metadataCls === 'onchain' ? 'The metadata is inline data, but the artwork lives in storage' : 'The artwork is inline data inside a document that lives in storage',
    'offchain-decentralized': 'This token points at content-addressed storage — it survives as long as someone keeps a copy',
    'offchain-centralized': `This token depends on ${artworkCls === 'web2' || metadataCls === 'web2' ? 'a web server' : 'an outside host'} staying up`,
    unknown: 'No metadata could be decoded for this token',
  }[level]
  const rendering = foreign && foreign.length > 0 ? `, rendered with the help of ${foreign.length} other ${foreign.length === 1 ? 'contract' : 'contracts'}` : ''
  const control = contract.isProxy ? ' The contract is upgradeable.' : contract.frozen || contract.mutable === false ? ' Its pointers are locked.' : ' Its owner can still move the pointers.'
  const minted = exists === false ? ' This id has no owner — it may not have been minted.' : ''
  return `${opening}${rendering}.${control}${minted}`
}

// --- formatting ---

const BYTE_UNITS = [
  [1024 ** 3, 'gigabyte'],
  [1024 ** 2, 'megabyte'],
  [1024, 'kilobyte'],
  [1, 'byte'],
]

/**
 * "1.2 MB", via Intl. Null in, dash out.
 * @param {number|null|undefined} size
 * @returns {string}
 */
export const formatBytes = (size) => {
  if (size === null || size === undefined || !Number.isFinite(Number(size))) return '—'
  const value = Number(size)
  const [divisor, unit] = BYTE_UNITS.find(([threshold]) => value >= threshold) || BYTE_UNITS[BYTE_UNITS.length - 1]
  return new Intl.NumberFormat(undefined, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: divisor === 1 ? 0 : 1 }).format(value / divisor)
}

/** A URI shortened for a table cell; a data: URI reduced to its header and length. */
export const shortenUri = (uri, keep = 18) => {
  if (!uri || typeof uri !== 'string') return '—'
  if (/^data:/i.test(uri)) {
    const comma = uri.indexOf(',')
    return `${uri.slice(0, comma === -1 ? 40 : Math.min(comma + 1, 48))}… (${new Intl.NumberFormat().format(uri.length)} chars)`
  }
  if (uri.length <= keep * 2 + 1) return uri
  return `${uri.slice(0, keep)}…${uri.slice(-keep)}`
}

/** What a layer's "where" cell says beneath the class: the CID for IPFS, the host otherwise. */
export const referenceOf = (layer) => {
  if (!layer) return null
  if (layer.cls === 'onchain') return layer.encoding ? `inline ${layer.encoding}` : 'inline data'
  if (layer.cls === 'ipfs' || layer.cls === 'ipfs-gateway') return shortenUri(layer.cid || layer.root || '', 8)
  if (layer.cls === 'none') return null
  return layer.host || shortenUri(layer.uri, 14)
}
