'use client'

// NFT holdings for the profile Assets tab. Mounted alongside useWalletAssets, but kept a
// separate hook and a separate fetch: NFTs have no USD price, so they can't join the token
// rows or the portfolio total, and a slow gallery shouldn't hold up the balances.

import useSWR from 'swr'
import { appChains } from '@/config/contracts'
import { normalizeAddress } from '@/lib/walletAssets'
import { fetchLuksoNfts, supportsNftScan } from '@/lib/walletNfts'

const scannableChains = appChains.filter((chain) => supportsNftScan(chain.id))

const fetchAll = async (owner) => {
  const settled = await Promise.allSettled(scannableChains.map((chain) => fetchLuksoNfts(chain.id, owner)))
  return settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
}

/**
 * Every NFT the wallet holds on the chains that can be enumerated.
 * @param {string} owner
 */
export function useWalletNfts(owner) {
  const holder = normalizeAddress(owner)

  const { data, error, isLoading, mutate } = useSWR(holder ? ['wallet-nfts', holder] : null, () => fetchAll(holder), {
    revalidateOnFocus: false,
    // Artwork doesn't move the way balances do — a slower beat is plenty
    refreshInterval: 300_000,
    keepPreviousData: true,
  })

  return {
    nfts: data ?? [],
    isLoading: isLoading && Boolean(holder),
    isError: Boolean(error),
    refresh: mutate,
  }
}

export default useWalletNfts
