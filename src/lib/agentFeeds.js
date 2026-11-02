/**
 * @file lib/agentFeeds.js
 * @description Reads a public RSS or Atom feed for a hosted agent's read_feed tool. Server-only.
 *
 * The agent picks the URL (from a skill, its owner or a post), so this is the narrow, read-only
 * slice of outside access: GET only, no cookies or keys, public hosts on the standard ports, and
 * every address a name resolves to is checked at connect time — so a name that resolves to a
 * private range, or re-resolves to one between check and connect, is refused, redirects included.
 * What comes back is trimmed to plain text and is data for the model, never instructions.
 */

import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import { XMLParser } from 'fast-xml-parser'

const FETCH_TIMEOUT_MS = 8000
const MAX_FEED_BYTES = 1024 * 1024
const MAX_REDIRECTS = 3
export const FEED_ITEMS_MAX = 20
const FEED_ITEMS_DEFAULT = 10
// Five feeds of ten items is the most one turn reads; short summaries keep that within budget
const SUMMARY_MAX_CHARS = 280
const TITLE_MAX_CHARS = 200

const USER_AGENT = 'Mozilla/5.0 (compatible; Hupbot/1.0; +https://hup.social)'

// Every range a feed must not resolve to: loopback, private, link-local (cloud metadata), CGNAT,
// multicast and reserved, in both families. No ::ffff:0:0/96 rule: BlockList matches IPv4 against
// mapped ranges, so it would block every IPv4 host; mapped addresses are unwrapped below instead
const blocked = new net.BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
]) {
  blocked.addSubnet(address, prefix, 'ipv4')
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  blocked.addSubnet(address, prefix, 'ipv6')
}

const isPublicAddress = (address, family) => {
  // ::ffff:10.0.0.1 is 10.0.0.1, and is judged as that; URL writes it as ::ffff:a00:1
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1]
  if (dotted) return !blocked.check(dotted, 'ipv4')
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address)
  if (hex) {
    const [high, low] = [parseInt(hex[1], 16), parseInt(hex[2], 16)]
    return !blocked.check(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`, 'ipv4')
  }
  return !blocked.check(address, family === 6 || family === 'IPv6' ? 'ipv6' : 'ipv4')
}

// The socket's own resolver: whatever the name resolves to is checked right before connecting
const guardedLookup = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error)
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }]
    if (list.length === 0 || list.some(({ address, family }) => !isPublicAddress(address, family))) {
      return callback(Object.assign(new Error('Host is not reachable from here'), { code: 'EBLOCKED' }))
    }
    if (options.all) return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

const feedError = (message) => Object.assign(new Error(message), { expose: true })

const isAllowedUrl = (value) => {
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  // Odd ports are internal services more often than feeds
  if (url.username || url.password || !['', '80', '443'].includes(url.port)) return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return false
  // A literal IP skips the lookup, so it is checked here
  const family = net.isIP(host)
  return family === 0 || isPublicAddress(host, family)
}

/** One GET, bounded in time and size; resolves to a redirect location or the body. */
const getOnce = (url) =>
  new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const request = client.get(
      url,
      {
        lookup: guardedLookup,
        timeout: FETCH_TIMEOUT_MS,
        headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5' },
      },
      (response) => {
        const { statusCode = 0, headers } = response
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          response.resume()
          return resolve({ location: new URL(headers.location, url) })
        }
        if (statusCode < 200 || statusCode >= 300) {
          response.resume()
          return reject(feedError(`The feed answered ${statusCode}`))
        }
        const chunks = []
        let total = 0
        response.on('data', (chunk) => {
          total += chunk.length
          if (total > MAX_FEED_BYTES) {
            request.destroy(feedError('The feed is too large'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }))
        response.on('error', reject)
      },
    )
    request.on('timeout', () => request.destroy(feedError('The feed took too long to answer')))
    request.on('error', (error) => reject(error.code === 'EBLOCKED' ? feedError('That address is not a public website') : error))
    // The whole response, not just each idle gap, must finish in time
    setTimeout(() => request.destroy(feedError('The feed took too long to answer')), FETCH_TIMEOUT_MS).unref()
  })

const fetchFeed = async (startUrl) => {
  let current = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isAllowedUrl(current)) throw feedError('Only public http(s) feed links can be read')
    const { location, body } = await getOnce(new URL(current))
    if (!location) return { body, finalUrl: current }
    current = location.toString()
  }
  throw feedError('The feed redirected too many times')
}

// --- Parsing ---

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  removeNSPrefix: true,
  // Entities are decoded below, by hand; the parser's own expansion is where XML bombs live
  processEntities: false,
  htmlEntities: false,
  isArray: (name) => name === 'item' || name === 'entry' || name === 'link',
})

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decodeEntities = (value) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase()
    try {
      if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16))
      if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)))
    } catch {
      return match
    }
    return NAMED_ENTITIES[lower] ?? match
  })

// A node's text, whether the parser gave a string, a number or { '#text': … }
const textOf = (node) => {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return textOf(node[0])
  return textOf(node['#text'])
}

// Feed text is often HTML, sometimes HTML escaped twice: down to plain words either way
const plain = (value, max) => {
  const text = decodeEntities(
    decodeEntities(textOf(value).replace(/<!\[CDATA\[|\]\]>/g, ''))
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

const safeLink = (value, base) => {
  try {
    const url = new URL(decodeEntities(String(value ?? '').trim()), base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

// RSS gives <link>text</link>; Atom gives <link href rel>, preferring rel="alternate"
const linkOf = (links, base) => {
  for (const link of links ?? []) {
    if (typeof link === 'string') return safeLink(link, base)
    if (link?.['@href'] && (!link['@rel'] || link['@rel'] === 'alternate')) return safeLink(link['@href'], base)
  }
  const first = links?.[0]
  return first ? safeLink(typeof first === 'string' ? first : first['@href'] ?? textOf(first), base) : null
}

const dateOf = (...values) => {
  for (const value of values) {
    const time = Date.parse(textOf(value))
    if (Number.isFinite(time)) return new Date(time).toISOString().slice(0, 10)
  }
  return null
}

const parseFeed = (xml, base, limit) => {
  let document
  try {
    document = parser.parse(xml)
  } catch {
    throw feedError('That link is not an RSS or Atom feed')
  }
  // RSS 2.0 keeps items in the channel, RSS 1.0 (RDF) beside it, Atom calls them entries
  const channel = document?.rss?.channel ?? document?.RDF?.channel
  const feed = document?.feed
  if (!channel && !feed) throw feedError('That link is not an RSS or Atom feed')
  const rawItems = (channel ? (channel.item ?? document.RDF?.item) : feed.entry) ?? []

  const items = rawItems.slice(0, limit).map((item) => ({
    title: plain(item.title, TITLE_MAX_CHARS) || '(untitled)',
    link: linkOf(item.link, base) ?? (item.guid?.['@isPermaLink'] !== 'false' ? safeLink(textOf(item.guid), base) : null),
    published: dateOf(item.pubDate, item.published, item.updated, item.date),
    summary: plain(item.description ?? item.summary ?? item.content ?? item.encoded, SUMMARY_MAX_CHARS),
  }))

  const source = channel ?? feed
  return { feed: plain(source.title, TITLE_MAX_CHARS) || new URL(base).hostname, link: linkOf(source.link, base), items }
}

/**
 * The latest items of a public RSS or Atom feed, as plain text.
 * @param {string} url
 * @param {{limit?: number}} [options]
 * @returns {Promise<{feed: string, link: string|null, items: {title: string, link: string|null, published: string|null, summary: string}[]}>}
 * @throws {Error} With `expose: true` when the message is safe to hand the model.
 */
export const readFeed = async (url, { limit = FEED_ITEMS_DEFAULT } = {}) => {
  const count = Math.min(Math.max(Math.trunc(Number(limit)) || FEED_ITEMS_DEFAULT, 1), FEED_ITEMS_MAX)
  const { body, finalUrl } = await fetchFeed(String(url ?? '').trim())
  return parseFeed(body, finalUrl, count)
}
