'use client'

// The connected wallet's premium standing and the cross-chain price table, from
// /api/v1/premium. One request serves both because the pricing page needs them together and
// the perk gates need only the first — SWR dedupes the two callers onto one fetch.

import useSWR from 'swr'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { NATIVE_TOKEN, PLAN_MONTHLY, PLAN_YEARLY } from '@/lib/premium'

const ENDPOINT = '/api/v1/premium'

const fetchPremium = async (address) => {
  const url = address ? `${ENDPOINT}?address=${encodeURIComponent(address)}` : ENDPOINT
  const response = await fetch(url)
  if (!response.ok) return null

  const body = await response.json()
  return body?.data ?? null
}

/**
 * @param {string|null} [addressOverride] A wallet other than the connected one, for viewing
 *   someone else's standing. Omit for "me".
 */
export function usePremium(addressOverride) {
  const { address: connected } = useActiveWallet()
  const address = addressOverride ?? connected ?? null

  const { data, isLoading, mutate } = useSWR(['premium', address ?? 'anon'], () => fetchPremium(address), {
    revalidateOnFocus: false,
    // A subscription changes on the minute scale at most, and only by the viewer's own hand —
    // the checkout refreshes this directly rather than waiting for a poll.
    refreshInterval: 0,
    keepPreviousData: true,
  })

  const status = data?.status ?? null

  return {
    /** False while loading, so a gate never flashes a perk the wallet has not paid for. */
    isPremium: Boolean(status?.premium),
    expiresAt: status?.expiresAt ?? null,
    /** Premium given by a moderator, with no expiry — the panel says so instead of a date. */
    complimentary: Boolean(status?.complimentary),
    chains: status?.chains ?? [],
    plans: data?.plans ?? [],
    /** Every token a plan can be paid in, with the symbol and decimals cidex read off it. */
    tokens: data?.tokens ?? [],
    prices: data?.prices ?? {},
    purchases: data?.purchases ?? [],
    /** A current subscriber with a handle, for "get Premium like @…" copy. Null when none. */
    spotlight: data?.spotlight ?? null,
    /** False when no chain in this build has a HupPremium deployed yet. */
    live: Boolean(data?.live),
    isLoading,
    refresh: mutate,
  }
}

/**
 * The tokens one plan takes on one chain, native first. The native entry is synthesised rather
 * than stored: the contract keeps the native price on the Plan itself, so there is no token row
 * for it and never should be.
 * @param {object[]} tokens The flat token-price table.
 * @param {number|string} networkId
 * @param {number} planId
 * @param {object|null} plan The chain's plan row, for the native price.
 * @param {object|null} chain The resolved chain, for the native symbol.
 */
export const paymentOptionsFor = (tokens, networkId, planId, plan, chain) => {
  // A chain can sell in tokens only; the coin then never reaches the picker.
  const native =
    plan && plan.nativeOffered !== false
      ? [
        {
          token: NATIVE_TOKEN,
          price: plan.priceWei,
          symbol: chain?.nativeCurrency?.symbol ?? '',
          decimals: chain?.nativeCurrency?.decimals ?? 18,
          standard: 0,
          isNative: true,
        },
      ]
    : []

  const priced = (tokens ?? [])
    .filter((entry) => String(entry.networkId) === String(networkId) && entry.planId === planId)
    // A token whose decimals cidex could not read cannot be quoted, and quoting it wrong is
    // worse than not offering it.
    .filter((entry) => entry.decimals !== null && entry.decimals !== undefined)
    .map((entry) => ({ ...entry, isNative: false }))

  return [...native, ...priced]
}

/**
 * The monthly and yearly rows for one chain, out of the flat plan table.
 * @param {object[]} plans
 * @param {number|string} networkId
 */
export const plansForChain = (plans, networkId) => {
  const rows = (plans ?? []).filter((plan) => String(plan.networkId) === String(networkId) && plan.enabled)

  return {
    monthly: rows.find((plan) => plan.planId === PLAN_MONTHLY) ?? null,
    yearly: rows.find((plan) => plan.planId === PLAN_YEARLY) ?? null,
  }
}

export default usePremium
