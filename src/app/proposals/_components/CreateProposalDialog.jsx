'use client'

import { forwardRef, useImperativeHandle, useState } from 'react'
import { useReadContracts } from 'wagmi'
import governanceAbi from '@/abis/HupCommunityGovernance.json'
import { toast } from '@/components/NextToast'
import useCommunityGovernance from './useCommunityGovernance'
import CommunityVotingDialogs from './CommunityVotingDialogs'

/**
 * Create proposal
 * The community's own "New proposal" form, opened from the composer so a member writing in a
 * community starts a vote in place instead of creating it elsewhere and pasting its link back.
 * The created proposal is handed back as the reference posts embed: { chainId, communityId, proposalId }.
 * Rendered inside the composer's dialog; CommunityVotingDialogs stops its close/cancel events.
 * @param {Object} props
 * @param {number} props.chainId The community's chain.
 * @param {string|number} props.communityId
 * @param {Function} props.onCreated Called with { chainId, communityId, proposalId }.
 */
const CreateProposalDialog = forwardRef(function CreateProposalDialog({ chainId, communityId, onCreated }, ref) {
  const writer = useCommunityGovernance(chainId)
  const [isOpen, setIsOpen] = useState(false)
  // The form seeds its duration limits from the rules, so they are read up front — the composer
  // only mounts this inside a community, where the member is likely to use it
  const { data, isLoading } = useReadContracts({
    contracts: [{ address: writer.address, abi: governanceAbi, functionName: 'getRules', args: [BigInt(communityId)], chainId }],
    query: { enabled: Boolean(writer.address) },
  })
  const rules = data?.[0]?.status === 'success' ? data[0].result : null

  useImperativeHandle(ref, () => ({
    open: () => {
      if (!writer.address) return toast('Community voting is not deployed on this network yet', 'error')
      if (!rules) return toast(isLoading ? 'Loading this community’s voting rules — try again in a moment' : 'Could not load this community’s voting rules', 'error')
      setIsOpen(true)
    },
  }))

  if (!isOpen || !rules) return null

  return (
    <CommunityVotingDialogs
      kind="propose"
      chainId={chainId}
      communityId={communityId}
      rules={rules}
      writer={writer}
      onExited={() => setIsOpen(false)}
      onDone={(proposalId) => proposalId && onCreated?.({ chainId, communityId: String(communityId), proposalId })}
    />
  )
})

export default CreateProposalDialog
