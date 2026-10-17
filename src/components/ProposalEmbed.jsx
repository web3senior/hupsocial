'use client'

import Link from 'next/link'
import clsx from 'clsx'
import { useReadContracts } from 'wagmi'
import { daoAddressFor, formatRelative, optionLabels, proposalPath, proposalStatus, tallyRows, votesLabel } from '@/lib/dao'
import daoAbi from '@/abis/HupDao.json'
import ResultsBar from '@/app/proposals/_components/ResultsBar'
import { useDao, useIpfsJson } from '@/app/proposals/_components/useDao'
import { BankIcon, CaretRightIcon } from '@phosphor-icons/react'
import styles from './ProposalEmbed.module.scss'

/**
 * Proposal Embed
 * A group proposal inside a post. The content JSON carries only a reference
 * ({ chainId, daoId, proposalId }); the proposal is read live from HupDao, so the result in a
 * post is always the result onchain. Voting happens on the proposal page — the card is the way
 * there, which keeps the "votes counted at posting time" explanation in one place.
 * @param {Object} props
 * @param {{chainId: number, daoId: string|number, proposalId: string|number}} props.proposalRef
 * @param {boolean} [props.preview] Composer preview: same card, not a link.
 */
export default function ProposalEmbed({ proposalRef, preview = false }) {
  const chainId = Number(proposalRef?.chainId)
  const daoAddress = daoAddressFor(chainId)
  const enabled = Boolean(daoAddress && proposalRef?.daoId && proposalRef?.proposalId)

  const { data, isLoading } = useReadContracts({
    allowFailure: true,
    contracts: enabled
      ? [
          { abi: daoAbi, address: daoAddress, functionName: 'getProposal', args: [BigInt(proposalRef.proposalId)], chainId },
          { abi: daoAbi, address: daoAddress, functionName: 'state', args: [BigInt(proposalRef.proposalId)], chainId },
          { abi: daoAbi, address: daoAddress, functionName: 'getTallies', args: [BigInt(proposalRef.proposalId)], chainId },
        ]
      : [],
    query: { enabled },
  })

  const proposal = data?.[0]?.status === 'success' && Number(data[0].result.id) > 0 ? data[0].result : null
  // A reference whose group and proposal disagree is a hand-edited payload — render nothing
  const belongs = proposal && String(proposal.daoId) === String(proposalRef.daoId)
  const { metadata: groupMetadata, decimals } = useDao(chainId, enabled ? proposalRef.daoId : null)

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

  const status = proposalStatus(data?.[1]?.status === 'success' ? data[1].result : undefined)
  const tallies = data?.[2]?.status === 'success' ? data[2].result : []
  const rows = tallyRows(proposal, tallies, optionLabels(proposal, metadata))
  const voters = Number(proposal.voterCount)
  const settled = status.key === 'succeeded' || status.key === 'defeated'

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
          <span className={styles.embed__group}>{groupMetadata?.name || `Group #${proposalRef.daoId}`}</span>
        </span>
        <span className={clsx(styles.embed__badge, styles[`embed__badge--${status.key}`])}>{status.label}</span>
      </div>

      <h4 className={styles.embed__title}>{metadata?.title || `Proposal #${proposalRef.proposalId}`}</h4>

      {voters > 0 && status.key !== 'canceled' && <ResultsBar rows={rows} decimals={decimals} settled={settled} compact />}

      <div className={styles.embed__footer}>
        <span>
          {timing} · {voters} {voters === 1 ? 'voter' : 'voters'}
          {voters > 0 ? ` · ${votesLabel(proposal.totalVotes, decimals)}` : ''}
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
