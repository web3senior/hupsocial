'use client'

import { useMemo } from 'react'
import { useConnection, useReadContracts } from 'wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import appsAbi from '@/abis/HupApps.json'

/**
 * Reports whether the connected wallet can moderate the apps registry.
 *
 * ADMIN_ROLE satisfies the contract's onlyDirectModerator alongside MODERATOR_ROLE, so both are
 * checked. Passing a chainId scopes the answer to that deployment; omitting it asks whether the
 * wallet moderates *any* registry chain, which is what the directory needs to decide whether to
 * offer the hidden-apps view.
 *
 * @param {number} [chainId] Restrict the check to a single chain.
 * @returns {{canModerate: boolean, chainIds: number[], isLoading: boolean}}
 */
export function useAppsModerator(chainId) {
  const { address } = useConnection()

  const registryChains = useMemo(() => {
    const all = appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.apps)
    return chainId ? all.filter((chain) => chain.id === chainId) : all
  }, [chainId])

  const contracts = useMemo(() => {
    if (!address) return []
    return registryChains.flatMap((chain) => {
      const base = { abi: appsAbi, address: CONTRACTS[`chain${chain.id}`].apps, chainId: chain.id }
      return [
        { ...base, functionName: 'MODERATOR_ROLE' },
        { ...base, functionName: 'ADMIN_ROLE' },
      ]
    })
  }, [address, registryChains])

  const { data: roles } = useReadContracts({ contracts, query: { enabled: contracts.length > 0 } })

  // Second pass: the role ids have to be read before hasRole can be asked
  const roleChecks = useMemo(() => {
    if (!address || !roles) return []
    return registryChains.flatMap((chain, index) => {
      const moderatorRole = roles[index * 2]?.result
      const adminRole = roles[index * 2 + 1]?.result
      const base = { abi: appsAbi, address: CONTRACTS[`chain${chain.id}`].apps, chainId: chain.id, functionName: 'hasRole' }
      return [moderatorRole, adminRole].filter(Boolean).map((role) => ({ ...base, args: [role, address] }))
    })
  }, [address, roles, registryChains])

  const { data: held, isLoading } = useReadContracts({ contracts: roleChecks, query: { enabled: roleChecks.length > 0 } })

  const chainIds = useMemo(() => {
    if (!held) return []
    const allowed = new Set()
    // Two checks per chain, in the same order roleChecks was built
    roleChecks.forEach((check, index) => {
      if (held[index]?.result === true) allowed.add(check.chainId)
    })
    return [...allowed]
  }, [held, roleChecks])

  return { canModerate: chainIds.length > 0, chainIds, isLoading: Boolean(roleChecks.length) && isLoading }
}
