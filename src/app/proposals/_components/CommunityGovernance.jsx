'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useBalance, useReadContracts } from 'wagmi'
import { formatUnits, zeroAddress } from 'viem'
import { CONTRACTS, appChains } from '@/config/contracts'
import { communityPath, communityProposalPath, formatRulePercent, COMMUNITY_PROPOSAL_STATES } from '@/lib/communityGovernance'
import { formatRelative, sameAddress } from '@/lib/dao'
import governanceAbi from '@/abis/HupCommunityGovernance.json'
import communityAbi from '@/abis/HupCommunity.json'
import { ContentSpinner } from '@/components/Loading'
import { usePaymentToken } from '@/hooks/usePaymentToken'
import TokenAssetInput from '@/app/communities/_components/TokenAssetInput'
import CopyButton from '@/components/ui/CopyButton'
import { useIpfsJson } from './useDao'
import useCommunityGovernance from './useCommunityGovernance'
import CommunityVotingDialogs from './CommunityVotingDialogs'
import styles from './CommunityGovernance.module.scss'

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

export default function CommunityGovernance({ networkId, communityId, communityName, embedded = false }) {
  const chainId = Number(networkId)
  const id = BigInt(communityId)
  const writer = useCommunityGovernance(chainId)
  const router = useRouter()
  const [dialog, setDialog] = useState(null)
  const [pages, setPages] = useState(1)
  const communityAddress = CONTRACTS[`chain${chainId}`]?.community
  const chain = appChains.find((entry) => entry.id === chainId)
  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: [
      { address: writer.address, abi: governanceAbi, functionName: 'community', chainId },
      { address: writer.address, abi: governanceAbi, functionName: 'getRules', args: [id], chainId },
      { address: writer.address, abi: governanceAbi, functionName: 'treasuryAddress', args: [id], chainId },
      { address: writer.address, abi: governanceAbi, functionName: 'getProposals', args: [id, 0n, BigInt(pages * 20)], chainId },
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
  const proposals = result(3) ?? []
  const total = Number(result(4) ?? 0)
  const community = result(5)
  const membership = result(6)
  const compatible = sameAddress(source, communityAddress)
  const ready = compatible && Boolean(rules && community && result(3) && result(4) !== null && membership)
  const isOwner = sameAddress(community?.[1], writer.account)
  const isMember = Boolean(membership?.[0]) && !membership?.[3]
  const active = Boolean(community?.[4])
  const { data: balance, refetch: refetchBalance } = useBalance({ address: treasury, chainId, query: { enabled: ready && Boolean(treasury), refetchInterval: 15000 } })

  const refresh = () => { refetch(); refetchBalance() }

  return (
    <section className={styles.governance} aria-label="Community proposals and treasury">
      {!embedded && <Link className={styles.governance__link} href={communityPath(chainId, communityId)}>← Back to {communityName || 'community'}</Link>}
      <header className={styles.governance__header}>
        <h2 className={styles.governance__title}>Proposals & treasury</h2>
        <div className={styles.governance__actions}>
          <button type="button" className={styles.governance__button} disabled={!ready || !isMember || !active} onClick={() => setDialog('propose')}>New proposal</button>
          {isOwner && <button type="button" className={styles.governance__button} disabled={!ready} onClick={() => setDialog('rules')}>Voting rules</button>}
        </div>
      </header>
      <p className={styles.governance__muted}>Community members can propose and vote. One member, one vote. Only the community owner changes the voting rules.</p>
      {!writer.address ? <p className={styles.governance__muted}>Community voting and treasury are awaiting deployment on {chain?.name || 'this network'}.</p> : isLoading ? <ContentSpinner /> : !ready || error ? (
        <div className={styles.governance__panel}><p>Could not load this community’s voting contract.</p><button type="button" className={styles.governance__button} onClick={() => refetch()}>Try again</button></div>
      ) : (
        <>
          {rules && <p className={styles.governance__muted}>Creators choose {Number(rules.minVotingPeriod) / 3600}–{Number(rules.maxVotingPeriod) / 3600} voting hours per proposal · At least {Number(rules.minimumVotes)} votes required · {formatRulePercent(rules.approvalBps)} approval · Payments wait {Number(rules.executionDelay) / 3600} hours after voting ends.</p>}
          {rules && <p className={styles.governance__muted}>{Number(rules.votingDelay) === 0 ? 'Voting opens immediately.' : `Reading period before voting: ${Number(rules.votingDelay) % 86400 === 0 ? `${Number(rules.votingDelay) / 86400} days` : `${Number(rules.votingDelay) / 3600} hours`}. Members can read and discuss before voting opens.`}</p>}
          {!active && <p className={styles.governance__muted}>This community is archived. New proposals are closed.</p>}
          {!isMember && <p className={styles.governance__muted}>{writer.account ? 'Join the community to create proposals and vote.' : 'Connect your wallet to create proposals and vote.'}</p>}
          <div className={styles.governance__panel}>
            <header className={styles.governance__header}>
              <h3 className={styles.governance__title}>Community treasury</h3>
              <button type="button" className={styles.governance__button} disabled={!writer.account} onClick={() => setDialog('deposit')}>Deposit funds</button>
            </header>
            <strong>{balance ? `${formatUnits(balance.value, balance.decimals)} ${balance.symbol}` : 'Loading balance…'}</strong>
            <div className={styles.governance__address}>{treasury}<CopyButton value={treasury} title="Copy treasury address" /></div>
            <p className={styles.governance__muted}>Native balance shown above. For ERC20 or LSP7 balances, select an asset below. Every outgoing payment needs an approved proposal.</p>
            <TreasuryTokenBalance treasury={treasury} chainId={chainId} />
          </div>
          <ul className={styles.governance__list}>{proposals.map((proposal) => <CommunityProposalRow key={proposal.id.toString()} proposal={proposal} chainId={chainId} governanceAddress={writer.address} />)}</ul>
          {proposals.length === 0 && <p className={styles.governance__muted}>No proposals yet. Community members can post the first one.</p>}
          {total > pages * 20 && <button type="button" className={styles.governance__button} disabled={isLoading} onClick={() => setPages((value) => value + 1)}>Load more</button>}
        </>
      )}
      {dialog && ready && <CommunityVotingDialogs key={`${chainId}:${communityId}:${dialog}`} kind={dialog} chainId={chainId} communityId={communityId} rules={rules} writer={writer} onExited={() => setDialog(null)} onDone={(proposalId) => { refresh(); if (proposalId) router.push(communityProposalPath(chainId, communityId, proposalId)) }} />}
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
      {asset && <span>{isLoading || token.isLoading ? 'Loading token…' : error || amount === null || !token.exists ? 'Could not read this token balance' : `${formatUnits(amount, token.decimals)} ${token.symbol}`}</span>}
    </div>
  )
}
