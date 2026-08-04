/**
 * @file api/v1/miner/faucet/route.js
 * @description Gas faucet for Hup Miner session burners. Players play gasless: their burner
 * session key signs the play transaction, and this endpoint keeps that burner fueled — Hup
 * covers all fees. Abuse containment is layered: a drip goes only to the CURRENT onchain session
 * key of a real Hup account (verified against Hup Core, never taken from the request), only when
 * that burner is actually low, at most once per account per UTC day, from a faucet wallet whose
 * balance caps the total blast radius.
 *
 * CORS is open on purpose: mini apps run on their own origins inside sandboxed frames, and this
 * endpoint grants nothing an attacker could not request directly — every check is server-side.
 */

import { NextResponse } from 'next/server'
import { createPublicClient, createWalletClient, formatEther, http, isAddress, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'wagmi/chains'
import pool from '@/lib/db'
import { CONTRACTS } from '@/config/contracts'

// Hup Miner lives on Monad testnet alongside the HupApps registry
const FAUCET_CHAIN = monadTestnet
const HUP_CORE = CONTRACTS[`chain${FAUCET_CHAIN.id}`]?.hup

// Top up to ~40 plays; skip the drip while the burner still holds half of one
const DRIP_AMOUNT = process.env.MINER_FAUCET_DRIP || '0.02'
const LOW_BALANCE_THRESHOLD = parseEther(DRIP_AMOUNT) / 2n

const USER_SESSIONS_ABI = [
  {
    type: 'function',
    name: 'userSessions',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [
      { name: 'burnerKey', type: 'address' },
      { name: 'expiresAt', type: 'uint256' },
    ],
  },
]

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const jsonResponse = (body, status = 200) => NextResponse.json(body, { status, headers: CORS_HEADERS })

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request) {
  try {
    const faucetKey = process.env.MINER_FAUCET_PRIVATE_KEY
    if (!faucetKey || !HUP_CORE) {
      return jsonResponse({ success: false, error: 'Faucet is not configured' }, 503)
    }

    const { owner } = await request.json().catch(() => ({}))
    if (!owner || !isAddress(owner)) {
      return jsonResponse({ success: false, error: 'A valid owner address is required' }, 400)
    }

    const transport = http(FAUCET_CHAIN.rpcUrls.default.http[0])
    const publicClient = createPublicClient({ chain: FAUCET_CHAIN, transport })

    // The burner comes from Hup Core, never from the request — a drip can only ever land on the
    // key the account holder authorized in Settings.
    const [burnerKey, expiresAt] = await publicClient.readContract({
      address: HUP_CORE,
      abi: USER_SESSIONS_ABI,
      functionName: 'userSessions',
      args: [owner],
    })

    const nowSeconds = BigInt(Math.floor(Date.now() / 1000))
    if (!burnerKey || burnerKey === '0x0000000000000000000000000000000000000000' || expiresAt <= nowSeconds) {
      return jsonResponse({ success: false, error: 'No active session for this account — authorize one in Settings' }, 403)
    }

    const balance = await publicClient.getBalance({ address: burnerKey })
    if (balance >= LOW_BALANCE_THRESHOLD) {
      return jsonResponse({ success: true, data: { dripped: false, reason: 'Burner still fueled', balance: formatEther(balance) } })
    }

    // One drip per account per UTC day. The unique key on (owner, drip_day) makes this atomic —
    // a concurrent duplicate request loses the insert race and gets refused.
    const dripDay = new Date().toISOString().slice(0, 10)
    try {
      await pool.execute('INSERT INTO miner_faucet_drips (owner, burner, drip_day, network_id) VALUES (?, ?, ?, ?)', [
        owner.toLowerCase(),
        burnerKey.toLowerCase(),
        dripDay,
        FAUCET_CHAIN.id,
      ])
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY') {
        return jsonResponse({ success: false, error: 'Daily faucet limit reached for this account' }, 429)
      }
      throw err
    }

    const account = privateKeyToAccount(faucetKey)
    const walletClient = createWalletClient({ account, chain: FAUCET_CHAIN, transport })

    const hash = await walletClient.sendTransaction({
      to: burnerKey,
      value: parseEther(DRIP_AMOUNT),
    })

    await pool.execute('UPDATE miner_faucet_drips SET tx_hash = ? WHERE owner = ? AND drip_day = ?', [hash, owner.toLowerCase(), dripDay])

    return jsonResponse({ success: true, data: { dripped: true, txHash: hash, amount: DRIP_AMOUNT } })
  } catch (err) {
    console.error('Miner faucet failed:', err)
    return jsonResponse({ success: false, error: 'Faucet request failed' }, 500)
  }
}
