/**
 * @file lib/userStatus.js
 * @description Offchain Status: one short message per wallet, set and cleared through a signed
 * message rather than a transaction. Shared by the API route (validation, storage) and the
 * profile editor (the exact message the wallet signs).
 */

import { isEvmAddress, normalizeAddress } from './address.js'

const MAX_SIGNATURE_AGE_MS = 5 * 60_000

export const STATUS_MAX_LENGTH = 160
/** Hours a status may last before it clears itself; 0 keeps it until the owner clears it. */
export const STATUS_PERIODS = [24, 8, 6, 4, 1, 0]

export class StatusError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export const userStatusMessage = ({ address, content, periodHours, clear, nonce, issuedAt }) => [
  'Update status on Hup',
  '',
  `Wallet: ${normalizeAddress(address)}`,
  ...(clear ? ['Action: Clear'] : ['Action: Set', `Status: ${content}`, `Clears after: ${periodHours ? `${periodHours}h` : 'never'}`]),
  `Nonce: ${nonce}`,
  `Timestamp: ${issuedAt}`,
].join('\n')

export function validateStatusClaim(body, now = Date.now()) {
  const address = normalizeAddress(body?.address)
  if (!isEvmAddress(address)) throw new StatusError('A valid wallet address is required')
  if (typeof body?.signature !== 'string' || !body.signature || body.signature.length > 16384 ||
    typeof body?.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(body.nonce) ||
    !Number.isSafeInteger(body?.issuedAt) || Math.abs(now - body.issuedAt) > MAX_SIGNATURE_AGE_MS) {
    throw new StatusError('A recent wallet signature and nonce are required')
  }

  const clear = body.clear === true
  const content = clear ? '' : typeof body.content === 'string' ? body.content.trim() : ''
  const periodHours = clear ? 0 : body.periodHours
  if (!clear) {
    if (!content) throw new StatusError('Write a status first')
    if ([...content].length > STATUS_MAX_LENGTH) throw new StatusError(`Keep your status under ${STATUS_MAX_LENGTH} characters`)
    if (!STATUS_PERIODS.includes(periodHours)) throw new StatusError('Choose when the status clears')
  }

  return { address, content, periodHours, clear, signature: body.signature, nonce: body.nonce, issuedAt: body.issuedAt, chainId: body.chainId }
}

const toStatus = (row) => row && {
  wallet_address: row.wallet_address,
  content: row.content,
  period_hours: Number(row.period_hours),
  expires_at: row.expires_at == null ? null : Number(row.expires_at),
  updated_at: Number(row.updated_at),
}

const LIVE = '(expires_at IS NULL OR expires_at > UNIX_TIMESTAMP())'

/** The wallet's live status, or null when it has none or it has expired. */
export async function readUserStatus(db, address) {
  const owner = normalizeAddress(address)
  if (!isEvmAddress(owner)) return null
  const [rows] = await db.execute(`SELECT * FROM user_statuses WHERE wallet_address = ? AND ${LIVE}`, [owner])
  return toStatus(rows[0]) ?? null
}

export async function saveUserStatus(db, body, verifySignature) {
  const claim = validateStatusClaim(body)
  if (!await verifySignature(claim.address, userStatusMessage(claim), claim.signature, { chainId: claim.chainId })) {
    throw new StatusError('Signature does not match this wallet', 401)
  }

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    const [used] = await connection.execute('DELETE FROM nonces WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()', [claim.nonce, claim.address])
    if (!used.affectedRows) throw new StatusError('Nonce is missing or expired')
    if (claim.clear) {
      await connection.execute('DELETE FROM user_statuses WHERE wallet_address = ?', [claim.address])
    } else {
      const updatedAt = Math.floor(Date.now() / 1000)
      const expiresAt = claim.periodHours ? updatedAt + claim.periodHours * 3600 : null
      await connection.execute(
        `INSERT INTO user_statuses (wallet_address, content, period_hours, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE content = VALUES(content), period_hours = VALUES(period_hours), expires_at = VALUES(expires_at), updated_at = VALUES(updated_at)`,
        [claim.address, claim.content, claim.periodHours, expiresAt, updatedAt]
      )
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  return claim.clear ? null : readUserStatus(db, claim.address)
}
