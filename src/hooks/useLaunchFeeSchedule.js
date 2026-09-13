'use client'

/**
 * @file hooks/useLaunchFeeSchedule.js
 * @description A launch's Uniswap pool key, rebuilt from the launch itself.
 *
 * A launch pool is an ordinary hookless pool at the factory's canonical tier, so its key follows
 * from the two tokens plus two constants — which means it never has to be probed across fee tiers
 * the way an arbitrary pair does on the swap page.
 *
 * Both constants are immutable on the factory, so they are cached for the session and shared by
 * every card on the page: a table of launches on one chain pays for them exactly once.
 */

import { useMemo } from 'react'
import { useReadContract } from 'wagmi'
import { CONTRACTS } from '@/config/contracts'
import { V4_NATIVE, launchPoolKey } from '@/lib/uniswap-v4'
import launchAbi from '@/abis/HupLaunch.json'

const FOREVER = { staleTime: Infinity, gcTime: Infinity }

// What the factory charges today. Read onchain anyway — this is only the value used before the
// reads land, so a redeployed factory on a different tier corrects itself rather than quoting
// against a pool that does not exist.
const DEFAULT_LAUNCH_FEE = 10_000
const DEFAULT_TICK_SPACING = 200

/**
 * @param {Object} launch An indexed launch row, or the onchain fallback shaped like one.
 * @param {number|null|undefined} chainId The chain the launch lives on.
 * @returns {{poolKey: Object|null, quoteAddress: string, buyIsZeroForOne: boolean}}
 *   `buyIsZeroForOne` is the swap direction that spends the quote asset.
 */
export function useLaunchPoolKey(launch, chainId) {
  const launchAddress = CONTRACTS[`chain${chainId}`]?.launch
  const token = launch?.token
  const quoteAddress = launch?.quote ?? V4_NATIVE

  const { data: fee } = useReadContract({
    abi: launchAbi,
    address: launchAddress,
    functionName: 'LAUNCH_FEE',
    chainId,
    query: { ...FOREVER, enabled: Boolean(launchAddress) },
  })
  const { data: tickSpacing } = useReadContract({
    abi: launchAbi,
    address: launchAddress,
    functionName: 'TICK_SPACING',
    chainId,
    query: { ...FOREVER, enabled: Boolean(launchAddress) },
  })

  const poolKey = useMemo(
    () =>
      token
        ? launchPoolKey({
            token,
            quote: quoteAddress,
            fee: fee ?? DEFAULT_LAUNCH_FEE,
            tickSpacing: tickSpacing ?? DEFAULT_TICK_SPACING,
          })
        : null,
    [token, quoteAddress, fee, tickSpacing],
  )

  // Spending the quote asset buys the token; which side that is depends on how the two sorted
  const buyIsZeroForOne = Boolean(
    poolKey && String(poolKey.currency0).toLowerCase() === String(quoteAddress).toLowerCase(),
  )

  return { poolKey, quoteAddress, buyIsZeroForOne }
}

export default useLaunchPoolKey
