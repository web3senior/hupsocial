/**
 * @file api/v1/admin/relayer/sweep/route.js
 * @description Admin-only. Moves the relayer's native balance on the requested chains to an
 * address the admin wallet signed for. The private key never leaves the server; the admin only
 * proves who they are.
 */

import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import { isAddress, recoverMessageAddress } from 'viem'
import pool from '@/lib/db'
import { appChains } from '@/config/contracts'
import { enqueueRelayerSend, relayerFees, relayerWallet } from '@/lib/relayerSend'
import { sweepMessage } from '@/lib/relayerSweep'
import { withServerProvider } from '@/lib/serverRpc'

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.toLowerCase()

// OP-stack chains charge an L1 data fee on top of gas; the predeploy quotes an upper bound for
// an unsigned tx of this many bytes. Elsewhere the call fails and the reserve is zero.
const L1_ORACLE = '0x420000000000000000000000000000000000000F'
const L1_ORACLE_ABI = ['function getL1FeeUpperBound(uint256) view returns (uint256)']
const TRANSFER_TX_BYTES = 200n

const FALLBACK_GAS = 21000n

const sweepChain = async (chainId, to) =>
  withServerProvider(chainId, async (provider) => {
    const wallet = relayerWallet(provider)
    const balance = await provider.getBalance(wallet.address)
    if (balance === 0n) return { skipped: 'empty' }

    const fees = await relayerFees(provider)
    const gasLimit = await provider.estimateGas({ from: wallet.address, to, value: 1n }).catch(() => FALLBACK_GAS)
    const l1Fee = await new ethers.Contract(L1_ORACLE, L1_ORACLE_ABI, provider)
      .getL1FeeUpperBound(TRANSFER_TX_BYTES)
      .catch(() => 0n)

    const reserve = gasLimit * fees.maxFeePerGas + l1Fee
    const value = balance - reserve
    if (value <= 0n) return { skipped: 'gas', balance: ethers.formatEther(balance), reserve: ethers.formatEther(reserve) }

    const tx = await enqueueRelayerSend(chainId, () => wallet.sendTransaction({ to, value, gasLimit, ...fees }))
    return { hash: tx.hash, value: ethers.formatEther(value) }
  })

export async function POST(request) {
  if (!ADMIN_WALLET || !process.env.RELAYER_PRIVATE_KEY) {
    return NextResponse.json({ success: false, error: 'Relayer or admin is not configured.' }, { status: 503 })
  }

  try {
    const { signature, nonce, to, chainIds } = await request.json()

    if (!signature || !nonce || !isAddress(to ?? '') || !Array.isArray(chainIds) || chainIds.length === 0) {
      return NextResponse.json({ success: false, error: 'signature, nonce, to and chainIds are required.' }, { status: 400 })
    }

    const ids = [...new Set(chainIds.map(Number))]
    const unknown = ids.filter((id) => !appChains.some((chain) => chain.id === id))
    if (unknown.length) {
      return NextResponse.json({ success: false, error: `Unknown chain: ${unknown.join(', ')}` }, { status: 400 })
    }

    const signer = await recoverMessageAddress({ message: sweepMessage({ to, chainIds, nonce }), signature }).catch(() => null)
    if (signer?.toLowerCase() !== ADMIN_WALLET) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const [nonceRows] = await pool.execute(
      'SELECT id FROM nonces WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()',
      [nonce, signer.toLowerCase()],
    )
    if (nonceRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid or expired nonce' }, { status: 401 })
    }
    await pool.execute('DELETE FROM nonces WHERE nonce = ?', [nonce])

    const relayer = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY).address
    if (to.toLowerCase() === relayer.toLowerCase()) {
      return NextResponse.json({ success: false, error: 'That is the relayer itself.' }, { status: 400 })
    }

    const settled = await Promise.allSettled(ids.map((id) => sweepChain(id, to)))
    const results = Object.fromEntries(
      ids.map((id, index) => {
        const outcome = settled[index]
        if (outcome.status === 'fulfilled') return [id, outcome.value]
        console.error(`RELAYER_SWEEP_FAILED chain ${id}:`, outcome.reason?.shortMessage || outcome.reason?.message)
        return [id, { error: outcome.reason?.shortMessage || outcome.reason?.message || 'Send failed' }]
      }),
    )

    return NextResponse.json({ success: true, data: { relayer, to, results } })
  } catch (err) {
    console.error('RELAYER_SWEEP_ERROR:', err.message)
    return NextResponse.json({ success: false, error: 'Sweep failed.' }, { status: 500 })
  }
}
