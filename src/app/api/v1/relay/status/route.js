/**
 * @file api/v1/relay/status/route.js
 * @description Public health of the gasless relayer: its address and, per sponsored chain,
 * how much native currency is left and roughly how many posts that still pays for. Feeds the
 * /gas page so anyone can see the tank and top it up.
 *
 * The private key never leaves the server — only the address derived from it is returned,
 * which is public information the moment the relayer sends its first transaction anyway.
 */

import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import { CONTRACTS, appChains } from '@/config/contracts'
import { gaslessChainIds } from '@/config/gasless'
import { fetchUsdPrices, priceKeyFor } from '@/lib/prices'

const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'

const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY

// A relayed create costs roughly this much gas: the inner call plus forwarder overhead. The
// request itself is capped higher (600k) to leave headroom, but billing at the cap would
// understate the runway by nearly half.
const GAS_PER_POST = 350000n

// Balances move slowly compared to page views, and every refresh is one RPC call per chain
const CACHE_MS = 60000
let cache = { at: 0, payload: null }

const TRUSTED_FORWARDER_ABI = ['function isTrustedForwarder(address) view returns (bool)']

const readChain = async (chainId, relayer) => {
  const contracts = CONTRACTS[`chain${chainId}`]
  const chain = appChains.find((entry) => entry.id === chainId)
  const rpcUrl = chain?.rpcUrls?.default?.http?.[0]
  const forwarder = contracts?.hupForwarder ?? contracts?.forwarder

  if (!chain || !rpcUrl || !contracts?.hup || !forwarder) return null

  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true })

  try {
    const [balance, feeData, trusted] = await Promise.all([
      provider.getBalance(relayer),
      provider.getFeeData(),
      new ethers.Contract(contracts.hup, TRUSTED_FORWARDER_ABI, provider)
        .isTrustedForwarder(forwarder)
        .catch(() => null),
    ])

    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? null
    const costPerPost = gasPrice ? gasPrice * GAS_PER_POST : null

    return {
      id: chainId,
      name: chain.name,
      symbol: chain.nativeCurrency?.symbol ?? 'ETH',
      balance: ethers.formatEther(balance),
      costPerPost: costPerPost ? ethers.formatEther(costPerPost) : null,
      // Null rather than zero when the gas price is unreadable, so the UI can say "unknown"
      // instead of implying the tank is empty
      postsRemaining: costPerPost && costPerPost > 0n ? Number(balance / costPerPost) : null,
      // A chain can be funded and still not relay: the contract has to trust the forwarder
      trusted,
    }
  } catch (err) {
    console.error(`RELAY_STATUS_FAILED chain ${chainId}:`, err.shortMessage || err.message)
    return { id: chainId, name: chain.name, symbol: chain.nativeCurrency?.symbol ?? 'ETH', balance: null, costPerPost: null, postsRemaining: null, trusted: null }
  } finally {
    provider.destroy()
  }
}

export async function GET() {
  if (!RELAYER_PRIVATE_KEY) {
    return NextResponse.json({ success: false, error: 'Relayer is not configured.' }, { status: 503 })
  }

  const now = Date.now()
  if (cache.payload && now - cache.at < CACHE_MS) {
    return NextResponse.json({ success: true, data: cache.payload, cached: true })
  }

  try {
    const relayer = new ethers.Wallet(RELAYER_PRIVATE_KEY).address
    const chainIds = gaslessChainIds()
    const balances = (await Promise.all(chainIds.map((chainId) => readChain(chainId, relayer)))).filter(Boolean)

    // Cosmetic and best-effort, exactly as lib/prices promises: a chain with no listed price
    // (every testnet) simply carries nulls and the UI falls back to native amounts.
    const prices = await fetchUsdPrices(balances.map((chain) => priceKeyFor(chain.id, NATIVE_TOKEN)))

    const chains = balances.map((chain) => {
      const price = prices.get(priceKeyFor(chain.id, NATIVE_TOKEN)) ?? null

      return {
        ...chain,
        price,
        balanceUsd: price !== null && chain.balance !== null ? Number(chain.balance) * price : null,
        costPerPostUsd: price !== null && chain.costPerPost !== null ? Number(chain.costPerPost) * price : null,
      }
    })

    const totalUsd = chains.reduce((sum, chain) => sum + (chain.balanceUsd ?? 0), 0)

    const payload = { relayer, chains, totalUsd }
    cache = { at: now, payload }

    return NextResponse.json({ success: true, data: payload })
  } catch (err) {
    console.error('RELAY_STATUS_ERROR:', err.message)
    return NextResponse.json({ success: false, error: 'Could not read relayer status.' }, { status: 500 })
  }
}
