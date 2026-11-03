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
import { normalizeAddress } from '@/lib/address'
import { agentBillingAddress, CREDIT_MARGIN, CREDITS_PER_USD, TOP_UP_CHAIN_ID } from '@/config/agentModels'
import { AgentError } from '@/lib/hostedAgents'
import * as onchain from '@/lib/onchainPayment'

const HISTORY_SIZE = 20

// --- Payments ---

/* The checks live in lib/onchainPayment.js, shared with the decoration shop. Their failures are
   rethrown as AgentError, which is what the agent routes turn into a status and a message. */
const asAgentError = (error) => {
  throw error instanceof onchain.PaymentError ? new AgentError(error.status, error.message) : error
}

const paymentChain = (chainId) => {
  try {
    return onchain.paymentChain(chainId)
  } catch (error) {
    return asAgentError(error)
  }
}

const coinPrice = (chain) => onchain.coinPrice(chain).catch(asAgentError)

/** @returns {Promise<bigint>} What payer sent payee in the transaction, 0n when nothing. */
const paidInTx = (chain, txHash, payer, payee) => onchain.readPayment(chain, txHash, payer, payee).then(({ paid }) => paid, asAgentError)

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
