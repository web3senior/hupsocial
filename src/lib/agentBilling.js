/**
 * @file lib/agentBilling.js
 * @description Hosted agents' credits. Server-only.
 *
 * Hup resells AIML API: an agent's wallet sends LYX on LUKSO to Hup's billing address, the
 * transfer is checked onchain and credited at the USD price of the moment, and every chat turn or
 * task run is charged exactly what AIML reported it cost (lib/hupiModel.js streamRound). No margin.
 */

import { ethers } from 'ethers'
import pool from '@/lib/db'
import { normalizeAddress, sameAddress } from '@/lib/address'
import { fetchUsdPrices, priceKeyFor } from '@/lib/prices'
import { getServerProvider } from '@/lib/serverRpc'
import { agentBillingAddress, CREDITS_PER_USD, TOP_UP_CHAIN_ID } from '@/config/agentModels'
import { AgentError } from '@/lib/hostedAgents'

const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/
const HISTORY_SIZE = 20

/**
 * Credits a transfer from the agent's wallet to the billing address. Safe to call twice for one
 * transfer: the hash is the table's key, so the second call credits nothing and says so.
 * @returns {Promise<{credits: number, balance: number}>} What this transfer added, and the new balance.
 */
export const creditTopUp = async (agent, txHash) => {
  const billing = agentBillingAddress()
  if (!billing) throw new AgentError(503, 'Top-ups are not set up on this deployment')
  if (!TX_HASH_RE.test(String(txHash))) throw new AgentError(400, 'Invalid transaction')

  const provider = await getServerProvider(TOP_UP_CHAIN_ID)
  if (!provider) throw new AgentError(503, 'LUKSO cannot be reached right now, try again shortly')

  const [tx, receipt] = await Promise.all([provider.getTransaction(txHash), provider.getTransactionReceipt(txHash)])
  if (!tx || !receipt) throw new AgentError(404, 'That transfer is not confirmed yet, try again in a moment')
  if (receipt.status !== 1) throw new AgentError(400, 'That transfer failed onchain')
  // The agent's own wallet, straight to the billing address: anything else is not this agent's top-up
  if (!sameAddress(tx.from, agent.address) || !sameAddress(tx.to, billing) || tx.value <= 0n) {
    throw new AgentError(400, 'That transfer is not a top-up from this agent')
  }

  const priceKey = priceKeyFor(TOP_UP_CHAIN_ID, NATIVE_TOKEN)
  const usdPrice = (await fetchUsdPrices([priceKey])).get(priceKey)
  if (!usdPrice) throw new AgentError(503, 'The LYX price is unavailable right now, try again shortly')

  const credits = Math.floor(Number(ethers.formatEther(tx.value)) * usdPrice * CREDITS_PER_USD)

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [inserted] = await connection.execute(
      'INSERT IGNORE INTO agent_topups (tx_hash, network_id, agent_address, amount_wei, usd_price, credits) VALUES (?, ?, ?, ?, ?, ?)',
      [txHash.toLowerCase(), TOP_UP_CHAIN_ID, agent.address, tx.value.toString(), usdPrice, credits],
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

/**
 * Charges one run at what AIML reported it cost. Charged even when the run then failed: the model
 * was used either way.
 */
export const chargeRun = async (agentAddress, { kind, taskId = null, model, credits }) => {
  const amount = Math.max(0, Math.ceil(Number(credits) || 0))
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
    pool.execute(`SELECT tx_hash, amount_wei, credits, created_at FROM agent_topups WHERE agent_address = ? ORDER BY created_at DESC LIMIT ${HISTORY_SIZE}`, [address]),
  ])
  return {
    usage: usage.map((row) => ({ kind: row.kind, model: row.model, credits: Number(row.credits), createdAt: new Date(row.created_at).toISOString() })),
    topups: topups.map((row) => ({
      txHash: row.tx_hash,
      amount: ethers.formatEther(BigInt(row.amount_wei)),
      credits: Number(row.credits),
      createdAt: new Date(row.created_at).toISOString(),
    })),
  }
}
