/**
 * @file api/v1/fees/route.js
 * @description Public, live cost of each Hup action on every chain, split by where the money goes:
 * the network's validators, the L1 it posts data to, and Hup itself. Feeds the /fees page.
 */

import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import { CONTRACTS, appChains } from '@/config/contracts'
import { ACTION_FEES, actionGas, isOnchainOn } from '@/config/actionFees'
import { gaslessChainIds } from '@/config/gasless'
import { fetchUsdPrices, priceKeyFor } from '@/lib/prices'
import { withServerProvider } from '@/lib/serverRpc'

const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'

// Fees move block to block but a page view should not cost ten RPC round trips each
const CACHE_MS = 30000
let cache = { at: 0, payload: null }

const HISTORY_BLOCKS = 48
const HISTORY_PERCENTILE = 50

const L1_ORACLE = '0x420000000000000000000000000000000000000F'
const L1_ORACLE_ABI = ['function getL1FeeUpperBound(uint256) view returns (uint256)']
const HUP_FEE_ABI = ['function fee() view returns (uint256)']

const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY

const readChain = async (chain, relayer, sponsoredIds) => {
  const hup = CONTRACTS[`chain${chain.id}`]?.hup
  if (!ethers.isAddress(hup ?? '')) return null

  return withServerProvider(chain.id, async (provider) => {
    const oracle = new ethers.Contract(L1_ORACLE, L1_ORACLE_ABI, provider)
    const [feeData, history, protocolFee, tank, ...l1Fees] = await Promise.all([
      provider.getFeeData(),
      provider.send('eth_feeHistory', [ethers.toQuantity(HISTORY_BLOCKS), 'latest', [HISTORY_PERCENTILE]]).catch(() => null),
      new ethers.Contract(hup, HUP_FEE_ABI, provider).fee().catch(() => 0n),
      relayer ? provider.getBalance(relayer).catch(() => null) : null,
      ...ACTION_FEES.map((action) =>
        isOnchainOn(action, chain.id) ? oracle.getL1FeeUpperBound(action.calldataBytes).catch(() => 0n) : 0n,
      ),
    ])

    // What a wallet actually pays per gas: the base fee plus a typical tip, never the 2x-base cap
    // a wallet reserves and mostly gets back. The tip is the window's median, because one block's
    // median can be a bot outbidding everyone and would triple the figure for that refresh.
    const tips = (history?.reward ?? []).map((entry) => BigInt(entry[0] ?? 0)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const tip = tips.length ? tips[tips.length >> 1] : feeData.maxPriorityFeePerGas ?? 0n
    const bases = (history?.baseFeePerGas ?? []).map((base) => BigInt(base))
    const gasPrice = bases.length ? bases[bases.length - 1] + tip : feeData.gasPrice ?? 0n

    // Per-block paid price, oldest first; the last entry is the next block's base fee, i.e. now
    const trend = bases.map((base) => (base + tip).toString())

    return {
      id: chain.id,
      name: chain.name,
      symbol: chain.nativeCurrency?.symbol ?? 'ETH',
      testnet: Boolean(chain.testnet),
      gasPrice: gasPrice.toString(),
      trend,
      tankFunded: tank === null ? null : tank > 0n,
      actions: ACTION_FEES.map((action, index) => {
        if (!isOnchainOn(action, chain.id)) return { id: action.id, onchain: false }

        const gas = actionGas(action, chain.id)
        return {
          id: action.id,
          onchain: true,
          sponsored: action.sponsored && sponsoredIds.includes(chain.id),
          gas: gas.toString(),
          network: ethers.formatEther(gas * gasPrice),
          l1: ethers.formatEther(l1Fees[index]),
          protocol: ethers.formatEther(protocolFee),
        }
      }),
    }
  })
}

export async function GET() {
  const now = Date.now()
  if (cache.payload && now - cache.at < CACHE_MS) {
    return NextResponse.json({ success: true, data: cache.payload, cached: true })
  }

  try {
    const relayer = RELAYER_PRIVATE_KEY ? new ethers.Wallet(RELAYER_PRIVATE_KEY).address : null
    const sponsoredIds = gaslessChainIds()

    const settled = await Promise.allSettled(appChains.map((chain) => readChain(chain, relayer, sponsoredIds)))
    const chains = settled
      .map((outcome, index) => {
        if (outcome.status === 'fulfilled') return outcome.value
        console.warn(`FEES_CHAIN_FAILED ${appChains[index].id}:`, outcome.reason?.shortMessage || outcome.reason?.message)
        return null
      })
      .filter(Boolean)

    const prices = await fetchUsdPrices(chains.map((chain) => priceKeyFor(chain.id, NATIVE_TOKEN)))
    // A testnet coin has no market; pricing it as its mainnet twin would invent a cost
    const priced = chains.map((chain) => ({
      ...chain,
      price: chain.testnet ? null : prices.get(priceKeyFor(chain.id, NATIVE_TOKEN)) ?? null,
    }))

    const payload = { at: now, chains: priced }
    cache = { at: now, payload }

    return NextResponse.json({ success: true, data: payload })
  } catch (err) {
    console.error('FEES_ERROR:', err.message)
    return NextResponse.json({ success: false, error: 'Could not read fees.' }, { status: 500 })
  }
}
