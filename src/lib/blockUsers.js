import { isWalletAddress, normalizeAddress } from './address.js'

const MAX_SIGNATURE_AGE_MS = 5 * 60_000

export class BlockError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export const blockUserMessage = ({ address, target, blocked, nonce, issuedAt }) => [
  'Update blocked users on Hup',
  '',
  `Wallet: ${normalizeAddress(address)}`,
  `Action: ${blocked ? 'Block' : 'Unblock'}`,
  `User: ${normalizeAddress(target)}`,
  `Nonce: ${nonce}`,
  `Timestamp: ${issuedAt}`,
].join('\n')

export function validateBlockClaim(body, now = Date.now()) {
  const address = normalizeAddress(body?.address)
  const target = normalizeAddress(body?.target)
  if (!isWalletAddress(address) || !isWalletAddress(target) || address === target) {
    throw new BlockError('Valid, different wallet addresses are required')
  }
  if (typeof body?.blocked !== 'boolean' || typeof body?.signature !== 'string' || !body.signature ||
    body.signature.length > 16384 || typeof body?.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(body.nonce) ||
    !Number.isSafeInteger(body?.issuedAt) || Math.abs(now - body.issuedAt) > MAX_SIGNATURE_AGE_MS) {
    throw new BlockError('A recent wallet signature and nonce are required')
  }
  return { address, target, blocked: body.blocked, signature: body.signature, nonce: body.nonce, issuedAt: body.issuedAt, chainId: body.chainId }
}

export async function readUserBlocks(db, address) {
  const owner = normalizeAddress(address)
  if (!isWalletAddress(owner)) return []
  const [rows] = await db.execute('SELECT blocked_address FROM user_blocks WHERE blocker_address = ? ORDER BY created_at DESC, blocked_address', [owner])
  return rows.map((row) => row.blocked_address)
}

export async function saveUserBlock(db, body, verifySignature) {
  const claim = validateBlockClaim(body)
  if (!await verifySignature(claim.address, blockUserMessage(claim), claim.signature, { chainId: claim.chainId })) {
    throw new BlockError('Signature does not match this wallet', 401)
  }
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    // Only nonce ownership follows the existing nonce endpoint's lowercase convention.
    // Solana identities and signed messages always retain their original case.
    const [used] = await connection.execute('DELETE FROM nonces WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()', [claim.nonce, claim.address.toLowerCase()])
    if (!used.affectedRows) throw new BlockError('Nonce is missing or expired')
    if (claim.blocked) {
      await connection.execute('INSERT IGNORE INTO user_blocks (blocker_address, blocked_address) VALUES (?, ?)', [claim.address, claim.target])
    } else {
      await connection.execute('DELETE FROM user_blocks WHERE blocker_address = ? AND blocked_address = ?', [claim.address, claim.target])
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  return claim
}

// Wallet values are bound parameters; hex is case-insensitive, base58 is case-sensitive.
export function blockedFeedFilter(addresses, alias = 'p', includeReposts = true) {
  if (!addresses.length) return { sql: '', params: [] }
  if (!['p', 'c', 's'].includes(alias)) throw new Error('Invalid feed alias')
  const normalized = (column) => `CONVERT(CASE WHEN ${column} LIKE '0x%' THEN LOWER(${column}) ELSE ${column} END USING ascii) COLLATE ascii_bin`
  const marks = addresses.map(() => '?').join(', ')
  let sql = ` AND ${normalized(`${alias}.wallet_address`)} NOT IN (${marks})`
  const params = [...addresses]
  if (includeReposts) {
    sql += ` AND NOT EXISTS (SELECT 1 FROM posts blocked_original
      WHERE blocked_original.network_id = ${alias}.network_id AND blocked_original.id = ${alias}.is_repost
        AND ${normalized('blocked_original.wallet_address')} IN (${marks}))`
    params.push(...addresses)
  }
  return { sql, params }
}
