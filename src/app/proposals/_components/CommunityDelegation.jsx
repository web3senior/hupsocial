'use client'

import { useRef, useState } from 'react'
import { useReadContracts } from 'wagmi'
import { isAddress, zeroAddress } from 'viem'
import clsx from 'clsx'
import { CONTRACTS } from '@/config/contracts'
import { sameAddress, shortAddress } from '@/lib/communityProposal'
import governanceAbi from '@/abis/HupCommunityGovernance.json'
import communityAbi from '@/abis/HupCommunity.json'
import NativeDialog from '@/components/ui/NativeDialog'
import { Spinner } from '@/components/Loading'
import useCommunityGovernance from './useCommunityGovernance'
import styles from './CommunityGovernance.module.scss'
import dialogStyles from './CommunityDialog.module.scss'

const PAGE_SIZE = 50
const memberEligible = (value) => Boolean(value?.[0]) && !value?.[3]

export default function CommunityDelegation({ chainId, communityId }) {
  const writer = useCommunityGovernance(chainId)
  const dialog = useRef(null)
  const [target, setTarget] = useState('')
  const id = BigInt(communityId)
  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { address: writer.address, abi: governanceAbi, functionName: 'delegationVersion', chainId },
      { address: writer.address, abi: governanceAbi, functionName: 'delegates', args: [id, writer.account || zeroAddress], chainId },
      { address: CONTRACTS[`chain${chainId}`]?.community, abi: communityAbi, functionName: 'registry', args: [id, writer.account || zeroAddress], chainId },
      { address: writer.address, abi: governanceAbi, functionName: 'community', chainId },
    ],
    query: { enabled: Boolean(writer.address), refetchInterval: 10000 },
  })
  const supported = data?.[0]?.status === 'success' && data[0].result === 1n && data?.[3]?.status === 'success' && sameAddress(data[3].result, CONTRACTS[`chain${chainId}`]?.community)
  const delegatee = data?.[1]?.status === 'success' ? data[1].result : zeroAddress
  const delegated = !sameAddress(delegatee, zeroAddress)
  const eligible = data?.[2]?.status === 'success' && memberEligible(data[2].result)

  const save = async (address) => {
    const receipt = await writer.send('delegate', { functionName: 'delegate', args: [id, address] }, sameAddress(address, zeroAddress) ? 'Delegation revoked' : 'Community vote delegated')
    if (receipt) {
      refetch()
      dialog.current?.close()
    }
  }

  return (
    <section className={styles.governance__panel} aria-label="Vote delegation">
      <h3 className={styles.governance__title}>Vote delegation</h3>
      <p className={styles.governance__muted}>Let another member cast your vote in this community. You can change or revoke delegation anytime. It applies to uncast ballots, including open proposals. Each member still gets one vote; recorded votes cannot be changed.</p>
      {!writer.address || (!isLoading && !supported) ? <p className={styles.governance__muted}>Delegation requires the updated community voting contract on this network.</p> : !writer.account ? <p className={styles.governance__muted}>Connect your wallet to delegate your vote.</p> : <>
        <p className={styles.governance__muted}>{delegated ? `${shortAddress(delegatee)} can vote for you. You can also vote directly until your ballot is recorded.` : 'You vote for yourself.'}</p>
        <div className={styles.governance__actions}>
          <button type="button" className={styles.governance__button} disabled={!supported || !eligible || Boolean(writer.busy)} onClick={() => { setTarget(delegated ? delegatee : ''); dialog.current?.open() }}>{delegated ? 'Change delegate' : 'Delegate my vote'}</button>
          {delegated && <button type="button" className={styles.governance__button} disabled={Boolean(writer.busy)} onClick={() => save(zeroAddress)}>Take my vote back</button>}
        </div>
        {!isLoading && !eligible && <p className={styles.governance__muted}>Join the community to appoint a delegate.</p>}
      </>}
      <NativeDialog ref={dialog} className={dialogStyles.communityDialog} aria-label="Delegate your community vote" lightDismiss={!writer.busy} onClose={(event) => event.stopPropagation()} onCancel={(event) => { event.stopPropagation(); if (writer.busy) event.preventDefault() }}>
        <div className={dialogStyles.communityDialog__body}>
          <header className={dialogStyles.communityDialog__header}>
            <h3>Delegate your community vote</h3>
            <button type="button" className={dialogStyles.communityDialog__close} disabled={Boolean(writer.busy)} onClick={() => dialog.current?.close()} aria-label="Close">×</button>
          </header>
          <p className={dialogStyles.communityDialog__intro}>Enter another community member’s wallet or Universal Profile address. They can cast your uncast ballots, but cannot delegate your vote to someone else.</p>
          <form className={dialogStyles.communityDialog__form} onSubmit={(event) => { event.preventDefault(); if (isAddress(target.trim())) save(target.trim()) }}>
            <label className={dialogStyles.communityDialog__field}>
              <span>Their wallet or Universal Profile address</span>
              <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" disabled={Boolean(writer.busy)} />
            </label>
            <button type="submit" className={dialogStyles.communityDialog__submit} disabled={!isAddress(target.trim()) || sameAddress(target.trim(), zeroAddress) || sameAddress(target.trim(), writer.account) || Boolean(writer.busy)}>
              {writer.busy && <Spinner size={16} color="currentColor" />}
              {writer.busy ? 'Saving…' : 'Delegate my vote'}
            </button>
          </form>
        </div>
      </NativeDialog>
    </section>
  )
}

export function CommunityDelegatedVotes({ chainId, communityId, proposalId, labels, onVoted }) {
  const writer = useCommunityGovernance(chainId)
  const [page, setPage] = useState(0)
  const [choice, setChoice] = useState(null)
  const communityAddress = CONTRACTS[`chain${chainId}`]?.community
  const { data, refetch } = useReadContracts({
    contracts: [
      { address: writer.address, abi: governanceAbi, functionName: 'getDelegators', args: [BigInt(communityId), writer.account || zeroAddress, BigInt(page * PAGE_SIZE), BigInt(PAGE_SIZE)], chainId },
      { address: communityAddress, abi: communityAbi, functionName: 'registry', args: [BigInt(communityId), writer.account || zeroAddress], chainId },
    ],
    query: { enabled: Boolean(writer.address && writer.account), refetchInterval: 10000 },
  })
  const [members, total] = data?.[0]?.status === 'success' ? data[0].result : [[], 0n]
  const { data: ballots, isLoading, isFetching, refetch: refetchBallots } = useReadContracts({
    contracts: members.flatMap((member) => [
      { address: writer.address, abi: governanceAbi, functionName: 'hasVoted', args: [BigInt(proposalId), member], chainId },
      { address: communityAddress, abi: communityAbi, functionName: 'registry', args: [BigInt(communityId), member], chainId },
      { address: writer.address, abi: governanceAbi, functionName: 'delegates', args: [BigInt(communityId), member], chainId },
    ]),
    query: { enabled: members.length > 0, refetchInterval: 10000 },
  })
  const pending = members.filter((member, index) => ballots?.[index * 3]?.status === 'success' && !ballots[index * 3].result && ballots?.[index * 3 + 1]?.status === 'success' && memberEligible(ballots[index * 3 + 1].result) && ballots?.[index * 3 + 2]?.status === 'success' && sameAddress(ballots[index * 3 + 2].result, writer.account))
  const eligible = data?.[1]?.status === 'success' && memberEligible(data[1].result)
  if (!writer.account || total === 0n) return null

  const vote = async () => {
    const receipt = await writer.send('delegated-vote', { functionName: 'castVotesFor', args: [BigInt(proposalId), pending, choice] }, 'Delegated votes recorded')
    if (receipt) {
      refetch()
      refetchBallots()
      onVoted?.()
    }
  }

  return (
    <section className={styles.governance__panel} aria-label="Votes delegated to you">
      <h3 className={styles.governance__title}>Votes delegated to you</h3>
      <p className={styles.governance__muted}>{isLoading ? 'Checking delegated ballots…' : `${pending.length} uncast member votes on this page. Your own vote is cast separately above.`}</p>
      {pending.length > 0 && <>
        <div className={styles.governance__actions} role="radiogroup" aria-label="Choose a delegated vote">
          {labels.map((label, index) => <button key={index} type="button" role="radio" aria-checked={choice === index} className={clsx(styles.governance__button, choice === index && styles['governance__button--selected'])} disabled={Boolean(writer.busy)} onClick={() => setChoice(index)}>{label}</button>)}
        </div>
        <button type="button" className={styles.governance__button} disabled={choice === null || !eligible || isFetching || Boolean(writer.busy)} onClick={vote}>{writer.busy ? <Spinner size={16} color="currentColor" /> : `Cast ${pending.length} delegated votes`}</button>
      </>}
      {!eligible && <p className={styles.governance__muted}>You must be a current community member to cast delegated votes.</p>}
      {total > BigInt(PAGE_SIZE) && <div className={styles.governance__actions}>
        <button type="button" className={styles.governance__button} disabled={page === 0 || Boolean(writer.busy)} onClick={() => setPage((value) => value - 1)}>Previous members</button>
        <span>Page {page + 1}</span>
        <button type="button" className={styles.governance__button} disabled={BigInt((page + 1) * PAGE_SIZE) >= total || Boolean(writer.busy)} onClick={() => setPage((value) => value + 1)}>Next members</button>
      </div>}
    </section>
  )
}
