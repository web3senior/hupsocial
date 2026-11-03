/**
 * @file lib/decorationShop.js
 * @description Selling avatar decorations without a contract. Server-only.
 *
 * A quote fixes what a priced decoration costs in one network's coin, at the USD price of the
 * moment. The buyer sends that amount to the treasury in an ordinary transfer — from a wallet or a
 * Universal Profile — and confirming the order checks the transfer onchain (lib/onchainPayment.js)
 * and grants the decoration. Confirming is safe to repeat: the order remembers its transfer, and a
 * transfer can pay for one order only.
 */

import { randomBytes } from 'node:crypto'
import { isEvmAddress, normalizeAddress } from '@/lib/address'
import { findDecoration, isPaid } from '@/config/decorations'
import { blockTime, coinPrice, isTxHash, paymentChain, readPayment } from '@/lib/onchainPayment'
import { DecorationError } from '@/lib/userDecorations'
import { readDecorationCatalog } from '@/lib/decorationCatalog'

const QUOTE_TTL_SECONDS = 15 * 60
// A transfer stamped this long before its order was created is still accepted: block times and
// this server's clock drift apart by seconds, and a real payment must never be refused for it
const CLOCK_SKEW_SECONDS = 60
// Quotes are rounded up to a millionth of a coin — fine enough for a two-dollar price on any chain
const MICRO_COIN = 10n ** 12n

const ORDER_ID_RE = /^[a-f0-9]{32}$/

/**
 * A database without 20261104-decoration-shop.sql reads as a closed shop, not a server error — the
 * same answer as a missing treasury, with the migration named in the log for whoever runs the box.
 */
export const shopTablesMissing = (error) => {
  if (error?.code !== 'ER_NO_SUCH_TABLE') return null
  console.warn('[DECORATION_SHOP_TABLES_MISSING]: apply deploy/migrations/20261104-decoration-shop.sql')
  return new DecorationError('The decoration shop is not set up on this deployment', 503)
}

/** The address payments go to, or an error saying the shop is not set up here. */
const treasury = () => {
  const address = normalizeAddress(process.env.DECORATIONS_TREASURY_ADDRESS || '')
  if (!isEvmAddress(address)) throw new DecorationError('The decoration shop is not set up on this deployment', 503)
  return address
}

const now = () => Math.floor(Date.now() / 1000)

/** The paid decorations a wallet owns, as catalog ids. Free ones are everyone's and not listed. */
export async function readOwnedDecorations(db, address) {
  const owner = normalizeAddress(address)
  if (!isEvmAddress(owner)) return []
  const [rows] = await db.execute('SELECT decoration_id FROM decoration_ownership WHERE wallet_address = ?', [owner])
  return rows.map((row) => row.decoration_id).filter((id) => findDecoration(id))
}

/** The catalog ids an order row pays for. */
const orderItems = (order) => String(order.decoration_ids).split(',').filter(Boolean)

/**
 * Prices one or more decorations for a buyer on one network and opens a single order for them,
 * so a whole basket is paid in one transfer.
 * @param {Object} body `{ buyer, recipient?, decorationIds, chainId }`; the recipient defaults to
 *   the buyer, and any other address makes the order a gift.
 * @returns {Promise<Object>} What the client needs to pay: order id, treasury, amount in wei.
 */
export async function quoteDecoration(db, body) {
  const to = treasury()
  const buyer = normalizeAddress(body?.buyer)
  const recipient = body?.recipient ? normalizeAddress(body.recipient) : buyer
  if (!isEvmAddress(buyer) || !isEvmAddress(recipient)) throw new DecorationError('A valid wallet address is required')

  const ids = Array.isArray(body?.decorationIds) ? [...new Set(body.decorationIds)] : []
  if (!ids.length) throw new DecorationError('Choose a decoration to buy')
  // Priced and offered as the admin has them right now (lib/decorationCatalog.js)
  const catalog = await readDecorationCatalog(db)
  const items = ids.map((id) => catalog.get(id))
  if (items.some((item) => !item)) throw new DecorationError('That decoration does not exist')
  const unlisted = items.find((item) => !item.listed)
  if (unlisted) throw new DecorationError(`${unlisted.name} is not for sale right now`)
  const free = items.find((item) => !isPaid(item))
  if (free) throw new DecorationError(`${free.name} is free — equip it without buying`)

  const owned = new Set(await readOwnedDecorations(db, recipient))
  const already = items.find((item) => owned.has(item.id))
  if (already) throw new DecorationError(recipient === buyer ? `You already own ${already.name}` : `They already own ${already.name}`, 409)

  const chain = paymentChain(body?.chainId)
  const usdPrice = await coinPrice(chain)
  const priceUsd = items.reduce((total, item) => total + item.priceUsd, 0)
  const microCoins = BigInt(Math.ceil((priceUsd / usdPrice) * 1e6))
  const amountWei = microCoins * MICRO_COIN

  const id = randomBytes(16).toString('hex')
  const createdAt = now()
  const expiresAt = createdAt + QUOTE_TTL_SECONDS
  await db.execute(
    `INSERT INTO decoration_orders
      (id, buyer_address, recipient_address, decoration_ids, network_id, amount_wei, price_usd, coin_usd_price, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, buyer, recipient, items.map((item) => item.id).join(','), chain.id, amountWei.toString(), priceUsd, usdPrice, createdAt, expiresAt]
  )

  return {
    orderId: id,
    to,
    chainId: chain.id,
    amountWei: amountWei.toString(),
    symbol: chain.nativeCurrency.symbol,
    priceUsd,
    expiresAt,
  }
}

/**
 * Checks the transfer that pays an order and grants its decoration.
 *
 * The quote's expiry is not enforced here. It keeps a client from paying a stale price, but by the
 * time a transfer reaches this check the money has moved, and refusing a real payment over a few
 * minutes of price drift is worse than honouring it. What is enforced: the transfer came from the
 * buyer, reached the treasury, covers the quote, and was not sent before the order existed.
 * @param {Object} body `{ orderId, txHash }`.
 * @returns {Promise<{decorationIds: string[], recipient: string, owned: string[]}>}
 */
export async function confirmDecorationOrder(db, body) {
  const to = treasury()
  if (!ORDER_ID_RE.test(String(body?.orderId)) || !isTxHash(body?.txHash)) throw new DecorationError('An order and its transaction are required')
  const txHash = body.txHash.toLowerCase()

  const [[order]] = await db.execute('SELECT * FROM decoration_orders WHERE id = ?', [body.orderId])
  if (!order) throw new DecorationError('That order does not exist', 404)

  const granted = async () => ({
    decorationIds: orderItems(order),
    recipient: order.recipient_address,
    owned: await readOwnedDecorations(db, order.recipient_address),
  })

  if (order.tx_hash) {
    if (order.tx_hash === txHash) return granted()
    throw new DecorationError('That order is already paid by another transfer', 409)
  }

  const chain = paymentChain(order.network_id)
  const { paid, blockNumber, provider } = await readPayment(chain, txHash, order.buyer_address, to)
  if (paid <= 0n) throw new DecorationError('That transfer is not a payment from this wallet to Hup')
  if (paid < BigInt(order.amount_wei)) throw new DecorationError('That transfer is less than the quoted price')
  if (await blockTime(provider, blockNumber) < Number(order.created_at) - CLOCK_SKEW_SECONDS) {
    throw new DecorationError('That transfer was sent before this order was opened')
  }

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    const paidAt = now()
    const [marked] = await connection.execute(
      'UPDATE decoration_orders SET tx_hash = ?, paid_at = ? WHERE id = ? AND tx_hash IS NULL',
      [txHash, paidAt, order.id]
    )
    // Lost a race with a second confirm of the same order: whichever got there first decides
    if (!marked.affectedRows) {
      await connection.rollback()
      const [[current]] = await db.execute('SELECT tx_hash FROM decoration_orders WHERE id = ?', [order.id])
      if (current?.tx_hash === txHash) return granted()
      throw new DecorationError('That order is already paid by another transfer', 409)
    }
    for (const decorationId of orderItems(order)) {
      await connection.execute(
        'INSERT IGNORE INTO decoration_ownership (wallet_address, decoration_id, order_id, acquired_at) VALUES (?, ?, ?, ?)',
        [order.recipient_address, decorationId, order.id, paidAt]
      )
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback().catch(() => {})
    if (error?.code === 'ER_DUP_ENTRY') throw new DecorationError('That transfer already paid for another order', 409)
    throw error
  } finally {
    connection.release()
  }

  return granted()
}
