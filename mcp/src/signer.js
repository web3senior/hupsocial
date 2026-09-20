/**
 * @file mcp/src/signer.js
 * The headless write path. An agent holds one private key and acts as itself: the post
 * document is pinned to IPFS through the app, the call is encoded against the core
 * contract, and it goes out either as a signed ERC-2771 request the Hup relayer pays for,
 * or as a direct transaction the agent pays for.
 */

import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { createPublicClient, createWalletClient, encodeFunctionData, fallback, formatEther, getAddress, http as viemHttp, isAddress, parseEventLogs } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { CONTENT_TYPE, FORWARD_REQUEST_TYPES, FORWARDER_ABI, HUP_ABI, LSP26_ABI } from './abi.js'
import { chainEntry, txUrl } from './config.js'

const MAX_POST_LENGTH = 5000
const MAX_MEDIA_ITEMS = 8
const RELAY_DEADLINE_SECONDS = 300
const RECEIPT_TIMEOUT_MS = 90_000

/** Gas ceilings the app's relay helper uses; the relayer adds its own margin on top. */
const RELAY_GAS = {
  create: () => 600_000n,
  update: () => 300_000n,
  deleteContent: () => 200_000n,
  batchLike: (args) => 150_000n + 45_000n * BigInt(args[1].length || 1),
  unlike: () => 150_000n,
}

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
}

export class RelayRefused extends Error {
  constructor(status, message, retryAfter) {
    super(message)
    this.name = 'RelayRefused'
    this.status = status
    this.retryAfter = retryAfter
  }
}

/** Lone UTF-16 surrogates break JSON consumers downstream; the composer strips them too. */
const stripLoneSurrogates = (text) =>
  String(text ?? '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1')

const requireAddress = (value, label = 'address') => {
  if (!isAddress(String(value ?? ''))) throw new Error(`${label} must be a 0x address`)
  return getAddress(value)
}

/**
 * @param {{ privateKey: string, http: ReturnType<import('./http.js').createHttp> }} options
 */
export function createSigner({ privateKey, http }) {
  const key = String(privateKey ?? '').trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('HUP_AGENT_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key')
  const account = privateKeyToAccount(key)
  const clients = new Map()

  const clientsFor = (entry) => {
    let pair = clients.get(entry.id)
    if (!pair) {
      const transport = fallback(entry.chain.rpcUrls.default.http.map((url) => viemHttp(url, { timeout: 12_000 })))
      pair = {
        publicClient: createPublicClient({ chain: entry.chain, transport }),
        walletClient: createWalletClient({ account, chain: entry.chain, transport }),
      }
      clients.set(entry.id, pair)
    }
    return pair
  }

  /** The post document exactly as the composer writes it. */
  function buildDocument({ text, media = [], quoteOf } = {}) {
    const body = stripLoneSurrogates(text).trim()
    if (body.length > MAX_POST_LENGTH) throw new Error(`Post text is ${body.length} characters; the limit is ${MAX_POST_LENGTH}`)
    if (media.length > MAX_MEDIA_ITEMS) throw new Error(`At most ${MAX_MEDIA_ITEMS} media items per post`)
    if (!body && media.length === 0) throw new Error('A post needs text or media')
    const doc = {
      version: '1',
      elements: [
        { type: 'text', data: { text: body } },
        { type: 'media', data: { items: media } },
      ],
    }
    if (quoteOf) doc.quoteOf = String(quoteOf)
    doc.author = account.address
    return doc
  }

  /** The same pre-check the composer runs; a blocked verdict stops the post before anything is pinned. */
  async function moderate(doc) {
    const res = await http.request('/api/moderation/check', { method: 'POST', body: { content: doc } })
    if (!res.ok || !res.body || typeof res.body !== 'object') return { checked: false }
    if (res.body.blocked) {
      const categories = (res.body.blockedCategories ?? res.body.categories ?? []).join(', ')
      throw new Error(`Moderation blocked this content${categories ? ` (${categories})` : ''}`)
    }
    return { checked: true, flagged: Boolean(res.body.flagged) }
  }

  async function pinObject(doc) {
    const body = await http.post('/api/ipfs/object', doc)
    if (!body?.cid) throw new Error('IPFS pin returned no cid')
    return body.cid
  }

  /**
   * Pins one media file from a local path or an http(s) URL through the app's uploader.
   * @returns {Promise<object>} a media item for the document
   */
  async function pinMedia({ source, alt = '' }) {
    let bytes
    let mime
    let name
    if (/^https?:\/\//i.test(source)) {
      const res = await fetch(source)
      if (!res.ok) throw new Error(`Could not fetch media ${source} (${res.status})`)
      bytes = Buffer.from(await res.arrayBuffer())
      mime = (res.headers.get('content-type') || '').split(';')[0].trim()
      name = basename(new URL(source).pathname) || 'upload'
    } else {
      bytes = await readFile(source)
      name = basename(source)
    }
    mime = mime || MIME_BY_EXT[extname(name).toLowerCase()] || 'application/octet-stream'
    const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : null
    if (!kind) throw new Error(`Unsupported media type ${mime} for ${name}`)
    const form = new FormData()
    form.set('file', new Blob([bytes], { type: mime }), name)
    const body = await http.json('/api/ipfs/file', { method: 'POST', form, timeoutMs: 120_000 })
    if (!body?.cid) throw new Error('Media upload returned no cid')
    return { type: kind, cid: body.cid, alt: String(alt ?? ''), storage: 'IPFS', mimeType: mime }
  }

  async function assertMetadataFits(entry, uri) {
    const { publicClient } = clientsFor(entry)
    const max = await publicClient.readContract({ address: entry.hup, abi: HUP_ABI, functionName: 'maxMetadataBytes' })
    const size = Buffer.byteLength(uri, 'utf8')
    if (BigInt(size) > max) throw new Error(`Metadata URI is ${size} bytes; this chain allows ${max}`)
  }

  async function relay(entry, functionName, args) {
    const { publicClient } = clientsFor(entry)
    const trusted = await publicClient.readContract({
      address: entry.hup,
      abi: HUP_ABI,
      functionName: 'isTrustedForwarder',
      args: [entry.forwarder],
    })
    if (!trusted) throw new RelayRefused(0, `Hup on ${entry.slug} does not trust its forwarder yet; send a direct transaction`)
    const data = encodeFunctionData({ abi: HUP_ABI, functionName, args })
    const gas = RELAY_GAS[functionName](args)
    let nonce = await publicClient.readContract({ address: entry.forwarder, abi: FORWARDER_ABI, functionName: 'nonces', args: [account.address] })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const deadline = Math.floor(Date.now() / 1000) + RELAY_DEADLINE_SECONDS
      const message = { from: account.address, to: entry.hup, value: 0n, gas, nonce, deadline, data }
      const signature = await account.signTypedData({
        domain: { name: entry.forwarderName, version: '1', chainId: entry.id, verifyingContract: entry.forwarder },
        types: FORWARD_REQUEST_TYPES,
        primaryType: 'ForwardRequest',
        message,
      })
      const res = await http.request('/api/v1/relay', {
        method: 'POST',
        timeoutMs: 60_000,
        body: {
          request: { ...message, value: '0', gas: gas.toString(), nonce: nonce.toString() },
          signature,
          forwarderAddress: entry.forwarder,
          chainId: entry.id,
          forwarderName: entry.forwarderName,
        },
      })
      if (res.status === 409 && res.body?.nonce != null && attempt === 0) {
        nonce = BigInt(res.body.nonce)
        continue
      }
      if (!res.ok) {
        const retryAfter = Number(res.headers.get('retry-after') || res.body?.retryAfter || 0) || undefined
        throw new RelayRefused(res.status, res.body?.error || `relay refused (${res.status})`, retryAfter)
      }
      return { txHash: res.body.txHash, via: 'relay' }
    }
    throw new RelayRefused(409, 'relay nonce kept moving; try again')
  }

  async function direct(entry, functionName, args) {
    const { publicClient, walletClient } = clientsFor(entry)
    const value = functionName === 'create' ? await publicClient.readContract({ address: entry.hup, abi: HUP_ABI, functionName: 'fee' }) : 0n
    const balance = await publicClient.getBalance({ address: account.address })
    if (balance === 0n) {
      throw new Error(`${account.address} holds no ${entry.chain.nativeCurrency.symbol} on ${entry.slug} to pay gas`)
    }
    const txHash = await walletClient.writeContract({ address: entry.hup, abi: HUP_ABI, functionName, args, value })
    return { txHash, via: 'direct' }
  }

  /**
   * Waits for the receipt and reads the created content id when there is one.
   * Times out to a pending result rather than failing: the transaction is already sent.
   */
  async function confirm(entry, sent) {
    const { publicClient } = clientsFor(entry)
    const result = { tx_hash: sent.txHash, via: sent.via, chain: entry.slug, network_id: entry.id, explorer: txUrl(entry, sent.txHash), status: 'pending' }
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: sent.txHash, timeout: RECEIPT_TIMEOUT_MS })
      result.status = receipt.status === 'success' ? 'confirmed' : 'reverted'
      result.block = Number(receipt.blockNumber)
      if (receipt.status === 'success') {
        const created = parseEventLogs({ abi: HUP_ABI, eventName: 'ContentCreated', logs: receipt.logs }).find(
          (log) => log.address.toLowerCase() === entry.hup.toLowerCase(),
        )
        if (created) {
          result.post_id = Number(created.args.id)
          result.url = `${http.base}/networks/${entry.id}/${result.post_id}`
        }
      }
    } catch {
      result.note = 'Not confirmed within 90s; check the explorer link. The feed shows it a few seconds after it confirms.'
    }
    return result
  }

  /**
   * @param {object} params
   * @param {number|string} params.chain
   * @param {'create'|'update'|'deleteContent'|'batchLike'|'unlike'} params.functionName
   * @param {any[]} params.args
   * @param {'auto'|'relay'|'direct'} [params.mode]
   */
  async function write({ chain, functionName, args, mode = 'auto' }) {
    const entry = chainEntry(chain)
    let sent
    if (mode === 'direct') sent = await direct(entry, functionName, args)
    else if (mode === 'relay') sent = await relay(entry, functionName, args)
    else {
      try {
        sent = await relay(entry, functionName, args)
      } catch (error) {
        if (error instanceof RelayRefused && error.status === 429) throw error
        try {
          sent = await direct(entry, functionName, args)
          sent.relay_note = error.message
        } catch (directError) {
          throw new Error(`Gasless relay refused: ${error.message}. Direct send failed: ${directError.shortMessage ?? directError.message}`)
        }
      }
    }
    return confirm(entry, sent)
  }

  async function publish({ chain, type, text, media = [], parentId = 0, allowComments = true, quoteOf, mode }) {
    const items = []
    for (const item of media) items.push(await pinMedia(item))
    const doc = buildDocument({ text, media: items, quoteOf })
    const moderation = await moderate(doc)
    const uri = await pinObject(doc)
    const entry = chainEntry(chain)
    await assertMetadataFits(entry, uri)
    const result = await write({
      chain,
      functionName: 'create',
      args: [account.address, CONTENT_TYPE[type], uri, BigInt(parentId), Boolean(allowComments)],
      mode,
    })
    return { ...result, metadata: uri, moderation }
  }

  async function repost({ chain, postId, mode }) {
    return write({ chain, functionName: 'create', args: [account.address, CONTENT_TYPE.repost, '', BigInt(postId), false], mode })
  }

  async function edit({ chain, postId, text, media = [], allowComments = true, mode }) {
    const items = []
    for (const item of media) items.push(await pinMedia(item))
    const doc = buildDocument({ text, media: items })
    const moderation = await moderate(doc)
    const uri = await pinObject(doc)
    await assertMetadataFits(chainEntry(chain), uri)
    const result = await write({ chain, functionName: 'update', args: [account.address, BigInt(postId), uri, Boolean(allowComments)], mode })
    return { ...result, metadata: uri, moderation }
  }

  const remove = ({ chain, postId, mode }) => write({ chain, functionName: 'deleteContent', args: [account.address, BigInt(postId)], mode })

  const like = ({ chain, postIds, mode }) => {
    const ids = [...new Set(postIds.map((id) => BigInt(id)))]
    if (ids.length === 0 || ids.length > 50) throw new Error('Like between 1 and 50 posts per call')
    return write({ chain, functionName: 'batchLike', args: [account.address, ids], mode })
  }

  const unlike = ({ chain, postId, mode }) => write({ chain, functionName: 'unlike', args: [account.address, BigInt(postId)], mode })

  /** Follow is never relayed: LSP26 attributes the follow to msg.sender, so the agent pays. */
  async function follow({ chain, target, unfollow = false }) {
    const entry = chainEntry(chain)
    if (!entry.followerSystem) throw new Error(`Follow is not deployed on ${entry.slug}`)
    const addr = requireAddress(target, 'target')
    if (addr.toLowerCase() === account.address.toLowerCase()) throw new Error('An account cannot follow itself')
    const { publicClient, walletClient } = clientsFor(entry)
    const already = await publicClient.readContract({ address: entry.followerSystem, abi: LSP26_ABI, functionName: 'isFollowing', args: [account.address, addr] })
    if (already && !unfollow) return { status: 'noop', note: `${account.address} already follows ${addr} on ${entry.slug}` }
    if (!already && unfollow) return { status: 'noop', note: `${account.address} does not follow ${addr} on ${entry.slug}` }
    const balance = await publicClient.getBalance({ address: account.address })
    if (balance === 0n) throw new Error(`${account.address} holds no ${entry.chain.nativeCurrency.symbol} on ${entry.slug}; follow is a direct transaction`)
    const txHash = await walletClient.writeContract({
      address: entry.followerSystem,
      abi: LSP26_ABI,
      functionName: unfollow ? 'unfollow' : 'follow',
      args: [addr],
    })
    const result = await confirm(entry, { txHash, via: 'direct' })
    result.target = addr
    return result
  }

  /** Signs the profile challenge and saves the offchain profile fields. */
  async function updateProfile(fields) {
    const address = account.address
    await http.request(`/api/v1/users/profile/${address}`, { method: 'POST', body: { wallet_address: address } })
    const challenge = await http.post('/api/v1/auth/nonce', { wallet_address: address })
    if (!challenge?.nonce) throw new Error('Could not get a signing challenge')
    const issuedAt = Date.now()
    const message = ['Update your Hup profile', '', `Wallet: ${address.toLowerCase()}`, `Nonce: ${challenge.nonce}`, `Timestamp: ${issuedAt}`].join('\n')
    const signature = await account.signMessage({ message })
    const form = new FormData()
    form.set('nonce', challenge.nonce)
    form.set('issuedAt', String(issuedAt))
    form.set('signature', signature)
    if (fields.name != null) form.set('name', String(fields.name))
    if (fields.description != null) form.set('description', String(fields.description))
    if (fields.tags) form.set('tags', JSON.stringify(fields.tags))
    if (fields.links) form.set('links', JSON.stringify(fields.links.map((l) => ({ name: l.name, url: l.url }))))
    if (fields.profileImage) form.set('profileImage', String(fields.profileImage))
    const body = await http.json(`/api/v1/users/profile/${address}`, { method: 'PUT', form, timeoutMs: 60_000 })
    return { address, saved: body?.data ?? body ?? null, url: `${http.base}/${address}` }
  }

  async function balances() {
    const { CHAINS } = await import('./config.js')
    const rows = await Promise.all(
      CHAINS.map(async (entry) => {
        try {
          const { publicClient } = clientsFor(entry)
          const wei = await publicClient.getBalance({ address: account.address })
          return { chain: entry.slug, network_id: entry.id, balance: `${formatEther(wei)} ${entry.chain.nativeCurrency.symbol}` }
        } catch (error) {
          return { chain: entry.slug, network_id: entry.id, error: error.shortMessage ?? error.message }
        }
      }),
    )
    return rows
  }

  return { address: account.address, buildDocument, publish, repost, edit, remove, like, unlike, follow, updateProfile, balances, write }
}
