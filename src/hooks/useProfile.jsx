'use client'

import useSWR from 'swr'
import { getProfile, getUniversalProfile } from '@/lib/api'

const DEFAULT_USERNAME = 'new-user'
const DEFAULT_PFP = `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`

/**
 * Shared fetcher logic that queries LUKSO Universal Profiles first,
 * falling back to the local database configuration.
 */
const profileFetcher = async (address) => {
  if (!address) return null

  try {
    // Attempt Universal Profile (LUKSO) mapping first
    const res = await getUniversalProfile(address)

    if (res?.Profile?.[0]?.isContract) {
      const p = res.Profile[0]
      return {
        ...res.Profile[0],
        wallet: p.id,
        name: p.name || DEFAULT_USERNAME,
        profileImage: p.profileImages?.[0]?.src || DEFAULT_PFP,
      }
    }

    // Fallback to local database mapping
    const localRes = await getProfile(address)
    if (localRes?.wallet_address) {
      return {
        ...localRes,
        wallet: localRes.wallet_address,
        name: localRes.name || DEFAULT_USERNAME,
        profileImage: localRes.profileImage || DEFAULT_PFP,
      }
    }
  } catch (e) {
    console.error('Profile fetch pipeline error:', e)
  }

  return { wallet: address, name: DEFAULT_USERNAME, profileImage: DEFAULT_PFP }
}

/**
 * Custom hook to fetch profile data by wallet address.
 * Integrates SWR for state caching across components.
 */
export function useProfile(address) {
  const { data, error, isLoading, mutate } = useSWR(address ? `profile-${address}` : null, () => profileFetcher(address), {
    revalidateOnFocus: false,
  })

  return {
    profile: data,
    isLoading,
    isError: error,
    mutate,
  }
}
