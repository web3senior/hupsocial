'use client'

import { useCallback, useMemo, useState } from 'react'
import { useSignMessage } from 'wagmi'
import useSWR from 'swr'
import bs58 from 'bs58'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { useSolanaWallet } from '@/hooks/useSolanaWallet'
import { requestAuthNonce } from '@/lib/api'
import { blockUserMessage } from '@/lib/blockUsers'
import { normalizeAddress, sameAddress } from '@/lib/address'
import { toast } from '@/components/NextToast'
import { useFeedCacheStore } from '@/stores/useFeedCacheStore'
import { usePostStore } from '@/stores/usePostStore'

const pendingWallets = new Set()
const fetchBlocks = async (url) => {
  const response = await fetch(url, { cache: 'no-store' })
  const body = await response.json()
  if (!response.ok || !body.success) throw new Error(body.error || 'Could not load blocked users')
  return body.data
}

export function useBlockedUsers() {
  const { address, kind, chain } = useActiveWallet()
  const { signMessageAsync } = useSignMessage()
  const solanaWallet = useSolanaWallet()
  const owner = normalizeAddress(address)
  const [isSaving, setIsSaving] = useState(false)
  const { data, error, isLoading, mutate } = useSWR(owner ? `/api/v1/users/blocks?address=${encodeURIComponent(owner)}` : null, fetchBlocks, {
    refreshInterval: 60_000,
    dedupingInterval: 5_000,
  })
  const blocked = useMemo(() => new Set(data || []), [data])
  const isBlocked = useCallback((target) => blocked.has(normalizeAddress(target)), [blocked])

  const toggleBlock = useCallback(async (target) => {
    if (!owner || sameAddress(owner, target) || pendingWallets.has(owner)) return
    pendingWallets.add(owner)
    setIsSaving(true)
    try {
      if (!data || error) throw new Error('Wait for your blocked users to load, then try again')
      const nonce = await requestAuthNonce(owner)
      if (!nonce) throw new Error('Could not start wallet verification')
      const claim = { address: owner, target: normalizeAddress(target), blocked: !isBlocked(target), nonce, issuedAt: Date.now(), chainId: chain?.id }
      const message = blockUserMessage(claim)
      let signature
      if (kind === 'solana') {
        const signer = solanaWallet.getSigner()
        const feature = signer?.wallet.features?.['solana:signMessage']
        if (!feature) throw new Error('This wallet does not support message signing')
        if (!sameAddress(signer.account.address, owner)) throw new Error('Wallet changed; please try again')
        const [signed] = await feature.signMessage({ account: signer.account, message: new TextEncoder().encode(message) })
        signature = bs58.encode(signed.signature)
      } else {
        signature = await signMessageAsync({ account: owner, message })
      }
      const response = await fetch('/api/v1/users/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...claim, signature }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not save blocked users')
      await mutate((current = []) => claim.blocked ? [...new Set([...current, claim.target])] : current.filter((value) => value !== claim.target), { revalidate: false })
      useFeedCacheStore.setState({ caches: {} })
      usePostStore.getState().requestFeedRefresh()
      toast(claim.blocked ? 'User blocked' : 'User unblocked', 'success')
    } catch (failure) {
      toast(failure.shortMessage || failure.message || 'Could not save blocked users', 'error')
    } finally {
      pendingWallets.delete(owner)
      setIsSaving(false)
    }
  }, [owner, data, error, isBlocked, chain, kind, solanaWallet, signMessageAsync, mutate])

  return { address, isBlocked, toggleBlock, isSaving, isLoading, error }
}
