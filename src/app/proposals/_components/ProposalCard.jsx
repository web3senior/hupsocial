'use client'

import Link from 'next/link'
import clsx from 'clsx'
import { formatRelative, optionLabels, proposalStatus, tallyRows, votesLabel } from '@/lib/dao'
import ResultsBar from './ResultsBar'
import { useIpfsJson } from './useDao'
import styles from './ProposalCard.module.scss'

/**
 * Proposal Card
 * One row of a DAO's proposal list. Results show once anyone has voted; the whole card links
 * to the proposal page, where the vote itself happens.
 * @param {Object} props
 * @param {Object} props.proposal Onchain proposal record.
 * @param {number|undefined} props.state ProposalState from the contract.
 * @param {Array<bigint>|undefined} props.tallies From getTallies().
 * @param {number} props.chainId
 * @param {number} props.decimals Voting-power decimals.
 */
export default function ProposalCard({ proposal, state, tallies, chainId, decimals }) {
  const { data: metadata } = useIpfsJson(proposal.metadata)
  const status = proposalStatus(state)
  const href = `/proposals/${chainId}/${proposal.daoId}/${proposal.id}`
  const voters = Number(proposal.voterCount)
  const rows = tallyRows(proposal, tallies, optionLabels(proposal, metadata))
  const settled = status.key === 'succeeded' || status.key === 'defeated'

  const timing =
    status.key === 'pending'
      ? `Voting opens ${formatRelative(proposal.voteStart)}`
      : status.key === 'active'
        ? `Ends ${formatRelative(proposal.voteEnd)}`
        : status.key === 'canceled'
          ? 'Canceled'
          : `Ended ${formatRelative(proposal.voteEnd)}`

  return (
    <li className={styles.card__item}>
      <article className={styles.card}>
        <div className={styles.card__top}>
          <span className={clsx(styles.card__badge, styles[`card__badge--${status.key}`])}>{status.label}</span>
          <span className={styles.card__number}>#{proposal.id.toString()}</span>
        </div>

        <h3 className={styles.card__title}>
          <Link href={href} className={styles.card__link}>
            {metadata?.title || `Proposal #${proposal.id}`}
          </Link>
        </h3>

        {voters > 0 && status.key !== 'canceled' && <ResultsBar rows={rows} decimals={decimals} settled={settled} compact />}

        <div className={styles.card__meta}>
          <span>{timing}</span>
          <span>
            · {voters} {voters === 1 ? 'voter' : 'voters'} · {votesLabel(proposal.totalVotes, decimals)}
          </span>
        </div>
      </article>
    </li>
  )
}
