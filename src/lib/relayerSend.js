/**
 * @file lib/relayerSend.js
 * @description The relayer's one road to the chain, shared by the gasless relay route and scheduled
 * post delivery. Server-only.
 */

import { ethers } from 'ethers'

// Two concurrent sends from the relayer race on its account nonce, which surfaces as
// "nonce too low" / "replacement underpriced". Each chain's sends run one after another,
// whichever feature they come from.
const sendQueues = new Map()

/**
 * Runs `task` after every earlier relayer send on the same chain.
 * @param {number} chainId
 * @param {() => Promise<any>} task
 * @returns {Promise<any>} Whatever `task` resolves to.
 */
export const enqueueRelayerSend = (chainId, task) => {
  const previous = sendQueues.get(chainId) ?? Promise.resolve()
  const next = previous.then(task, task)

  sendQueues.set(
    chainId,
    next.catch(() => {}),
  )

  return next
}

/** The relayer's signer on `provider`. */
export const relayerWallet = (provider) => new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider)

/**
 * EIP-1559 fees for a relayer send. maxFeePerGas must be >= maxPriorityFeePerGas, so it is clamped
 * up on low-base-fee chains (LUKSO) that would otherwise reject the tx with "priorityFee > maxFee".
 * @returns {Promise<{maxPriorityFeePerGas: bigint, maxFeePerGas: bigint}>}
 */
export const relayerFees = async (provider) => {
  const maxPriorityFeePerGas = ethers.parseUnits('2', 'gwei')
  const feeData = await provider.getFeeData()
  const networkMax = feeData.maxFeePerGas ?? 0n
  return { maxPriorityFeePerGas, maxFeePerGas: networkMax >= maxPriorityFeePerGas ? networkMax : maxPriorityFeePerGas }
}
