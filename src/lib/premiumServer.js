/**
 * @file lib/premiumServer.js
 * @description Server-only reads for Hup Premium. Every render path asks the same question —
 * does this wallet hold premium right now — so it is answered from the indexed tables and
 * never from a chain read. A mark beside a name in a feed is fifty of these per page; fifty
 * RPC calls is not a thing that can happen.
 *
 * Reads are pinned to the deployments this build talks to, exactly as the community badge is
 * (lib/communityJoin.js): a retired HupPremium's rows must not keep someone subscribed after
 * the app has moved to a new one.
 *
 * Premium is cross-chain on purpose. It is bought on one chain and held everywhere, so the
 * answer is the furthest expiry across every pinned deployment, not a per-chain fact.
 */

import pool from '@/lib/db'
import { CONTRACTS, appChains } from '@/config/contracts'
import { PLAN_IDS } from '@/lib/premium'

/** The (networkId, address) pairs this build sells premium on, lowercased to match the rows. */
export const premiumDeployments = () =>
  appChains
    .map((chain) => ({ networkId: chain.id, address: CONTRACTS[`chain${chain.id}`]?.premium ?? '' }))
    .filter((entry) => typeof entry.address === 'string' && entry.address.startsWith('0x'))
    .map((entry) => ({ ...entry, address: entry.address.toLowerCase() }))

/** Whether any chain in this build has a HupPremium to sell. */
export const premiumIsLive = () => premiumDeployments().length > 0

/** `(network_id = ? AND contract_address = ?) OR (...)` plus its params, or null when none. */
const deploymentPin = (deployments) => {
  if (deployments.length === 0) return null

  return {
    sql: `(${deployments.map(() => '(network_id = ? AND contract_address = ?)').join(' OR ')})`,
    params: deployments.flatMap((entry) => [entry.networkId, entry.address]),
  }
}

/**
 * The wire shape, in one place, so the badge, the page and the profile route agree.
 *
 * Premium is true when EITHER the term is live OR the account is on a complimentary list. A
 * version of this that checked only the expiry would drop every comped account silently, which
 * is the one bug this shape exists to prevent.
 */
const toStatus = (rows) => {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const chains = rows.map((row) => ({
    networkId: Number(row.network_id),
    expiresAt: Number(row.expires_at),
    planId: Number(row.last_plan_id),
    complimentary: Boolean(row.complimentary),
    active: Boolean(row.complimentary) || Number(row.expires_at) > nowSeconds,
  }))

  const expiresAt = chains.reduce((furthest, chain) => Math.max(furthest, chain.expiresAt), 0)
  const comped = chains.some((chain) => chain.complimentary)

  return {
    premium: comped || expiresAt > nowSeconds,
    /* Null for a comp, which has no expiry — the panel says "complimentary" rather than
       printing a date that does not exist. */
    expiresAt: expiresAt > nowSeconds ? expiresAt : (expiresAt || null),
    complimentary: comped,
    // Which chain to renew on, and where a lapsed subscription last lived.
    chains: chains.sort((a, b) => Number(b.complimentary) - Number(a.complimentary) || b.expiresAt - a.expiresAt),
  }
}

const NOT_PREMIUM = { premium: false, expiresAt: null, complimentary: false, chains: [] }

/**
 * One wallet's premium standing.
 * @param {string|null} address
 * @returns {Promise<{premium: boolean, expiresAt: number|null, chains: object[]}>}
 */
export const readPremium = async (address) => {
  const wallet = typeof address === 'string' ? address.toLowerCase() : ''
  if (!wallet.startsWith('0x')) return NOT_PREMIUM

  const pin = deploymentPin(premiumDeployments())
  if (!pin) return NOT_PREMIUM

  try {
    const [rows] = await pool.execute(
      `SELECT network_id, expires_at, last_plan_id, complimentary
         FROM premium_subscriptions
        WHERE account = ? AND ${pin.sql}`,
      [wallet, ...pin.params],
    )

    return toStatus(rows)
  } catch (error) {
    /* A database that has never run add-premium.sql has no table, and a missing badge is a
       better outcome than a 500 on every profile read. */
    console.warn('[premium] status read failed:', error.message)
    return NOT_PREMIUM
  }
}

/**
 * The same question for a page of wallets, in one round trip — for feeds and follower lists,
 * where asking per row is the thing that makes a list slow.
 * @param {string[]} addresses
 * @returns {Promise<Map<string, boolean>>} Lowercased address to whether it holds premium.
 */
export const readPremiumMany = async (addresses) => {
  const wallets = [...new Set((addresses ?? []).filter((value) => typeof value === 'string').map((value) => value.toLowerCase()))].filter(
    (value) => value.startsWith('0x'),
  )
  if (wallets.length === 0) return new Map()

  const pin = deploymentPin(premiumDeployments())
  if (!pin) return new Map()

  try {
    const [rows] = await pool.query(
      `SELECT account, MAX(expires_at) AS expires_at, MAX(complimentary) AS complimentary
         FROM premium_subscriptions
        WHERE account IN (?) AND ${pin.sql}
        GROUP BY account`,
      [wallets, ...pin.params],
    )

    const nowSeconds = Math.floor(Date.now() / 1000)
    return new Map(rows.map((row) => [row.account, Boolean(Number(row.complimentary)) || Number(row.expires_at) > nowSeconds]))
  } catch (error) {
    console.warn('[premium] batch status read failed:', error.message)
    return new Map()
  }
}

/**
 * The price table across every chain premium is sold on, as cidex indexed it from the
 * contracts' own PlanUpdated logs. One query rather than one RPC call per chain.
 * @returns {Promise<object[]>}
 */
export const readPlans = async () => {
  const pin = deploymentPin(premiumDeployments())
  if (!pin) return []

  try {
    const [rows] = await pool.query(
      `SELECT network_id, contract_address, plan_id, duration, price_wei, enabled
         FROM premium_plans
        WHERE ${pin.sql} AND plan_id IN (?)
        ORDER BY network_id, plan_id`,
      [...pin.params, PLAN_IDS],
    )

    return rows.map((row) => ({
      networkId: Number(row.network_id),
      contractAddress: row.contract_address,
      planId: Number(row.plan_id),
      duration: Number(row.duration),
      priceWei: String(row.price_wei),
      enabled: Boolean(row.enabled),
    }))
  } catch (error) {
    console.warn('[premium] plan read failed:', error.message)
    return []
  }
}

/**
 * Every token a plan can be paid in, across the chains premium is sold on, as cidex indexed it
 * from the contracts' own TokenPriceUpdated logs. `symbol` and `decimals` ride along because
 * cidex read them off each token once — a client must never guess a token's scale, since being
 * wrong by six decimals is the difference between $6 and $6,000,000.
 * @returns {Promise<object[]>}
 */
export const readTokenPrices = async () => {
  const pin = deploymentPin(premiumDeployments())
  if (!pin) return []

  try {
    const [rows] = await pool.query(
      `SELECT network_id, contract_address, plan_id, token, price, enabled, standard, symbol, decimals
         FROM premium_token_prices
        WHERE ${pin.sql} AND plan_id IN (?) AND enabled = 1
        ORDER BY network_id, plan_id, token`,
      [...pin.params, PLAN_IDS],
    )

    return rows.map((row) => ({
      networkId: Number(row.network_id),
      planId: Number(row.plan_id),
      token: row.token,
      price: String(row.price),
      standard: Number(row.standard),
      symbol: row.symbol ?? null,
      /* Null rather than a guessed 18: a caller that cannot scale the amount must say so
         rather than print a figure that is wrong by orders of magnitude. */
      decimals: row.decimals === null || row.decimals === undefined ? null : Number(row.decimals),
    }))
  } catch (error) {
    /* A database that has not run add-premium-tokens.sql simply sells no tokens yet. */
    console.warn('[premium] token price read failed:', error.message)
    return []
  }
}

/**
 * One wallet's purchase history across the pinned deployments, newest first — what the
 * "manage" panel lists under the current term.
 * @param {string|null} address
 * @param {number} limit
 */
export const readPurchases = async (address, limit = 20) => {
  const wallet = typeof address === 'string' ? address.toLowerCase() : ''
  if (!wallet.startsWith('0x')) return []

  const pin = deploymentPin(premiumDeployments())
  if (!pin) return []

  /* The join needs table-qualified columns, and the pin was built unqualified for the single-
     table reads above. Aliasing it here beats a second builder that could drift from the first. */
  const pinned = pin.sql.replace(/network_id/g, 'p.network_id').replace(/contract_address/g, 'p.contract_address')

  try {
    const [rows] = await pool.execute(
      `SELECT p.network_id, p.account, p.payer, p.plan_id, p.token, p.paid_wei, p.expires_at, p.kind,
              p.tx_hash, p.purchased_at, t.symbol AS token_symbol, t.decimals AS token_decimals
         FROM premium_purchases p
         LEFT JOIN premium_token_prices t
                ON t.network_id = p.network_id
               AND t.contract_address = p.contract_address
               AND t.plan_id = p.plan_id
               AND t.token = p.token
        WHERE p.account = ? AND ${pinned}
        ORDER BY p.block_number DESC
        LIMIT ${Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 20}`,
      [wallet, ...pin.params],
    )

    return rows.map((row) => ({
      networkId: Number(row.network_id),
      payer: row.payer,
      // A gift, when someone else paid for it — the panel says who.
      gifted: row.kind === 'purchase' && row.payer !== row.account,
      planId: Number(row.plan_id),
      // Null for a row written before 1.1.0, which could only ever have been a native purchase.
      token: row.token ?? null,
      // Absent for a native purchase; the caller then falls back to the chain's own coin.
      tokenSymbol: row.token_symbol ?? null,
      tokenDecimals: row.token_decimals === null || row.token_decimals === undefined ? null : Number(row.token_decimals),
      paidWei: String(row.paid_wei),
      expiresAt: Number(row.expires_at),
      kind: row.kind,
      txHash: row.tx_hash,
      purchasedAt: Number(row.purchased_at),
    }))
  } catch (error) {
    console.warn('[premium] purchase read failed:', error.message)
    return []
  }
}
