/**
 * @file lib/adminPassServer.js
 * @description Server check for the admin pass (lib/adminPass.js): signed by the admin wallet,
 * not yet expired, and not stamped further out than one pass may run.
 */

import { sameAddress } from '@/lib/address'
import { ADMIN_PASS_HEADER, ADMIN_PASS_TTL_MS, adminPassMessage, decodeAdminPass } from '@/lib/adminPass'
import { verifyWalletSignature } from '@/lib/walletSignature'

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.toLowerCase()

// Room for a client clock that runs a little ahead of the server's.
const CLOCK_SKEW_MS = 5 * 60 * 1000

/**
 * Whether the request carries a live admin pass.
 * @param {Request} request
 * @returns {Promise<boolean>}
 */
export async function hasAdminPass(request) {
  if (!ADMIN_WALLET) return false

  const pass = decodeAdminPass(request.headers.get(ADMIN_PASS_HEADER))
  if (!pass || !sameAddress(pass.wallet, ADMIN_WALLET)) return false

  const now = Date.now()
  if (pass.expiresAt <= now || pass.expiresAt > now + ADMIN_PASS_TTL_MS + CLOCK_SKEW_MS) return false

  return verifyWalletSignature(ADMIN_WALLET, adminPassMessage(pass), pass.signature, { chainId: pass.chainId })
}
