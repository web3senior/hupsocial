/**
 * @file lib/userDecorations.js
 * @description Avatar decorations a wallet wears, set through a signed message rather than a
 * transaction — the same flow as lib/userStatus.js. Shared by the API route (validation, storage)
 * and the decorations sheet (the exact message the wallet signs).
 */

import { isEvmAddress, normalizeAddress } from './address.js'
import { DECORATION_SLOTS, findDecoration, isPaid, normalizeDecorations, SLOT_LABELS } from '../config/decorations.js'

const MAX_SIGNATURE_AGE_MS = 5 * 60_000

export class DecorationError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

/* Every slot is named, empty ones as "none": the signature then covers the whole set, so a replayed
   or edited request cannot equip one slot while leaving the others to whatever the server holds. */
export const userDecorationsMessage = ({ address, equipped, nonce, issuedAt }) => [
  'Update avatar decorations on Hup',
  '',
  `Wallet: ${normalizeAddress(address)}`,
  ...DECORATION_SLOTS.map((slot) => `${SLOT_LABELS[slot]}: ${equipped?.[slot] ?? 'none'}`),
  `Nonce: ${nonce}`,
  `Timestamp: ${issuedAt}`,
].join('\n')

export function validateDecorationsClaim(body, now = Date.now()) {
  const address = normalizeAddress(body?.address)
  if (!isEvmAddress(address)) throw new DecorationError('A valid wallet address is required')
  if (typeof body?.signature !== 'string' || !body.signature || body.signature.length > 16384 ||
    typeof body?.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(body.nonce) ||
    !Number.isSafeInteger(body?.issuedAt) || Math.abs(now - body.issuedAt) > MAX_SIGNATURE_AGE_MS) {
    throw new DecorationError('A recent wallet signature and nonce are required')
  }

  const equipped = {}
  for (const slot of DECORATION_SLOTS) {
    const id = body?.equipped?.[slot]
    if (id == null) continue
    if (findDecoration(id)?.slot !== slot) throw new DecorationError(`That decoration does not fit the ${SLOT_LABELS[slot].toLowerCase()} slot`)
    equipped[slot] = id
  }

  return { address, equipped, signature: body.signature, nonce: body.nonce, issuedAt: body.issuedAt, chainId: body.chainId }
}

/** What the wallet wears, `{ [slot]: decorationId }`, limited to what this build can draw. */
export async function readUserDecorations(db, address) {
  const owner = normalizeAddress(address)
  if (!isEvmAddress(owner)) return {}
  const [rows] = await db.execute('SELECT slot, decoration_id FROM user_decorations WHERE wallet_address = ?', [owner])
  return normalizeDecorations(Object.fromEntries(rows.map((row) => [row.slot, row.decoration_id])))
}

/**
 * Replaces the wallet's decorations with the signed set.
 * @param {Function} verifySignature lib/walletSignature's verifyWalletSignature.
 * @param {Object} shop Server-only reads, handed in rather than imported: this module is also the
 *   client's message builder.
 * @param {Function} shop.readOwned `(db, address) => Promise<string[]>`, the paid decorations the
 *   wallet owns (lib/decorationShop.js).
 * @param {Function} shop.readCatalog `(db) => Promise<Map>`, the live catalog
 *   (lib/decorationCatalog.js) — prices and shop listing as the admin has them.
 */
export async function saveUserDecorations(db, body, verifySignature, { readOwned, readCatalog }) {
  const claim = validateDecorationsClaim(body)
  if (!await verifySignature(claim.address, userDecorationsMessage(claim), claim.signature, { chainId: claim.chainId })) {
    throw new DecorationError('Signature does not match this wallet', 401)
  }

  /* What may be worn: anything already worn (an admin repricing or delisting a piece never strips
     it off someone), anything bought, and otherwise only what is free and still in the shop. */
  const ids = Object.values(claim.equipped)
  if (ids.length) {
    const [catalog, owned, worn] = await Promise.all([readCatalog(db), readOwned(db, claim.address), readUserDecorations(db, claim.address)])
    const keep = new Set([...owned, ...Object.values(worn)])
    for (const item of ids.map((id) => catalog.get(id))) {
      if (keep.has(item.id)) continue
      if (isPaid(item)) throw new DecorationError(`Buy ${item.name} before wearing it`, 403)
      if (!item.listed) throw new DecorationError(`${item.name} is not available right now`, 403)
    }
  }

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    const [used] = await connection.execute('DELETE FROM nonces WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()', [claim.nonce, claim.address])
    if (!used.affectedRows) throw new DecorationError('Nonce is missing or expired')
    // The message names every slot, so the set is replaced whole rather than merged
    await connection.execute('DELETE FROM user_decorations WHERE wallet_address = ?', [claim.address])
    const updatedAt = Math.floor(Date.now() / 1000)
    for (const [slot, id] of Object.entries(claim.equipped)) {
      await connection.execute(
        'INSERT INTO user_decorations (wallet_address, slot, decoration_id, updated_at) VALUES (?, ?, ?, ?)',
        [claim.address, slot, id, updatedAt]
      )
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  return readUserDecorations(db, claim.address)
}
