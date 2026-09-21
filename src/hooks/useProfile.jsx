'use client'

import useSWR from 'swr'
import { getProfile } from '@/lib/api'
import { isEvmAddress } from '@/lib/address'
import { AVATAR_MAX_SIZE, resolveAvatarImageUrl, resolveIPFSImageUrl } from '@/lib/storageHelper'

const DEFAULT_USERNAME = 'new-user'
const DEFAULT_PFP = resolveIPFSImageUrl(process.env.NEXT_PUBLIC_DEFAULT_PFP_CID, { width: 512 })

/**
 * The identity a post row already carries about its author, shaped like a fetched profile so it
 * can stand in for one until the real thing arrives. Nothing when the row has no name to show —
 * an author the users table has not seen, or a cached EOA with none — so those keep the shimmer.
 * The picture goes through the same avatar rung the profile API resolves to, and the handle
 * comes along when the row selected it, so the name line does not change once the fetch lands.
 * @param {Object} row A post row with wallet_address, display_name, profile_image and, when the
 *   query selected it, username.
 * @returns {Object|undefined}
 */
export const profileFallbackFromRow = (row) => {
  if (!row?.wallet_address || typeof row.display_name !== 'string' || row.display_name.trim() === '') return undefined
  return {
    // Lowercased like the profile API emits it: the byline's address tag is sliced from this
    // verbatim, and a checksummed row would flip its case when the profile lands
    wallet_address: isEvmAddress(row.wallet_address) ? row.wallet_address.toLowerCase() : row.wallet_address,
    name: row.display_name,
    username: row.username || null,
    profileImage: row.profile_image ? resolveAvatarImageUrl(row.profile_image, AVATAR_MAX_SIZE) : DEFAULT_PFP,
  }
}

/**
 * Shared fetcher logic that queries LUKSO Universal Profiles first,
 * falling back to the local database configuration.
 * @param {string} address
 * @param {Object} [fallback] The identity already on screen for this address. A failed or empty
 *   fetch hands it back rather than the anonymous default, so a hiccup cannot rename a byline
 *   that was painted from the post row — SWR caches whatever resolves here, over the fallback.
 */
export const profileFetcher = async (address, fallback) => {
  if (!address) return null

  try {
    // Attempt Universal Profile (LUKSO) mapping first
    const rawProfile = await getProfile(address)
    const profile = rawProfile?.data ? rawProfile?.data : null
    // console.log('Fetched profile data from LUKSO endpoint:', profile)

    if (profile) {
      return {
        ...profile,
        source: rawProfile.source,
        name: profile.name || DEFAULT_USERNAME,
        profileImage: profile.profileImage || DEFAULT_PFP,
      }
    }
  } catch (e) {
    console.error('Profile fetch pipeline error:', e)
  }

  if (fallback) return fallback

  // Keyed as `wallet_address` to match both the UP and database shapes — consumers
  // read that field, so a differently-named key here reads as a missing address.
  return { wallet_address: address, name: DEFAULT_USERNAME, profileImage: DEFAULT_PFP }
}

/**
 * Custom hook to fetch profile data by wallet address.
 * Integrates SWR for state caching across components.
 * @param {string} address
 * @param {Object} [fallback] What to hand back before the fetch answers (profileFallbackFromRow);
 *   the fetch still runs and replaces it.
 */
export function useProfile(address, fallback) {
  const { data, error, isLoading, mutate } = useSWR(address ? `profile-${address}` : null, () => profileFetcher(address, fallback), {
    revalidateOnFocus: false,
    fallbackData: fallback,
  })

  return {
    profile: data,
    isLoading,
    isError: error,
    mutate,
  }
}
