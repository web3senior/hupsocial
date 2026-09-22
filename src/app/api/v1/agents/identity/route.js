/**
 * @file api/v1/agents/identity/route.js
 * @description Links a wallet to its ERC-8004 agent id on one chain. No signature is needed: the
 * claim is only stored after this route reads the Identity Registry and sees the wallet own,
 * operate or be the registered wallet of that agent. Rows older than a day are re-read on GET,
 * so an agent that changed hands drops off.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { appChains } from '@/config/contracts'
import { getServerPublicClient } from '@/lib/serverPublicClient'
import { controlsAgent, erc8004For, identityRegistryAbi } from '@/lib/erc8004'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const STALE_SECONDS = 24 * 3600

const nowSeconds = () => Math.floor(Date.now() / 1000)

const readAgentUri = async (client, chainId, agentId) => {
  try {
    const uri = await client.readContract({ address: erc8004For(chainId).identity, abi: identityRegistryAbi, functionName: 'tokenURI', args: [BigInt(agentId)] })
    return typeof uri === 'string' ? uri.slice(0, 512) : null
  } catch {
    return null
  }
}

const reverify = async (row) => {
  const client = getServerPublicClient(row.network_id)
  if (!client) return row
  const ok = await controlsAgent(client, row.network_id, row.wallet_address, row.agent_id)
  if (!ok) {
    await pool.execute('DELETE FROM agent_identities WHERE wallet_address = ? AND network_id = ?', [row.wallet_address, row.network_id])
    return null
  }
  await pool.execute('UPDATE agent_identities SET verified_at = ? WHERE wallet_address = ? AND network_id = ?', [nowSeconds(), row.wallet_address, row.network_id])
  return { ...row, verified_at: nowSeconds() }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const wallet = (searchParams.get('wallet') || '').trim()
    const networkId = parseInt(searchParams.get('networkId'), 10) || null
    if (!ADDRESS.test(wallet)) return NextResponse.json({ success: false, error: 'wallet is required' }, { status: 400 })

    const [rows] = await pool.execute(
      `SELECT wallet_address, network_id, agent_id, agent_uri, verified_at
         FROM agent_identities
        WHERE wallet_address = ?${networkId ? ' AND network_id = ?' : ''}`,
      networkId ? [wallet.toLowerCase(), networkId] : [wallet.toLowerCase()],
    )

    const fresh = []
    for (const row of rows) {
      const current = nowSeconds() - Number(row.verified_at) > STALE_SECONDS ? await reverify(row) : row
      if (current) fresh.push({ ...current, registry: erc8004For(current.network_id).identity })
    }

    return NextResponse.json({ success: true, data: fresh })
  } catch (error) {
    console.error('[GET_AGENT_IDENTITY_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const wallet = String(body.wallet || '').trim()
    const networkId = parseInt(body.networkId, 10)
    const agentId = String(body.agentId ?? '').trim()

    if (!ADDRESS.test(wallet) || !/^\d{1,78}$/.test(agentId) || !appChains.some((chain) => chain.id === networkId)) {
      return NextResponse.json({ success: false, error: 'wallet, a supported networkId and a numeric agentId are required' }, { status: 400 })
    }

    const client = getServerPublicClient(networkId)
    if (!client) return NextResponse.json({ success: false, error: 'No RPC for that chain' }, { status: 503 })

    const ok = await controlsAgent(client, networkId, wallet, agentId)
    if (!ok) {
      return NextResponse.json(
        { success: false, error: `${wallet} does not own, operate or receive for agent ${agentId} on chain ${networkId}` },
        { status: 400 },
      )
    }

    const agentUri = await readAgentUri(client, networkId, agentId)
    await pool.execute(
      `INSERT INTO agent_identities (wallet_address, network_id, agent_id, agent_uri, verified_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE agent_id = VALUES(agent_id), agent_uri = VALUES(agent_uri), verified_at = VALUES(verified_at)`,
      [wallet.toLowerCase(), networkId, agentId, agentUri, nowSeconds()],
    )

    return NextResponse.json({
      success: true,
      data: { wallet_address: wallet.toLowerCase(), network_id: networkId, agent_id: agentId, agent_uri: agentUri, registry: erc8004For(networkId).identity },
    })
  } catch (error) {
    console.error('[POST_AGENT_IDENTITY_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
