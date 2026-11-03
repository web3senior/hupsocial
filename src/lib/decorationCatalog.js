/**
 * @file lib/decorationCatalog.js
 * @description The decoration catalog as it stands right now: config/decorations.js with the
 * admin's settings (decoration_settings) applied. Server-only.
 */

import { findDecoration } from '@/config/decorations'
import { liveCatalog, MAX_PRICE_USD } from '@/lib/decorationSettings'
import { DecorationError } from '@/lib/userDecorations'

/* Every quote, equip and catalog read asks, so the rows are held briefly. A save on this instance
   drops the copy at once; another instance catches up within this long. */
const CACHE_MS = 15_000

let cache = { at: 0, settings: null }

const toSetting = (row) => ({ priceUsd: Number(row.price_usd), profileOnly: Boolean(row.profile_only), listed: Boolean(row.listed) })

/** The admin's settings, `{ [decorationId]: setting }`; none at all before the migration runs. */
export async function readDecorationSettings(db) {
  if (cache.settings && Date.now() - cache.at < CACHE_MS) return cache.settings
  try {
    const [rows] = await db.execute('SELECT decoration_id, price_usd, profile_only, listed FROM decoration_settings')
    cache = { at: Date.now(), settings: Object.fromEntries(rows.map((row) => [row.decoration_id, toSetting(row)])) }
  } catch (error) {
    if (error?.code !== 'ER_NO_SUCH_TABLE') throw error
    cache = { at: Date.now(), settings: {} }
  }
  return cache.settings
}

/** The live catalog, keyed by id (lib/decorationSettings.js liveCatalog). */
export const readDecorationCatalog = async (db) => liveCatalog(await readDecorationSettings(db))

/**
 * Writes or clears one decoration's setting. The caller has already checked the admin signature.
 * @param {Object} change `{ decorationId, reset?, priceUsd, profileOnly, listed }`.
 */
export async function saveDecorationSetting(db, change) {
  if (!findDecoration(change.decorationId)) throw new DecorationError('That decoration does not exist', 404)
  if (change.reset) {
    await db.execute('DELETE FROM decoration_settings WHERE decoration_id = ?', [change.decorationId])
  } else {
    await db.execute(
      `INSERT INTO decoration_settings (decoration_id, price_usd, profile_only, listed, updated_at) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE price_usd = VALUES(price_usd), profile_only = VALUES(profile_only), listed = VALUES(listed), updated_at = VALUES(updated_at)`,
      [change.decorationId, change.priceUsd, change.profileOnly ? 1 : 0, change.listed ? 1 : 0, Math.floor(Date.now() / 1000)]
    )
  }
  cache = { at: 0, settings: null }
}

/** A setting change as the admin sent it, checked; throws a DecorationError otherwise. */
export function validateDecorationSetting(body) {
  const decorationId = String(body?.decorationId ?? '')
  if (!findDecoration(decorationId)) throw new DecorationError('That decoration does not exist', 404)
  if (body?.reset === true) return { decorationId, reset: true }
  const priceUsd = Math.round(Number(body?.priceUsd) * 100) / 100
  if (!Number.isFinite(priceUsd) || priceUsd < 0 || priceUsd > MAX_PRICE_USD) throw new DecorationError(`Price must be between $0 and $${MAX_PRICE_USD}`)
  return { decorationId, reset: false, priceUsd, profileOnly: body?.profileOnly === true, listed: body?.listed === true }
}

/**
 * What the shop has sold: paid orders per decoration, the dollar total, and the latest sales.
 * Before the shop migration runs, nothing.
 */
export async function readDecorationSales(db, recentLimit = 10) {
  try {
    const [rows] = await db.execute(
      'SELECT id, buyer_address, recipient_address, decoration_ids, network_id, price_usd, paid_at FROM decoration_orders WHERE paid_at IS NOT NULL ORDER BY paid_at DESC'
    )
    const counts = {}
    let revenueUsd = 0
    for (const row of rows) {
      revenueUsd += Number(row.price_usd)
      for (const id of String(row.decoration_ids).split(',').filter(Boolean)) counts[id] = (counts[id] ?? 0) + 1
    }
    const recent = rows.slice(0, recentLimit).map((row) => ({
      id: row.id,
      buyer: row.buyer_address,
      recipient: row.recipient_address,
      decorationIds: String(row.decoration_ids).split(',').filter(Boolean),
      networkId: Number(row.network_id),
      priceUsd: Number(row.price_usd),
      paidAt: Number(row.paid_at),
    }))
    return { migrated: true, orders: rows.length, revenueUsd: Math.round(revenueUsd * 100) / 100, counts, recent }
  } catch (error) {
    if (error?.code !== 'ER_NO_SUCH_TABLE') throw error
    return { migrated: false, orders: 0, revenueUsd: 0, counts: {}, recent: [] }
  }
}
