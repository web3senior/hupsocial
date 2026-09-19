'use client'

import { useProfile } from '@/hooks/useProfile'
import { profilePath } from '@/lib/username'

/**
 * The canonical page for a wallet — `/@alice` once it has claimed a handle, `/0xabc…` until then.
 *
 * For call sites that link to a profile without already holding one. Where a component has the
 * profile in hand, call `profilePath(address, profile?.username)` instead rather than resolving it
 * twice. The read itself is free either way: it is the same SWR key every avatar on the page
 * already shares.
 *
 * @param {string|null|undefined} address The wallet to link to.
 * @returns {string} A path, or '#' when there is no wallet to link to.
 */
export function useProfilePath(address) {
  const { profile } = useProfile(address || null)
  if (!address) return '#'

  return profilePath(address, profile?.username)
}

export default useProfilePath
