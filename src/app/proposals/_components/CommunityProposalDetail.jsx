'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { useReadContracts } from 'wagmi'
import { formatUnits, zeroAddress } from 'viem'
import { CONTRACTS, appChains } from '@/config/contracts'
import { communityProposalsPath, communityProposalPath, formatRulePercent, COMMUNITY_PROPOSAL_STATES } from '@/lib/communityGovernance'
import { formatWhen, optionLabels, sameAddress, tallyRows } from '@/lib/communityProposal'
import { usePaymentToken } from '@/hooks/usePaymentToken'
import governanceAbi from '@/abis/HupCommunityGovernance.json'
import communityAbi from '@/abis/HupCommunity.json'
import { ContentSpinner, Spinner } from '@/components/Loading'
import CopyButton from '@/components/ui/CopyButton'
import NewPost from '@/components/NewPost'
import Profile from '@/components/Profile'
import ResultsBar from './ResultsBar'
import { useIpfsJson } from '@/hooks/useIpfsJson'
import useCommunityGovernance from './useCommunityGovernance'
import CommunityDelegation, { CommunityDelegatedVotes } from './CommunityDelegation'
import styles from './ProposalDetail.module.scss'

export default function CommunityProposalDetail({ networkId, communityId, proposalId }) {
  const chainId = Number(networkId)
  const id = BigInt(proposalId)
  const writer = useCommunityGovernance(chainId)
  const communityAddress = CONTRACTS[`chain${chainId}`]?.community
  const [choice, setChoice] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])
  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: [
      { address: writer.address, abi: governanceAbi, functionName: 'getProposal', args: [id], chainId },
      { address: writer.address, abi: governanceAbi, functionName: 'state', args: [id], chainId },
      { address: writer.address, abi: governanceAbi, functionName: 'getTallies', args: [id], chainId },
      { address: writer.address, abi: governanceAbi, functionName: 'hasVoted', args: [id, writer.account || zeroAddress], chainId },
      { address: communityAddress, abi: communityAbi, functionName: 'communities', args: [BigInt(communityId)], chainId },
      { address: communityAddress, abi: communityAbi, functionName: 'registry', args: [BigInt(communityId), writer.account || zeroAddress], chainId },
      { address: writer.address, abi: governanceAbi, functionName: 'community', chainId },
    ],
    query: { enabled: Boolean(writer.address && communityAddress), refetchInterval: 10000 },
  })
  const result = (index) => data?.[index]?.status === 'success' ? data[index].result : null
  const proposal = result(0)
  const status = COMMUNITY_PROPOSAL_STATES[Number(result(1))]
  const tallies = result(2) ?? []
  const hasVoted = result(3)
  const community = result(4)
  const membership = result(5)
  const compatible = sameAddress(result(6), communityAddress)
  const belongs = compatible && proposal && String(proposal.communityId) === String(communityId)
  const { data: metadata } = useIpfsJson(belongs ? proposal.metadata : null)
  const eligible = Boolean(membership?.[0]) && !membership?.[3]
  const native = !proposal?.payment?.asset || sameAddress(proposal.payment.asset, zeroAddress)
  const token = usePaymentToken(chainId, native ? undefined : proposal?.payment?.asset)
  const currency = appChains.find((chain) => chain.id === chainId)?.nativeCurrency
  const back = <Link className={styles.proposal__back} href={communityProposalsPath(chainId, communityId)}>← Community proposals & treasury</Link>

  if (!writer.address || isLoading || !belongs || error || result(1) === null) {
    return <section className={styles.proposal}>{back}{isLoading ? <ContentSpinner /> : <p>{!writer.address ? 'Community voting is awaiting deployment on this network.' : 'This proposal could not be loaded for this community.'}</p>}</section>
  }

  const labels = optionLabels(proposal, metadata)
  const rows = tallyRows(proposal, tallies, labels)
  const isOwner = sameAddress(community?.[1], writer.account)
  const isProposer = sameAddress(proposal.proposer, writer.account)
  const canCancel = (isProposer && ['pending', 'active'].includes(status.key)) || (isOwner && status.key === 'pending')
  const payment = proposal.payment
  const spending = payment.amount > 0n
  const canExecute = spending && status.key === 'succeeded' && now >= Number(proposal.executableAt)
  const decimals = native ? currency?.decimals ?? 18 : token.decimals
  const amountLabel = decimals === null ? `${payment.amount.toString()} base units` : `${formatUnits(payment.amount, decimals)} ${native ? currency?.symbol || 'native' : token.symbol}`

  const act = async (action, call, message) => {
    const receipt = await writer.send(action, call, message)
    if (receipt) refetch()
  }

  return (
    <section className={styles.proposal}>
      {back}
      <header className={styles.proposal__header}>
        <div className={styles.proposal__top}>
          <span className={clsx(styles.proposal__badge, styles[`proposal__badge--${status.key}`])}>{status.label}</span>
          <span className={styles.proposal__muted}>Proposal #{proposal.id.toString()}</span>
          <CopyButton value={communityProposalPath(chainId, communityId, proposal.id)} title="Copy proposal link" />
          <button type="button" className={styles.proposal__share} onClick={() => setSharing(true)}>Share to feed</button>
        </div>
        <h1 className={styles.proposal__title}>{metadata?.title || `Proposal #${proposal.id}`}</h1>
        <Profile variant="fullWithoutTime" creator={proposal.proposer} networkId={chainId} className={styles.proposal__proposer} />
      </header>
      {metadata?.body && <p className={styles.proposal__body}>{metadata.body}</p>}
      {spending && <div className={styles.proposal__section}>
        <h2 className={styles.proposal__title}>Proposed payment</h2>
        <dl className={styles.proposal__facts}>
          <div><dt>Amount</dt><dd>{amountLabel}</dd></div>
          <div><dt>Asset</dt><dd>{native ? currency?.symbol || 'Native currency' : `${payment.isLsp7 ? 'LSP7' : 'ERC20'}: ${payment.asset}`}</dd></div>
          <div><dt>Recipient</dt><dd>{payment.recipient}</dd></div>
          <div><dt>Payment available after</dt><dd>{formatWhen(proposal.executableAt)}</dd></div>
        </dl>
        <p className={styles.proposal__muted}>These instructions are fixed onchain. A passing proposal can be paid once after its execution delay, provided the treasury has enough funds.</p>
        {proposal.executed ? <strong>Payment executed</strong> : status.key === 'succeeded' && <button type="button" className={styles.proposal__choice} disabled={!writer.account || !canExecute || Boolean(writer.busy)} onClick={() => act('execute', { functionName: 'execute', args: [id] }, 'Treasury payment executed')}>{writer.busy === 'execute' ? <><Spinner size={16} color="currentColor" /> Executing…</> : canExecute ? 'Execute approved payment' : 'Waiting for execution delay'}</button>}
      </div>}
      <dl className={styles.proposal__facts}>
        <div><dt>Voting opens</dt><dd>{formatWhen(proposal.voteStart)}</dd></div>
        <div><dt>Voting closes</dt><dd>{formatWhen(proposal.voteEnd)}</dd></div>
        <div><dt>Voting duration</dt><dd>{Number(proposal.voteEnd - proposal.voteStart) / 3600} hours</dd></div>
        <div><dt>Turnout</dt><dd>{proposal.voterCount.toString()} / {proposal.quorumVotes.toString()} members required</dd></div>
        <div><dt>Approval required</dt><dd>{formatRulePercent(proposal.approvalBps)}</dd></div>
      </dl>
      <ResultsBar rows={rows} decimals={0} settled={['succeeded', 'defeated', 'executed'].includes(status.key)} />
      <p className={styles.proposal__muted}>Every ballot counts toward turnout. For Yes / No proposals, approval excludes abstentions. Multiple-choice proposals require one choice to meet the approval percentage.</p>
      {status.key === 'active' && <div className={styles.proposal__section}>
        <h2 className={styles.proposal__title}>Your vote</h2>
        {!writer.account ? <p>Connect your wallet to vote.</p> : hasVoted ? <p>Your vote has been recorded. Each member can vote once.</p> : !eligible ? <p>Join this community to vote. Members can join and vote while voting is open.</p> : <>
          <div className={styles.proposal__choices} role="radiogroup" aria-label="Choose your vote">
            {labels.map((label, index) => <button key={index} type="button" role="radio" aria-checked={choice === index} className={clsx(styles.proposal__choice, choice === index && styles['proposal__choice--selected'])} disabled={Boolean(writer.busy)} onClick={() => setChoice(index)}>{label}</button>)}
          </div>
          <button type="button" className={styles.proposal__submit} disabled={choice === null || Boolean(writer.busy)} onClick={() => act('vote', { functionName: 'castVote', args: [id, choice] }, 'Vote recorded')}>{writer.busy === 'vote' ? <><Spinner size={16} color="currentColor" /> Voting…</> : choice === null ? 'Choose an option' : `Vote ${labels[choice]}`}</button>
        </>}
      </div>}
      <CommunityDelegation key={`${chainId}:${communityId}`} chainId={chainId} communityId={communityId} />
      {status.key === 'active' && <CommunityDelegatedVotes key={`${chainId}:${communityId}:${proposalId}:${writer.account}`} chainId={chainId} communityId={communityId} proposalId={proposalId} labels={labels} onVoted={refetch} />}
      {canCancel && <button type="button" className={styles.proposal__cancel} disabled={Boolean(writer.busy)} onClick={() => act('cancel', { functionName: 'cancel', args: [id] }, 'Proposal canceled')}>{writer.busy === 'cancel' ? 'Canceling…' : 'Cancel proposal'}</button>}
      {sharing && <NewPost proposal={{ chainId, communityId: String(communityId), proposalId: proposal.id.toString() }} text={metadata?.title || ''} onClose={() => setSharing(false)} />}
    </section>
  )
}
