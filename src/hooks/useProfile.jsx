'use client'

import useSWR from 'swr'
import { getProfile } from '@/lib/api'

const DEFAULT_USERNAME = 'new-user'
const DEFAULT_PFP = `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`

/**
 * Shared fetcher logic that queries LUKSO Universal Profiles first,
 * falling back to the local database configuration.
 */
export const profileFetcher = async (address) => {
  if (!address) return null

  try {
    // Attempt Universal Profile (LUKSO) mapping first
    const rawProfile = await getProfile(address)
    const profile = rawProfile?.data ? rawProfile?.data : null
    // console.log('Fetched profile data from LUKSO endpoint:', profile)

    if (profile) {
      return {
        ...profile,
        name: profile.name || DEFAULT_USERNAME,
        profileImage: profile.profileImage || DEFAULT_PFP,
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
