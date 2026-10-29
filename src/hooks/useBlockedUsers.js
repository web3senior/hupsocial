'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { normalizeAddress } from '@/lib/address'
import { useBlockStore } from '@/stores/useBlockStore'

export function useBlockedUsers() {
  const { address } = useActiveWallet()
  const blockedByWallet = useBlockStore((state) => state.blockedByWallet)
  const setBlocked = useBlockStore((state) => state.setBlocked)

  useEffect(() => {
    if (!useBlockStore.persist.hasHydrated()) useBlockStore.persist.rehydrate()
  }, [])

  const blocked = useMemo(() => new Set(blockedByWallet[normalizeAddress(address)] || []), [blockedByWallet, address])
  const isBlocked = useCallback((target) => blocked.has(normalizeAddress(target)), [blocked])
  const toggleBlock = useCallback((target) => {
    setBlocked(address, target, !isBlocked(target))
  }, [address, isBlocked, setBlocked])

  return { address, isBlocked, toggleBlock }
}
