/**
 * @file lib/burnerUpgrade.js
 * @description Moves the in-app wallet (the burner session key) from the v1 vault to Key Vault v2.
 *
 * A v2 key is a different address, so the upgrade is: derive the v2 key, sweep every chain's
 * native balance from the old address to the new one (the old key pays each sweep's gas from the
 * balance it moves), keep the old key re-encrypted under v2 so anything a sweep could not move
 * stays reachable, then point local storage at the new key. The onchain session is re-authorized
 * by the caller, from the connected wallet, because only the owner can call authorizeSession.
 */

import { ethers } from 'ethers'
import { appChains } from '@/config/contracts'
import { encryptData } from './cryptoHelper'
import { KEY_LABELS } from './keyDerivationV2.mjs'
import { deriveKeyFromMasterV2 } from './keyVaultV2'
import { claimLegacyBurner, writeBurner, writeUnlockedBurner } from './burnerStorage'

const TRANSFER_GAS = 21000n
/* A plain transfer's L2 execution fee is exact, but OP-stack chains add an L1 data fee that
   estimateGas does not report. Four times the execution fee covers it comfortably; what stays
   behind is dust, and the old key keeps it reachable. */
const FEE_HEADROOM = 4n
const BALANCE_TIMEOUT_MS = 8000

const rpcFor = (chain) => chain?.rpcUrls?.default?.http?.[0]

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])

/**
 * Native balances the old address holds, chain by chain. A chain whose RPC does not answer is
 * reported as such rather than silently treated as empty.
 * @returns {Promise<Array<{chain: object, balance: bigint|null}>>}
 */
export const readLegacyBalances = async (address) =>
  Promise.all(
    appChains.map(async (chain) => {
      const rpc = rpcFor(chain)
      if (!rpc) return { chain, balance: null }
      try {
        const provider = new ethers.JsonRpcProvider(rpc, chain.id, { staticNetwork: true })
        return { chain, balance: await withTimeout(provider.getBalance(address), BALANCE_TIMEOUT_MS) }
      } catch {
        return { chain, balance: null }
      }
    }),
  )

/**
 * Sweeps one chain. Returns what happened so the UI can say it plainly.
 * @returns {Promise<{chainId: number, status: 'moved'|'empty'|'dust'|'failed', amount?: bigint, txHash?: string, error?: string}>}
 */
const sweepChain = async ({ chain, balance }, oldKey, toAddress) => {
  if (balance === null) return { chainId: chain.id, status: 'failed', error: 'Network did not answer' }
  if (balance === 0n) return { chainId: chain.id, status: 'empty' }

  try {
    const provider = new ethers.JsonRpcProvider(rpcFor(chain), chain.id, { staticNetwork: true })
    const wallet = new ethers.Wallet(oldKey, provider)
    const feeData = await provider.getFeeData()
    const maxFee = feeData.maxFeePerGas ?? feeData.gasPrice
    if (!maxFee) return { chainId: chain.id, status: 'failed', error: 'No gas price' }

    const reserve = TRANSFER_GAS * maxFee * FEE_HEADROOM
    if (balance <= reserve) return { chainId: chain.id, status: 'dust', amount: balance }

    const amount = balance - reserve
    const tx = await wallet.sendTransaction({
      to: toAddress,
      value: amount,
      gasLimit: TRANSFER_GAS,
      ...(feeData.maxFeePerGas ? { maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n } : { gasPrice: feeData.gasPrice }),
    })
    await tx.wait()
    return { chainId: chain.id, status: 'moved', amount, txHash: tx.hash }
  } catch (error) {
    return { chainId: chain.id, status: 'failed', error: error?.shortMessage || error?.message || 'Transfer failed' }
  }
}

/**
 * Runs the upgrade. Local storage is switched only after every sweep has settled, and the old key
 * is stored first, so a closed tab mid-way can never leave a key with no copy.
 *
 * @param {{masterV2Hex: string, oldPrivateKey: string, onProgress?: (result: object) => void}} params
 * @returns {Promise<{newAddress: string, results: object[]}>}
 */
export const upgradeBurnerToV2 = async ({ masterV2Hex, oldPrivateKey, onProgress }) => {
  const oldWallet = new ethers.Wallet(oldPrivateKey)
  const newKey = deriveKeyFromMasterV2(masterV2Hex, KEY_LABELS.inAppWallet)
  const newAddress = new ethers.Wallet(newKey).address

  // The caller opened the old key, so it is this wallet's — its writes below land in one slot
  claimLegacyBurner()
  // The old key first: from here on, whatever happens, it is recoverable under the v2 vault
  writeBurner({ legacy: await encryptData(oldPrivateKey, masterV2Hex) })

  const balances = await readLegacyBalances(oldWallet.address)
  const results = []
  // One chain at a time: each sweep is its own signature-free transaction, and doing them in
  // order keeps the progress list readable
  for (const entry of balances) {
    const result = await sweepChain(entry, oldPrivateKey, newAddress)
    results.push(result)
    onProgress?.(result)
  }

  writeBurner({ key: await encryptData(newKey, masterV2Hex), address: newAddress, version: 'v2' })
  writeUnlockedBurner(newKey)

  return { newAddress, results }
}
