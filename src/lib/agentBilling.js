/**
 * @file lib/agentBilling.js
 * @description Hosted agents' credits. Server-only.
 *
 * Hup resells AIML API: an agent's wallet sends any Hup network's own coin to Hup's billing
 * address, the transfer is checked onchain and credited at the USD price of the moment, and every
 * chat turn or task run is charged what AIML reported it cost (lib/hupiModel.js streamRound) plus
 * CREDIT_MARGIN. Creating an agent is free.
 */

import { ethers } from 'ethers'
import pool from '@/lib/db'
import { normalizeAddress, sameAddress } from '@/lib/address'
import { fetchUsdPrices, priceKeyFor } from '@/lib/prices'
import { getServerProvider } from '@/lib/serverRpc'
import { appChains } from '@/config/contracts'
import { agentBillingAddress, CREDIT_MARGIN, CREDITS_PER_USD, TOP_UP_CHAIN_ID } from '@/config/agentModels'
import { AgentError } from '@/lib/hostedAgents'

const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/
const HISTORY_SIZE = 20

// ERC725X's Executed: a Universal Profile paying from execute() leaves this log, not a plain transfer.
// Its indexing changed between versions (value in a topic, later in data), so both are read.
const EXECUTED_TOPIC = ethers.id('Executed(uint256,address,uint256,bytes4)')

// --- Payments ---

/** A Hup network whose coin pays for agents: listed by the app and not a testnet. */
const paymentChain = (chainId) => {
  const chain = appChains.find((item) => item.id === Number(chainId))
  if (!chain || chain.testnet) throw new AgentError(400, 'Payments are not accepted on that network')
  return chain
}

const coinPrice = async (chain) => {
  const priceKey = priceKeyFor(chain.id, NATIVE_TOKEN)
  const usdPrice = priceKey ? (await fetchUsdPrices([priceKey])).get(priceKey) : null
  if (!usdPrice) throw new AgentError(503, `The ${chain.nativeCurrency.symbol} price is unavailable right now, try again shortly`)
  return usdPrice
}

/**
 * How much of the network's coin `payer` sent to `payee` in one confirmed transaction: a plain
 * transfer from a wallet, or a Universal Profile's execute(CALL, payee, value, "") — sent by one of
 * its controllers or by a relayer, so only the profile's own Executed log says who paid.
 * @returns {Promise<bigint>} 0n when the transaction paid nothing from payer to payee.
 */
const paidInTx = async (chain, txHash, payer, payee) => {
  if (!TX_HASH_RE.test(String(txHash))) throw new AgentError(400, 'Invalid transaction')
  const provider = await getServerProvider(chain.id)
  if (!provider) throw new AgentError(503, `${chain.name} cannot be reached right now, try again shortly`)

  const [tx, receipt] = await Promise.all([provider.getTransaction(txHash), provider.getTransactionReceipt(txHash)])
  if (!tx || !receipt) throw new AgentError(404, 'That transfer is not confirmed yet, try again in a moment')
  if (receipt.status !== 1) throw new AgentError(400, 'That transfer failed onchain')

  let paid = sameAddress(tx.from, payer) && sameAddress(tx.to, payee) ? tx.value : 0n
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, payer) || log.topics[0] !== EXECUTED_TOPIC || log.topics.length < 3) continue
    if (BigInt(log.topics[1]) !== 0n || !sameAddress(ethers.dataSlice(log.topics[2], 12), payee)) continue
    // A plain transfer's selector is zero, so of the two slots the value is in whichever is not
    const fromTopic = log.topics[3] ? BigInt(log.topics[3]) : 0n
    const fromData = log.data && log.data !== '0x' ? BigInt(ethers.dataSlice(log.data, 0, 32)) : 0n
    paid += fromData || fromTopic
  }
  return paid
}

// --- Top-ups ---

/**
 * Credits a transfer from the agent's wallet to the billing address, on any Hup network. Safe to
 * call twice for one transfer: the hash is the table's key, so the second call credits nothing.
 * @returns {Promise<{credits: number, balance: number}>} What this transfer added, and the new balance.
 */
export const creditTopUp = async (agent, txHash, chainId = TOP_UP_CHAIN_ID) => {
  const billing = agentBillingAddress()
  if (!billing) throw new AgentError(503, 'Top-ups are not set up on this deployment')
  const chain = paymentChain(chainId)

  // A Universal Profile agent pays from its current key, which a restore replaces
  const payer = agent.controllerAddress ?? agent.address
  const value = await paidInTx(chain, txHash, payer, billing)
  if (value <= 0n) throw new AgentError(400, 'That transfer is not a top-up from this agent')

  const usdPrice = await coinPrice(chain)
  const credits = Math.floor(Number(ethers.formatEther(value)) * usdPrice * CREDITS_PER_USD)

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [inserted] = await connection.execute(
      'INSERT IGNORE INTO agent_topups (tx_hash, network_id, agent_address, amount_wei, usd_price, credits) VALUES (?, ?, ?, ?, ?, ?)',
      [txHash.toLowerCase(), chain.id, agent.address, value.toString(), usdPrice, credits],
    )
    const added = inserted.affectedRows === 1 ? credits : 0
    if (added) await connection.execute('UPDATE hosted_agents SET credits = credits + ? WHERE agent_address = ?', [added, agent.address])
    const [[row]] = await connection.execute('SELECT credits FROM hosted_agents WHERE agent_address = ?', [agent.address])
    await connection.commit()
    return { credits: added, balance: Number(row.credits) }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

// --- Usage ---

/**
 * Charges one run at what AIML reported it cost plus Hup's margin. Charged even when the run then
 * failed: the model was used either way.
 */
export const chargeRun = async (agentAddress, { kind, taskId = null, model, credits }) => {
  const amount = Math.max(0, Math.ceil((Number(credits) || 0) * CREDIT_MARGIN))
  if (!amount) return
  const address = normalizeAddress(agentAddress)
  await pool.execute('INSERT INTO agent_usage (agent_address, kind, task_id, model, credits) VALUES (?, ?, ?, ?, ?)', [address, kind, taskId, model, amount])
  await pool.execute('UPDATE hosted_agents SET credits = credits - ? WHERE agent_address = ?', [amount, address])
}

/** The latest charges and top-ups, newest first, for the agent's credits panel. */
export const readBilling = async (agentAddress) => {
  const address = normalizeAddress(agentAddress)
  const [[usage], [topups]] = await Promise.all([
    pool.execute(`SELECT kind, model, credits, created_at FROM agent_usage WHERE agent_address = ? ORDER BY id DESC LIMIT ${HISTORY_SIZE}`, [address]),
    pool.execute(`SELECT tx_hash, network_id, amount_wei, credits, created_at FROM agent_topups WHERE agent_address = ? ORDER BY created_at DESC LIMIT ${HISTORY_SIZE}`, [address]),
  ])
  return {
    usage: usage.map((row) => ({ kind: row.kind, model: row.model, credits: Number(row.credits), createdAt: new Date(row.created_at).toISOString() })),
    topups: topups.map((row) => ({
      txHash: row.tx_hash,
      chainId: Number(row.network_id),
      amount: ethers.formatEther(BigInt(row.amount_wei)),
      credits: Number(row.credits),
      createdAt: new Date(row.created_at).toISOString(),
    })),
  }
}
