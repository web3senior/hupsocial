/**
 * @file api/v1/swaps/route.js
 * @description Records swaps confirmed through the /swap page. There is no Hup contract in the
 * swap path (users call Uniswap routers directly), so this is app-side activity logging written
 * at confirmation time — NOT chain indexing; nothing here scans events. Rows are client-reported
 * and deduped by (network_id, tx_hash); the `verified` column stays 0 until a future cidex job
 * checks receipts, and trending treats the data as engagement telemetry, not accounting.
 *
 * Table (created 2026-08-12, app-owned):
 *   CREATE TABLE IF NOT EXISTS swap_activity (
 *     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 *     network_id INT UNSIGNED NOT NULL,
 *     wallet_address VARCHAR(42) NOT NULL,
 *     tx_hash VARCHAR(66) NOT NULL,
 *     token_in VARCHAR(42) NOT NULL,            -- 0x0000…0000 for the native coin
 *     token_in_symbol VARCHAR(32) NOT NULL DEFAULT '',
 *     token_out VARCHAR(42) NOT NULL,
 *     token_out_symbol VARCHAR(32) NOT NULL DEFAULT '',
 *     amount_in DECIMAL(65,0) NOT NULL DEFAULT 0,
 *     amount_out DECIMAL(65,0) NOT NULL DEFAULT 0,  -- quoted at submit, not settled output
 *     native_wei DECIMAL(65,0) NOT NULL DEFAULT 0,  -- native-leg estimate for volume rollups
 *     venue VARCHAR(8) NOT NULL DEFAULT 'v3',      -- 'v3' | 'v4' | 'sushi'; widened from VARCHAR(4) 2026-08-16
 *     verified TINYINT(1) NOT NULL DEFAULT 0,
 *     created_at BIGINT UNSIGNED NOT NULL,
 *     PRIMARY KEY (id),
 *     UNIQUE KEY uniq_swap (network_id, tx_hash),
 *     KEY idx_trending (network_id, created_at)
 *   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { CONTRACTS } from '@/config/contracts'

export const runtime = 'nodejs'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const HASH_RE = /^0x[0-9a-fA-F]{64}$/
const AMOUNT_RE = /^\d{1,65}$/

export async function POST(request) {
  try {
    const body = await request.json()

    const networkId = parseInt(body.networkId)
    const wallet = String(body.wallet ?? '')
    const txHash = String(body.txHash ?? '')
    const tokenIn = String(body.tokenIn ?? '')
    const tokenOut = String(body.tokenOut ?? '')
    const amountIn = String(body.amountIn ?? '0')
    const amountOut = String(body.amountOut ?? '0')
    const nativeWei = String(body.nativeWei ?? '0')
    const venue = ['v3', 'v4', 'sushi'].includes(body.venue) ? body.venue : 'v3'
    const tokenInSymbol = String(body.tokenInSymbol ?? '').slice(0, 32)
    const tokenOutSymbol = String(body.tokenOutSymbol ?? '').slice(0, 32)

    if (
      !CONTRACTS[`chain${networkId}`] ||
      !ADDRESS_RE.test(wallet) ||
      !HASH_RE.test(txHash) ||
      !ADDRESS_RE.test(tokenIn) ||
      !ADDRESS_RE.test(tokenOut) ||
      !AMOUNT_RE.test(amountIn) ||
      !AMOUNT_RE.test(amountOut) ||
      !AMOUNT_RE.test(nativeWei)
    ) {
      return NextResponse.json({ success: false, error: 'Invalid swap payload' }, { status: 400 })
    }

    // INSERT IGNORE: replaying the same tx hash (retries, double-fires) is a silent no-op
    await pool.execute(
      `INSERT IGNORE INTO swap_activity
        (network_id, wallet_address, tx_hash, token_in, token_in_symbol, token_out, token_out_symbol,
         amount_in, amount_out, native_wei, venue, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UNIX_TIMESTAMP())`,
      [
        networkId,
        wallet.toLowerCase(),
        txHash.toLowerCase(),
        tokenIn.toLowerCase(),
        tokenInSymbol,
        tokenOut.toLowerCase(),
        tokenOutSymbol,
        amountIn,
        amountOut,
        nativeWei,
        venue,
      ],
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[POST_SWAP_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
