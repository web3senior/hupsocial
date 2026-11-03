/**
 * @file lib/onchainPayment.js
 * @description Coin payments to a Hup address, checked onchain without a contract. Server-only.
 * Shared by agent top-ups (lib/agentBilling.js) and the decoration shop (lib/decorationShop.js).
 */

import { ethers } from 'ethers'
import { sameAddress } from '@/lib/address'
import { fetchUsdPrices, priceKeyFor } from '@/lib/prices'
import { getServerProvider } from '@/lib/serverRpc'
import { appChains } from '@/config/contracts'

const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/

// ERC725X's Executed: a Universal Profile paying from execute() leaves this log, not a plain transfer.
// Its indexing changed between versions (value in a topic, later in data), so both are read.
const EXECUTED_TOPIC = ethers.id('Executed(uint256,address,uint256,bytes4)')

export class PaymentError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export const isTxHash = (value) => TX_HASH_RE.test(String(value))

/** A Hup network whose coin Hup accepts: listed by the app and not a testnet. */
export const paymentChain = (chainId) => {
  const chain = appChains.find((item) => item.id === Number(chainId))
  if (!chain || chain.testnet) throw new PaymentError(400, 'Payments are not accepted on that network')
  return chain
}

/** The network coin's USD price right now. */
export const coinPrice = async (chain) => {
  const priceKey = priceKeyFor(chain.id, NATIVE_TOKEN)
  const usdPrice = priceKey ? (await fetchUsdPrices([priceKey])).get(priceKey) : null
  if (!usdPrice) throw new PaymentError(503, `The ${chain.nativeCurrency.symbol} price is unavailable right now, try again shortly`)
  return usdPrice
}

/**
 * How much of the network's coin `payer` sent to `payee` in one confirmed transaction: a plain
 * transfer from a wallet, or a Universal Profile's execute(CALL, payee, value, "") — sent by one of
 * its controllers or by a relayer, so only the profile's own Executed log says who paid.
 * @returns {Promise<{paid: bigint, blockNumber: number, provider: object}>} `paid` is 0n when the
 *   transaction paid nothing from payer to payee; the provider is handed back for a follow-up read.
 */
export const readPayment = async (chain, txHash, payer, payee) => {
  if (!isTxHash(txHash)) throw new PaymentError(400, 'Invalid transaction')
  const provider = await getServerProvider(chain.id)
  if (!provider) throw new PaymentError(503, `${chain.name} cannot be reached right now, try again shortly`)

  const [tx, receipt] = await Promise.all([provider.getTransaction(txHash), provider.getTransactionReceipt(txHash)])
  if (!tx || !receipt) throw new PaymentError(404, 'That transfer is not confirmed yet, try again in a moment')
  if (receipt.status !== 1) throw new PaymentError(400, 'That transfer failed onchain')

  let paid = sameAddress(tx.from, payer) && sameAddress(tx.to, payee) ? tx.value : 0n
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, payer) || log.topics[0] !== EXECUTED_TOPIC || log.topics.length < 3) continue
    if (BigInt(log.topics[1]) !== 0n || !sameAddress(ethers.dataSlice(log.topics[2], 12), payee)) continue
    // A plain transfer's selector is zero, so of the two slots the value is in whichever is not
    const fromTopic = log.topics[3] ? BigInt(log.topics[3]) : 0n
    const fromData = log.data && log.data !== '0x' ? BigInt(ethers.dataSlice(log.data, 0, 32)) : 0n
    paid += fromData || fromTopic
  }
  return { paid, blockNumber: receipt.blockNumber, provider }
}

/** When a block was produced, in unix seconds. */
export const blockTime = async (provider, blockNumber) => {
  const block = await provider.getBlock(blockNumber)
  if (!block) throw new PaymentError(404, 'That transfer is not confirmed yet, try again in a moment')
  return Number(block.timestamp)
}
