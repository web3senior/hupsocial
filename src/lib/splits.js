/**
 * @file lib/splits.js
 * @description Client helpers for HupSplits: turning typed payee rows into the factory's table, validating it, and predicting the split's address.
 */

import { isAddress } from 'viem'

/** Mirrors HupSplitter's TOTAL_SHARES_BPS: a split's shares must total exactly 100%. */
export const SPLIT_TOTAL_BPS = 10_000

/** Mirrors HupSplitter's MAX_PAYEES. */
export const MAX_SPLIT_PAYEES = 20

/**
 * Turns editor rows into the factory's `Payee[]`, dropping blanks. Rows keep percentages because
 * that is what the creator types; the contract counts basis points.
 */
export const toSplitPayees = (rows) =>
  (rows ?? [])
    .filter((row) => isAddress(String(row.address ?? '').trim()) && Number(row.percent) > 0)
    .map((row) => ({ account: String(row.address).trim(), shareBps: Math.round(Number(row.percent) * 100) }))

/** Whether a table is one the factory will accept: 1..MAX payees, distinct, totalling exactly 100%. */
export const isValidSplit = (payees) => {
  if (!payees?.length || payees.length > MAX_SPLIT_PAYEES) return false

  const accounts = new Set(payees.map((payee) => payee.account.toLowerCase()))
  if (accounts.size !== payees.length) return false
  if (payees.some((payee) => !(payee.shareBps > 0))) return false

  return payees.reduce((total, payee) => total + payee.shareBps, 0) === SPLIT_TOTAL_BPS
}

/**
 * The address a table splits to, read from the chain's HupSplits factory. Deterministic and
 * answered whether or not the split exists yet, which is how a royalty receiver — or a launch's
 * fee recipient — can be named in the same transaction that deploys it.
 */
export const predictSplitAddress = async ({ publicClient, factory, payees }) =>
  publicClient.readContract({
    address: factory,
    abi: [
      {
        name: 'predict',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ type: 'tuple[]', components: [{ name: 'account', type: 'address' }, { name: 'shareBps', type: 'uint16' }] }],
        outputs: [{ type: 'address' }],
      },
    ],
    functionName: 'predict',
    args: [payees],
  })
