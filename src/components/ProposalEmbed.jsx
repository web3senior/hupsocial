'use client'

import Link from 'next/link'
import clsx from 'clsx'
import { useReadContracts } from 'wagmi'
import { formatRelative, optionLabels, proposalPath, tallyRows, votesLabel } from '@/lib/communityProposal'
import governanceAbi from '@/abis/HupCommunityGovernance.json'
import { governanceAddressFor, COMMUNITY_PROPOSAL_STATES } from '@/lib/communityGovernance'
import ResultsBar from '@/app/proposals/_components/ResultsBar'
import { useIpfsJson } from '@/hooks/useIpfsJson'
import { BankIcon, CaretRightIcon } from '@phosphor-icons/react'
import styles from './ProposalEmbed.module.scss'

/**
 * Proposal Embed
 * A community proposal inside a post. The content JSON carries only a reference
 * ({ chainId, communityId, proposalId }); the proposal is read live from community governance, so the result in a
 * post is always the result onchain. Voting happens on the proposal page — the card is the way
 * there, which keeps the "votes counted at posting time" explanation in one place.
 * @param {Object} props
 * @param {{chainId: number, communityId: string|number, proposalId: string|number}} props.proposalRef
 * @param {boolean} [props.preview] Composer preview: same card, not a link.
 */
export default function ProposalEmbed({ proposalRef, preview = false }) {
  const chainId = Number(proposalRef?.chainId)
  const address = governanceAddressFor(chainId)
  const abi = governanceAbi
  const enabled = Boolean(address && proposalRef?.communityId && proposalRef?.proposalId)

  const { data, isLoading } = useReadContracts({
    allowFailure: true,
    contracts: enabled
      ? [
          { abi, address, functionName: 'getProposal', args: [BigInt(proposalRef.proposalId)], chainId },
          { abi, address, functionName: 'state', args: [BigInt(proposalRef.proposalId)], chainId },
          { abi, address, functionName: 'getTallies', args: [BigInt(proposalRef.proposalId)], chainId },
        ]
      : [],
    query: { enabled },
  })

  const proposal = data?.[0]?.status === 'success' && Number(data[0].result.id) > 0 ? data[0].result : null
  // A reference whose group and proposal disagree is a hand-edited payload — render nothing
  const belongs = proposal && String(proposal.communityId) === String(proposalRef.communityId)
  const decimals = 0

  const { data: metadata } = useIpfsJson(belongs ? proposal.metadata : null)

  if (!enabled) return null

  if (isLoading) {
    return (
      <div className={clsx(styles.embed, styles['embed--loading'])} aria-hidden="true">
        <div className="shimmer rounded" style={{ width: '9rem', height: '12px' }} />
        <div className="shimmer rounded" style={{ width: '75%', height: '16px' }} />
        <div className="shimmer rounded" style={{ width: '100%', height: '28px' }} />
      </div>
    )
  }

  if (!belongs || proposal.hidden) return null

  const stateValue = data?.[1]?.status === 'success' ? data[1].result : undefined
  const status = COMMUNITY_PROPOSAL_STATES[Number(stateValue)] || COMMUNITY_PROPOSAL_STATES[0]
  const tallies = data?.[2]?.status === 'success' ? data[2].result : []
  const rows = tallyRows(proposal, tallies, optionLabels(proposal, metadata))
  const voters = Number(proposal.voterCount)
  const settled = status.key === 'succeeded' || status.key === 'defeated' || status.key === 'executed'

  const timing =
    status.key === 'pending'
      ? `Voting opens ${formatRelative(proposal.voteStart)}`
      : status.key === 'active'
        ? `Ends ${formatRelative(proposal.voteEnd)}`
        : status.key === 'canceled'
          ? 'Canceled'
          : `Ended ${formatRelative(proposal.voteEnd)}`

  const body = (
    <>
      <div className={styles.embed__top}>
        <span className={styles.embed__kind}>
          <BankIcon size={14} aria-hidden="true" />
          <span className={styles.embed__group}>{`Community #${proposalRef.communityId}`}</span>
        </span>
        <span className={clsx(styles.embed__badge, styles[`embed__badge--${status.key}`])}>{status.label}</span>
      </div>

      <h4 className={styles.embed__title}>{metadata?.title || `Proposal #${proposalRef.proposalId}`}</h4>

      {voters > 0 && status.key !== 'canceled' && <ResultsBar rows={rows} decimals={decimals} settled={settled} compact />}

      <div className={styles.embed__footer}>
        <span>
          {timing} · {voters} {voters === 1 ? 'voter' : 'voters'}
          {voters > 0 ? ` · ${votesLabel(proposal.voterCount, decimals)}` : ''}
        </span>
        {status.key === 'active' && (
          <span className={styles.embed__cta}>
            Vote
            <CaretRightIcon size={12} weight="bold" aria-hidden="true" />
          </span>
        )}
      </div>
    </>
  )

  if (preview) return <div className={styles.embed}>{body}</div>

  return (
    <Link href={proposalPath(proposalRef)} className={clsx(styles.embed, styles['embed--link'])} onClick={(event) => event.stopPropagation()}>
      {body}
    </Link>
  )
}
