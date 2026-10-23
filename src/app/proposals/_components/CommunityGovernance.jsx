'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useBalance, useReadContracts } from 'wagmi'
import { formatUnits, zeroAddress } from 'viem'
import { CONTRACTS, appChains } from '@/config/contracts'
import { communityPath, communityProposalPath, formatRulePercent, COMMUNITY_PROPOSAL_STATES } from '@/lib/communityGovernance'
import { formatRelative, sameAddress } from '@/lib/communityProposal'
import governanceAbi from '@/abis/HupCommunityGovernance.json'
import communityAbi from '@/abis/HupCommunity.json'
import { Spinner, PageLoader } from '@/components/Loading'
import { usePaymentToken } from '@/hooks/usePaymentToken'
import TokenAssetInput from '@/app/communities/_components/TokenAssetInput'
import CopyButton from '@/components/ui/CopyButton'
import { useIpfsJson } from '@/hooks/useIpfsJson'
import useCommunityGovernance from './useCommunityGovernance'
import CommunityDelegation from './CommunityDelegation'
import CommunityVotingDialogs from './CommunityVotingDialogs'
import styles from './CommunityGovernance.module.scss'

const PAGE_SIZE = 20

function CommunityProposalRow({ proposal, chainId, governanceAddress }) {
  const { data: metadata } = useIpfsJson(proposal.metadata)
  const { data } = useReadContracts({ contracts: [{ address: governanceAddress, abi: governanceAbi, functionName: 'state', args: [proposal.id], chainId }], query: { refetchInterval: 15000 } })
  const status = data?.[0]?.status === 'success' ? COMMUNITY_PROPOSAL_STATES[Number(data[0].result)] : null

  return (
    <li className={styles.governance__card}>
      <span className={styles.governance__status}>{status?.label || 'Loading status…'} · {proposal.payment.amount > 0n ? 'Treasury payment' : 'Community decision'}</span>
      <Link className={styles.governance__link} href={communityProposalPath(chainId, proposal.communityId, proposal.id)}>{metadata?.title || `Proposal #${proposal.id}`}</Link>
      <p className={styles.governance__muted}>{Number(proposal.voterCount)} votes · {status?.key === 'pending' ? `Opens ${formatRelative(proposal.voteStart)}` : `Voting ends ${formatRelative(proposal.voteEnd)}`}</p>
    </li>
  )
}

/**
 * Everything a community's governance surface reads: rules, treasury, the viewer's standing and
 * its proposals (newest first, paged). Shared by the standalone proposals page and the community
 * page, where the same proposals also flow into the feed.
 */
export function useCommunityGovernanceState(networkId, communityId) {
  const chainId = Number(networkId)
  // The community page calls this straight from its route params, before anything validated them
  const id = /^\d+$/.test(String(communityId)) ? BigInt(communityId) : 0n
  const writer = useCommunityGovernance(chainId)
  // Paging belongs to one community — the App Router reuses this component across communities
  const pageKey = `${chainId}:${communityId}`
  const [paging, setPaging] = useState({ key: pageKey, pages: 1 })
  const pages = paging.key === pageKey ? paging.pages : 1
  const communityAddress = CONTRACTS[`chain${chainId}`]?.community
  const chain = appChains.find((entry) => entry.id === chainId)
  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: [
      { address: writer.address, abi: governanceAbi, functionName: 'community', chainId },
      { address: writer.address, abi: governanceAbi, functionName: 'getRules', args: [id], chainId },
      { address: writer.address, abi: governanceAbi, functionName: 'treasuryAddress', args: [id], chainId },
      { address: writer.address, abi: governanceAbi, functionName: 'getProposals', args: [id, 0n, BigInt(pages * PAGE_SIZE)], chainId },
      { address: writer.address, abi: governanceAbi, functionName: 'proposalCount', args: [id], chainId },
      { address: communityAddress, abi: communityAbi, functionName: 'communities', args: [id], chainId },
      { address: communityAddress, abi: communityAbi, functionName: 'registry', args: [id, writer.account || zeroAddress], chainId },
    ],
    query: { enabled: Boolean(writer.address && communityAddress), refetchInterval: 15000 },
  })
  const result = (index) => data?.[index]?.status === 'success' ? data[index].result : null
  const source = result(0)
  const rules = result(1)
  const treasury = result(2)
  const total = Number(result(4) ?? 0)
  const community = result(5)
  const membership = result(6)
  const compatible = sameAddress(source, communityAddress)
  const ready = compatible && Boolean(rules && community && result(3) && result(4) !== null && membership)
  const proposals = ready ? result(3) : []
  const { data: balance, refetch: refetchBalance } = useBalance({ address: treasury, chainId, query: { enabled: ready && Boolean(treasury), refetchInterval: 15000 } })

  return {
    chainId,
    chain,
    communityId,
    writer,
    rules,
    treasury,
    proposals,
    total,
    balance,
    ready,
    isLoading,
    error,
    refetch,
    isOwner: sameAddress(community?.[1], writer.account),
    isMember: Boolean(membership?.[0]) && !membership?.[3],
    active: Boolean(community?.[4]),
    hasMore: total > pages * PAGE_SIZE,
    loadMore: () => setPaging({ key: pageKey, pages: pages + 1 }),
    refresh: () => { refetch(); refetchBalance() },
  }
}

/**
 * Treasury, voting rules and the "New proposal" entry point for one community. Proposals
 * themselves are listed by the caller — the community feed on the community page, a plain list
 * on the standalone proposals page.
 * @param {Object} props
 * @param {Object} props.governance From useCommunityGovernanceState.
 * @param {Function} [props.onProposalCreated] Called with the new proposal's id; defaults to opening it.
 */
export function CommunityGovernancePanel({ governance, onProposalCreated }) {
  const router = useRouter()
  const [dialog, setDialog] = useState(null)
  const { chainId, chain, communityId, writer, rules, treasury, balance, ready, isLoading, error, refetch, isOwner, isMember, active, refresh } = governance

  if (!writer.address) return <p className={styles.governance__muted}>Community voting and treasury are awaiting deployment on {chain?.name || 'this network'}.</p>
  if (isLoading) return <PageLoader />
  if (!ready || error) {
    return (
      <div className={styles.governance__panel}>
        <p>Could not load this community’s voting contract.</p>
        <button type="button" className={styles.governance__button} onClick={() => refetch()}>Try again</button>
      </div>
    )
  }

  return (
    <div className={styles.governance__panel}>
      <header className={styles.governance__header}>
        <div className={styles.governance__treasury}>
          <span className={styles.governance__status}>Community treasury</span>
          <strong>{balance ? `${formatUnits(balance.value, balance.decimals)} ${balance.symbol}` : 'Loading balance…'}</strong>
        </div>
        <div className={styles.governance__actions}>
          <button type="button" className={styles.governance__button} disabled={!isMember || !active} onClick={() => setDialog('propose')}>New proposal</button>
          <button type="button" className={styles.governance__button} disabled={!writer.account} onClick={() => setDialog('deposit')}>Deposit</button>
          {isOwner && <button type="button" className={styles.governance__button} onClick={() => setDialog('rules')}>Voting rules</button>}
        </div>
      </header>

      {!active && <p className={styles.governance__muted}>This community is archived. New proposals are closed.</p>}
      {active && !isMember && <p className={styles.governance__muted}>{writer.account ? 'Join the community to create proposals and vote.' : 'Connect your wallet to create proposals and vote.'}</p>}

      <details className={styles.governance__details}>
        <summary>How voting and the treasury work</summary>
        <p className={styles.governance__muted}>Community members can propose and vote. One member, one vote. Only the community owner changes the voting rules.</p>
        {rules && <p className={styles.governance__muted}>Creators choose {Number(rules.minVotingPeriod) / 3600}–{Number(rules.maxVotingPeriod) / 3600} voting hours per proposal · At least {Number(rules.minimumVotes)} votes required · {formatRulePercent(rules.approvalBps)} approval · Payments wait {Number(rules.executionDelay) / 3600} hours after voting ends.</p>}
        {rules && <p className={styles.governance__muted}>{Number(rules.votingDelay) === 0 ? 'Voting opens immediately.' : `Reading period before voting: ${Number(rules.votingDelay) % 86400 === 0 ? `${Number(rules.votingDelay) / 86400} days` : `${Number(rules.votingDelay) / 3600} hours`}. Members can read and discuss before voting opens.`}</p>}
        <div className={styles.governance__address}>{treasury}<CopyButton value={treasury} title="Copy treasury address" /></div>
        <p className={styles.governance__muted}>Native balance shown above. For ERC20 or LSP7 balances, select an asset below. Every outgoing payment needs an approved proposal.</p>
        <TreasuryTokenBalance treasury={treasury} chainId={chainId} />
        <CommunityDelegation key={`${chainId}:${communityId}`} chainId={chainId} communityId={communityId} />
      </details>

      {dialog && (
        <CommunityVotingDialogs
          key={`${chainId}:${communityId}:${dialog}`}
          kind={dialog}
          chainId={chainId}
          communityId={communityId}
          rules={rules}
          writer={writer}
          onExited={() => setDialog(null)}
          onDone={(proposalId) => {
            refresh()
            if (!proposalId) return
            if (onProposalCreated) onProposalCreated(proposalId)
            else router.push(communityProposalPath(chainId, communityId, proposalId))
          }}
        />
      )}
    </div>
  )
}

export default function CommunityGovernance({ networkId, communityId, communityName }) {
  const governance = useCommunityGovernanceState(networkId, communityId)
  const { chainId, writer, proposals, ready, isLoading, hasMore, loadMore } = governance

  return (
    <section className={styles.governance} aria-label="Community proposals and treasury">
      <Link className={styles.governance__link} href={communityPath(chainId, communityId)}>← Back to {communityName || 'community'}</Link>
      <h2 className={styles.governance__title}>Proposals & treasury</h2>
      <CommunityGovernancePanel governance={governance} />
      {ready && (
        <>
          <ul className={styles.governance__list}>{proposals.map((proposal) => <CommunityProposalRow key={proposal.id.toString()} proposal={proposal} chainId={chainId} governanceAddress={writer.address} />)}</ul>
          {proposals.length === 0 && <p className={styles.governance__muted}>No proposals yet. Community members can post the first one.</p>}
          {hasMore && <button type="button" className={styles.governance__button} disabled={isLoading} onClick={loadMore}>Load more</button>}
        </>
      )}
    </section>
  )
}

const tokenBalanceAbi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }]

function TreasuryTokenBalance({ treasury, chainId }) {
  const [asset, setAsset] = useState('')
  const token = usePaymentToken(chainId, asset)
  const { data, isLoading, error } = useReadContracts({ contracts: [{ address: asset, abi: tokenBalanceAbi, functionName: 'balanceOf', args: [treasury], chainId }], query: { enabled: token.exists, refetchInterval: 15000 } })
  const amount = data?.[0]?.status === 'success' ? data[0].result : null

  return (
    <div className={styles.governance__field}>
      <span>Check token balance</span>
      <TokenAssetInput chainId={chainId} value={asset} onChange={setAsset} allowNative={false} />
      {asset && <span>{isLoading || token.isLoading ? <><Spinner size={16} color="currentColor" /> Loading token…</> : error || amount === null || !token.exists ? 'Could not read this token balance' : `${formatUnits(amount, token.decimals)} ${token.symbol}`}</span>}
    </div>
  )
}
