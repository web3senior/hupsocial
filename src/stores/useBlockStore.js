'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { isWalletAddress, normalizeAddress } from '@/lib/address'

export const useBlockStore = create(persist((set) => ({
  blockedByWallet: {},
  setBlocked: (viewer, target, blocked) => {
    const owner = normalizeAddress(viewer)
    const author = normalizeAddress(target)
    if (!isWalletAddress(owner) || !isWalletAddress(author) || owner === author) return
    set((state) => {
      const addresses = new Set(state.blockedByWallet[owner] || [])
      if (blocked) addresses.add(author)
      else addresses.delete(author)
      return { blockedByWallet: { ...state.blockedByWallet, [owner]: [...addresses] } }
    })
  },
}), {
  name: `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''}blocked-users`,
  storage: createJSONStorage(() => localStorage),
  skipHydration: true,
  partialize: (state) => ({ blockedByWallet: state.blockedByWallet }),
}))
