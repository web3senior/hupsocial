/**
 * @file api/v1/users/username/route.js
 * @description Where a handle is checked and where it is claimed.
 *
 * Unlike every other profile write, a claim demands a signature. A display name is only ever seen
 * next to the address it belongs to, but a handle is a global namespace — an unsigned claim
 * endpoint is a script that reserves every good name for wallets nobody controls.
 *
 * The UNIQUE index on users.username_key is the arbiter, not a check-then-write: two claims for the
 * same free handle in the same millisecond both pass any lookup, and only one survives the insert.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { isEvmAddress, normalizeAddress, sameAddress } from '@/lib/address'
import { hasColumn, hasTable } from '@/lib/schema'
import { verifyWalletSignature } from '@/lib/walletSignature'
import {
  USERNAME_CHANGE_COOLDOWN_HOURS,
  USERNAME_RELEASE_LOCK_DAYS,
  usernameClaimMessage,
  usernameKey,
  validateUsername,
} from '@/lib/username'

export const runtime = 'nodejs'

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000
const DUPLICATE_ENTRY = 'ER_DUP_ENTRY'

const taken = { available: false, error: 'That username is taken' }

/* Production is migrated by hand, so this whole feature can be deployed before its table is
   there. Until it is, the field says so instead of the route 500ing on a missing column. */
const isMigrated = async () => (await hasColumn('users', 'username_key')) && (await hasTable('username_history'))
const NOT_MIGRATED = { success: false, error: 'Usernames are not available yet' }

/**
 * Whether `key` is free for `address` to take — shape, the handle's current owner, and the lock a
 * previous owner leaves behind when they move off it.
 * @param {string} key The folded handle.
 * @param {string|null} address The wallet asking, lowercased; its own handle is free to re-claim.
 * @returns {Promise<{available: boolean, error?: string}>}
 */
async function claimability(key, address) {
  const shape = validateUsername(key)
  if (!shape.ok) return { available: false, error: shape.error }

  const [[owner]] = await pool.execute('SELECT wallet_address FROM users WHERE username_key = ? LIMIT 1', [key])
  if (owner) {
    return sameAddress(owner.wallet_address, address) ? { available: true, error: null } : taken
  }

  const [[released]] = await pool.execute(
    `SELECT wallet_address FROM username_history
      WHERE username_key = ? AND released_at > NOW() - INTERVAL ? DAY LIMIT 1`,
    [key, USERNAME_RELEASE_LOCK_DAYS],
  )
  if (released && !sameAddress(released.wallet_address, address)) return taken

  return { available: true, error: null }
}

/** Availability, for the field that checks as it is typed. */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const key = usernameKey(searchParams.get('u'))
    const address = normalizeAddress(searchParams.get('address')) || null

    if (!key) return NextResponse.json({ success: false, error: 'A username is required' }, { status: 400 })

    if (!(await isMigrated())) return NextResponse.json(NOT_MIGRATED, { status: 503 })

    const result = await claimability(key, address)
    return NextResponse.json({ success: true, username: key, ...result })
  } catch (error) {
    console.error('[USERNAME_CHECK_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

/** Claims a handle, or moves a wallet from the one it holds to another. */
export async function POST(request) {
  try {
    const body = await request.json()
    const address = normalizeAddress(body?.address)
    const signature = typeof body?.signature === 'string' ? body.signature : ''
    const nonce = typeof body?.nonce === 'string' ? body.nonce : ''
    const issuedAt = Number(body?.issuedAt)

    if (!isEvmAddress(address)) {
      return NextResponse.json({ success: false, error: 'A wallet address is required' }, { status: 400 })
    }

    const shape = validateUsername(body?.username)
    if (!shape.ok) return NextResponse.json({ success: false, error: shape.error }, { status: 400 })

    if (!(await isMigrated())) return NextResponse.json(NOT_MIGRATED, { status: 503 })

    if (!signature || !nonce || !Number.isFinite(issuedAt)) {
      return NextResponse.json({ success: false, error: 'A signed claim is required' }, { status: 400 })
    }
    if (Math.abs(Date.now() - issuedAt) > SIGNATURE_MAX_AGE_MS) {
      return NextResponse.json({ success: false, error: 'That signature has expired — try again' }, { status: 400 })
    }

    /* Burned before the signature is checked, so a captured claim cannot be replayed against a
       second attempt, and a wrong signature costs the nonce rather than allowing guesses at it. */
    const [burn] = await pool.execute(
      'DELETE FROM nonces WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()',
      [nonce, address],
    )
    if (burn.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'That challenge expired — try again' }, { status: 400 })
    }

    const message = usernameClaimMessage({ username: shape.key, address, nonce, issuedAt })
    const signed = await verifyWalletSignature(address, message, signature, { chainId: body?.chainId })
    if (!signed) {
      return NextResponse.json({ success: false, error: 'That signature does not match the wallet' }, { status: 401 })
    }

    const [[current]] = await pool.execute(
      'SELECT username, username_key, username_changed_at FROM users WHERE wallet_address = ? LIMIT 1',
      [address],
    )
    if (!current) {
      return NextResponse.json({ success: false, error: 'Connect your wallet before claiming a username' }, { status: 404 })
    }
    if (current.username_key === shape.key) {
      /* Same handle, different casing is a display change and nothing else — no cooldown for it. */
      await pool.execute('UPDATE users SET username = ? WHERE wallet_address = ?', [shape.display, address])
      return NextResponse.json({ success: true, username: shape.display })
    }

    const changedAt = current.username_changed_at ? new Date(current.username_changed_at).getTime() : 0
    const cooldownMs = USERNAME_CHANGE_COOLDOWN_HOURS * 60 * 60 * 1000
    if (current.username_key && Date.now() - changedAt < cooldownMs) {
      const hours = Math.ceil((cooldownMs - (Date.now() - changedAt)) / (60 * 60 * 1000))
      return NextResponse.json(
        { success: false, error: `You can change your username again in ${hours} ${hours === 1 ? 'hour' : 'hours'}` },
        { status: 429 },
      )
    }

    const free = await claimability(shape.key, address)
    if (!free.available) return NextResponse.json({ success: false, error: free.error }, { status: 409 })

    try {
      await pool.execute(
        'UPDATE users SET username = ?, username_key = ?, username_changed_at = NOW() WHERE wallet_address = ?',
        [shape.display, shape.key, address],
      )
    } catch (error) {
      if (error.code === DUPLICATE_ENTRY) {
        return NextResponse.json({ success: false, error: taken.error }, { status: 409 })
      }
      throw error
    }

    /* The handle they just left stays theirs to take back, and out of everyone else's reach,
       for the lock window. A failure here costs that lock, never the claim itself. */
    if (current.username_key) {
      await pool
        .execute(
          `INSERT INTO username_history (username_key, wallet_address, released_at) VALUES (?, ?, NOW())
           ON DUPLICATE KEY UPDATE wallet_address = VALUES(wallet_address), released_at = VALUES(released_at)`,
          [current.username_key, address],
        )
        .catch((error) => console.error('[USERNAME_HISTORY_ERROR]:', error.message))
    }

    return NextResponse.json({ success: true, username: shape.display, previous: current.username || null })
  } catch (error) {
    console.error('[USERNAME_CLAIM_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
