/**
 * @file lib/storeSalesIndex.js
 * @description Sales history index for HupBazzar purchases. The chain keys everything by
 * postId — no seller enumeration, no per-sale record, no dates — but every purchase emits
 * ItemBought (seller indexed), so this module incrementally scans ItemListed / ItemUpdated /
 * ItemBought logs per network into MySQL. ItemBought carries no paymentToken; the scan
 * replays the Listed/Updated stream in (blockNumber, logIndex) order to attribute the exact
 * token each sale was paid in, correct even across mid-life payment-token switches
 * (store_listing_tokens persists that state across scan windows — store_listings can't,
 * since it deletes inactive rows). Sync is lazy and throttled, triggered on API hits,
 * mirroring storeListingsIndex — no cron infra exists.
 */

import Web3 from 'web3'
import pool from '@/lib/db'
import { config, CONTRACTS } from '@/config/wagmi'
import { STORE_ADDRESSES, STORE_DEPLOY_BLOCKS, USDC } from '@/lib/tokens'
import storeAbi from '@/abis/HupBazzar.json'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const SCAN_CHUNK_BLOCKS = 5_000
const MIN_CHUNK_BLOCKS = 250
const MAX_CHUNKS_PER_RUN = 10 // bounds latency per invocation; the cursor persists per chunk
const REORG_REWIND_BLOCKS = 10 // re-scan overlap for shallow reorgs; INSERT IGNORE dedupes
const SYNC_THROTTLE_MS = 60_000

const ERC20_META_ABI = [
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
]

// Canonical event fragments, deliberately NOT taken from abis/HupBazzar.json: the ABI tracks
// the next contract version while already-deployed stores keep emitting the old shape forever.
// ItemBought exists in two shapes — v1 (6 fields, current LUKSO deployment) and v2 (adds
// paymentToken + feeAmount precisely so indexers like this one can attribute a sale without
// replaying listing state). Both topics are scanned; v1 sales fall back to the replay.
const EVENT_FRAGMENTS = [
  {
    type: 'event',
    name: 'ItemListed',
    inputs: [
      { name: 'postId', type: 'uint256', indexed: true },
      { name: 'seller', type: 'address', indexed: true },
      { name: 'price', type: 'uint256', indexed: false },
      { name: 'quantity', type: 'uint256', indexed: false },
      { name: 'paymentToken', type: 'address', indexed: false },
      { name: 'isLsp7', type: 'bool', indexed: false },
      { name: 'metadata', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ItemUpdated',
    inputs: [
      { name: 'postId', type: 'uint256', indexed: true },
      { name: 'price', type: 'uint256', indexed: false },
      { name: 'quantity', type: 'uint256', indexed: false },
      { name: 'isActive', type: 'bool', indexed: false },
      { name: 'paymentToken', type: 'address', indexed: false },
      { name: 'isLsp7', type: 'bool', indexed: false },
      { name: 'metadata', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ItemBought',
    inputs: [
      { name: 'postId', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'seller', type: 'address', indexed: true },
      { name: 'price', type: 'uint256', indexed: false },
      { name: 'quantityBought', type: 'uint256', indexed: false },
      { name: 'memo', type: 'bytes', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ItemBought',
    inputs: [
      { name: 'postId', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'seller', type: 'address', indexed: true },
      { name: 'price', type: 'uint256', indexed: false },
      { name: 'quantityBought', type: 'uint256', indexed: false },
      { name: 'paymentToken', type: 'address', indexed: false },
      { name: 'feeAmount', type: 'uint256', indexed: false },
      { name: 'memo', type: 'bytes', indexed: false },
    ],
  },
]

const abiCoder = new Web3().eth.abi
const EVENTS = {}
for (const item of EVENT_FRAGMENTS) {
  EVENTS[abiCoder.encodeEventSignature(item)] = item
}
const SCAN_TOPICS = Object.keys(EVENTS)

let tablesReady = null
export function ensureStoreSalesTables() {
  if (!tablesReady) {
    tablesReady = (async () => {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS store_sales (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          network_id INT UNSIGNED NOT NULL,
          post_id BIGINT UNSIGNED NOT NULL,
          seller VARCHAR(42) NOT NULL,
          buyer VARCHAR(42) NOT NULL,
          payment_token VARCHAR(42) NOT NULL,
          is_lsp7 TINYINT(1) NOT NULL DEFAULT 0,
          unit_price DECIMAL(65, 0) NOT NULL,
          quantity INT UNSIGNED NOT NULL,
          amount DECIMAL(65, 0) NOT NULL,
          fee_amount DECIMAL(65, 0) NOT NULL DEFAULT 0,
          tx_hash VARCHAR(66) NOT NULL,
          log_index INT UNSIGNED NOT NULL,
          block_number BIGINT UNSIGNED NOT NULL,
          sold_at BIGINT UNSIGNED NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uniq_sale (network_id, tx_hash, log_index),
          KEY idx_seller (network_id, seller, block_number)
        )
      `)
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS store_sync_state (
          network_id INT UNSIGNED NOT NULL,
          last_scanned_block BIGINT UNSIGNED NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (network_id)
        )
      `)
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS store_listing_tokens (
          network_id INT UNSIGNED NOT NULL,
          post_id BIGINT UNSIGNED NOT NULL,
          payment_token VARCHAR(42) NOT NULL,
          is_lsp7 TINYINT(1) NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (network_id, post_id)
        )
      `)
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS store_tokens (
          network_id INT UNSIGNED NOT NULL,
          token VARCHAR(42) NOT NULL,
          symbol VARCHAR(32) NOT NULL,
          decimals TINYINT UNSIGNED NOT NULL,
          PRIMARY KEY (network_id, token)
        )
      `)
    })()
  }
  return tablesReady
}

// notes for uint256 amounts: DECIMAL(65,0) holds 65 digits vs uint256's max 78 — unreachable
// for real prices, and exact SUM() in SQL is worth the theoretical gap.

/**
 * Caches a payment token's symbol/decimals so the revenue API never needs a chain read.
 * Symbol rule matches BuyButton: native → chain currency; LSP7 has no symbol(), so match
 * against the canonical USDC address, else the generic 'tokens'.
 */
async function ensureTokenMeta(networkId, token, isLsp7, web3, chain, seen) {
  const key = `${networkId}:${token}`
  if (seen.has(key)) return
  seen.add(key)

  const [[existing]] = await pool.execute('SELECT 1 AS x FROM store_tokens WHERE network_id = ? AND token = ?', [networkId, token])
  if (existing) return

  let symbol
  let decimals
  if (token === ZERO_ADDRESS) {
    symbol = chain.nativeCurrency?.symbol || 'ETH'
    decimals = chain.nativeCurrency?.decimals ?? 18
  } else {
    const contract = new web3.eth.Contract(ERC20_META_ABI, token)
    decimals = Number(await contract.methods.decimals().call())
    if (isLsp7) {
      symbol = token.toLowerCase() === USDC[networkId]?.address?.toLowerCase() ? 'USDC' : 'tokens'
    } else {
      try {
        symbol = await contract.methods.symbol().call()
      } catch {
        symbol = 'tokens'
      }
    }
  }

  await pool.execute('INSERT IGNORE INTO store_tokens (network_id, token, symbol, decimals) VALUES (?, ?, ?, ?)', [
    networkId,
    token,
    symbol,
    decimals,
  ])
}

/**
 * Resolves which payment token a purchase was made in: the in-memory replay state first,
 * then the persisted listing-token state from earlier scan windows. The live-listing
 * fallback should never fire (ItemListed always precedes a purchase and scans start at the
 * deployment block) but keeps a lone sale from aborting a whole sync.
 */
async function resolveListingToken(networkId, postId, tokenByPost, web3, storeAddress) {
  const cached = tokenByPost.get(postId)
  if (cached) return cached

  const [[row]] = await pool.execute(
    'SELECT payment_token, is_lsp7 FROM store_listing_tokens WHERE network_id = ? AND post_id = ?',
    [networkId, postId],
  )
  if (row) {
    const entry = { paymentToken: row.payment_token, isLsp7: Boolean(row.is_lsp7) }
    tokenByPost.set(postId, entry)
    return entry
  }

  console.warn(`storeSalesIndex: no listing-token state for post ${postId} on network ${networkId}, reading live listing`)
  const contract = new web3.eth.Contract(storeAbi, storeAddress)
  const listing = await contract.methods.getListing(postId).call()
  const entry = { paymentToken: String(listing.paymentToken).toLowerCase(), isLsp7: Boolean(listing.isLsp7) }
  tokenByPost.set(postId, entry)
  return entry
}

async function processLogs(networkId, chain, web3, storeAddress, logs, tokenByPost, seenTokens) {
  const ordered = [...logs].sort((a, b) => {
    const blockDiff = Number(a.blockNumber) - Number(b.blockNumber)
    return blockDiff !== 0 ? blockDiff : Number(a.logIndex) - Number(b.logIndex)
  })

  const saleRows = []
  for (const log of ordered) {
    const eventAbi = EVENTS[log.topics[0]]
    if (!eventAbi) continue
    const decoded = abiCoder.decodeLog(eventAbi.inputs, log.data, log.topics.slice(1))
    const postId = String(decoded.postId)

    if (eventAbi.name === 'ItemListed' || eventAbi.name === 'ItemUpdated') {
      const entry = { paymentToken: String(decoded.paymentToken).toLowerCase(), isLsp7: Boolean(decoded.isLsp7) }
      tokenByPost.set(postId, entry)
      await pool.execute(
        `INSERT INTO store_listing_tokens (network_id, post_id, payment_token, is_lsp7)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE payment_token = VALUES(payment_token), is_lsp7 = VALUES(is_lsp7)`,
        [networkId, postId, entry.paymentToken, entry.isLsp7 ? 1 : 0],
      )
      continue
    }

    let paymentToken
    let isLsp7
    if (decoded.paymentToken !== undefined) {
      // v2 ItemBought names its settlement token directly; the event has no isLsp7, so take it
      // from the replay state when it covers this token, else from the canonical USDC config
      paymentToken = String(decoded.paymentToken).toLowerCase()
      const entry = tokenByPost.get(postId)
      isLsp7 =
        entry?.paymentToken === paymentToken
          ? entry.isLsp7
          : paymentToken !== ZERO_ADDRESS &&
            paymentToken === USDC[networkId]?.address?.toLowerCase() &&
            Boolean(USDC[networkId]?.lsp7)
    } else {
      ;({ paymentToken, isLsp7 } = await resolveListingToken(networkId, postId, tokenByPost, web3, storeAddress))
    }

    const unitPrice = BigInt(decoded.price)
    const quantity = BigInt(decoded.quantityBought)
    saleRows.push({
      postId,
      seller: String(decoded.seller).toLowerCase(),
      buyer: String(decoded.buyer).toLowerCase(),
      paymentToken,
      isLsp7,
      unitPrice,
      quantity,
      feeAmount: decoded.feeAmount !== undefined ? BigInt(decoded.feeAmount) : 0n,
      txHash: log.transactionHash,
      logIndex: Number(log.logIndex),
      blockNumber: Number(log.blockNumber),
    })
  }

  if (saleRows.length === 0) return 0

  // Block timestamps: one getBlock per unique block, small concurrent batches
  const uniqueBlocks = [...new Set(saleRows.map((r) => r.blockNumber))]
  const timestampByBlock = new Map()
  for (let i = 0; i < uniqueBlocks.length; i += 20) {
    const batch = uniqueBlocks.slice(i, i + 20)
    const blocks = await Promise.all(batch.map((n) => web3.eth.getBlock(n)))
    blocks.forEach((block, j) => timestampByBlock.set(batch[j], Number(block.timestamp)))
  }

  for (const row of saleRows) {
    await ensureTokenMeta(networkId, row.paymentToken, row.isLsp7, web3, chain, seenTokens)
  }

  const values = saleRows.map((r) => [
    networkId,
    r.postId,
    r.seller,
    r.buyer,
    r.paymentToken,
    r.isLsp7 ? 1 : 0,
    r.unitPrice.toString(),
    r.quantity.toString(),
    (r.unitPrice * r.quantity).toString(),
    r.feeAmount.toString(),
    r.txHash,
    r.logIndex,
    r.blockNumber,
    timestampByBlock.get(r.blockNumber),
  ])
  const [result] = await pool.query(
    `INSERT IGNORE INTO store_sales
       (network_id, post_id, seller, buyer, payment_token, is_lsp7, unit_price, quantity, amount, fee_amount, tx_hash, log_index, block_number, sold_at)
     VALUES ?`,
    [values],
  )
  return result.affectedRows || 0
}

async function syncNetwork(networkId) {
  const chain = config.chains.find((c) => c.id === Number(networkId))
  const storeAddress = STORE_ADDRESSES[Number(networkId)] || CONTRACTS[`chain${networkId}`]?.store
  if (!chain || !storeAddress) return { networkId, supported: false }

  const web3 = new Web3(new Web3.providers.HttpProvider(chain.rpcUrls.default.http[0]))
  await ensureStoreSalesTables()

  const deployBlock = Number(STORE_DEPLOY_BLOCKS[Number(networkId)] || 0)
  const [[cursor]] = await pool.execute('SELECT last_scanned_block FROM store_sync_state WHERE network_id = ?', [networkId])
  const startBlock = cursor ? Math.max(deployBlock, Number(cursor.last_scanned_block) + 1 - REORG_REWIND_BLOCKS) : deployBlock
  const latestBlock = Number(await web3.eth.getBlockNumber())

  if (startBlock > latestBlock) {
    return { networkId, supported: true, fromBlock: startBlock, toBlock: latestBlock, inserted: 0, done: true }
  }

  const tokenByPost = new Map()
  const seenTokens = new Set()
  let chunkSize = SCAN_CHUNK_BLOCKS
  let from = startBlock
  let inserted = 0
  let chunks = 0

  while (from <= latestBlock && chunks < MAX_CHUNKS_PER_RUN) {
    const to = Math.min(from + chunkSize - 1, latestBlock)
    let logs
    try {
      logs = await web3.eth.getPastLogs({
        address: storeAddress,
        fromBlock: from,
        toBlock: to,
        topics: [SCAN_TOPICS],
      })
    } catch (error) {
      // RPC range/result limits — halve the window and retry the same span
      if (chunkSize > MIN_CHUNK_BLOCKS) {
        chunkSize = Math.max(MIN_CHUNK_BLOCKS, Math.floor(chunkSize / 2))
        continue
      }
      throw error
    }

    inserted += await processLogs(networkId, chain, web3, storeAddress, logs, tokenByPost, seenTokens)
    await pool.execute(
      `INSERT INTO store_sync_state (network_id, last_scanned_block)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE last_scanned_block = VALUES(last_scanned_block)`,
      [networkId, to],
    )
    from = to + 1
    chunks += 1
  }

  return { networkId, supported: true, fromBlock: startBlock, toBlock: from - 1, inserted, done: from > latestBlock }
}

const netState = new Map() // networkId → { lastRun, inFlight }

async function syncNetworkThrottled(networkId, force) {
  const state = netState.get(networkId) || { lastRun: 0, inFlight: null }
  if (state.inFlight) return state.inFlight
  if (!force && Date.now() - state.lastRun < SYNC_THROTTLE_MS) return { networkId, skipped: true }

  state.inFlight = syncNetwork(networkId).finally(() => {
    state.lastRun = Date.now()
    state.inFlight = null
  })
  netState.set(networkId, state)
  return state.inFlight
}

/**
 * Scans new HupBazzar sale events into store_sales. Pass networkId to sync one network
 * (manual backfill), omit it to sweep every configured deployment. Throttled per network
 * unless force; concurrent callers share the in-flight scan.
 */
export async function syncStoreSales({ networkId, force = false } = {}) {
  if (networkId !== undefined) {
    return syncNetworkThrottled(Number(networkId), force)
  }
  const networkIds = Object.entries(STORE_ADDRESSES)
    .filter(([, address]) => Boolean(address))
    .map(([id]) => Number(id))
  return Promise.all(networkIds.map((id) => syncNetworkThrottled(id, force)))
}
