'use client'

import { useReadContract } from 'wagmi'
import tradeAbi from '@/abis/HupTrade.json'
import { formatBps } from '@/lib/tradeFee'

/**
 * Live platform fee of a chain's HupTrade deployment. An admin can change the rate per
 * chain (and it starts at 0), so every surface that quotes it reads the chain rather than
 * repeating a number that would silently go stale.
 * @param {Object} params
 * @param {number} params.chainId
 * @param {string|null} params.tradeAddress HupTrade address on that chain, null where undeployed.
 * @returns {{feeBps: number|null, feePercent: string|null}} feeBps is null until the read lands.
 */
const useTradeFee = ({ chainId, tradeAddress }) => {
  const { data } = useReadContract({
    abi: tradeAbi,
    address: tradeAddress || undefined,
    functionName: 'tradeFeeBps',
    chainId,
    query: { enabled: Boolean(tradeAddress && chainId) },
  })

  const feeBps = data === undefined ? null : Number(data)

  return { feeBps, feePercent: feeBps === null ? null : formatBps(feeBps) }
}

export default useTradeFee
