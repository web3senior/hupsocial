'use client'

import Link from 'next/link'
import { BankIcon } from '@phosphor-icons/react'
import { toRelativeTime } from '@/lib/dateHelper'
import ProposalEmbed from '@/components/ProposalEmbed'
import { CreatorName } from '../../../page'
import styles from './ProposalFeedItem.module.scss'

/**
 * One community proposal as a feed entry: who started it and when, over the same live-results
 * card a post shows when it shares a proposal.
 * @param {Object} props
 * @param {Object} props.proposal A getProposals row.
 * @param {number} props.chainId
 * @param {number} props.time Creation time in ms.
 */
export default function ProposalFeedItem({ proposal, chainId, time }) {
  const proposalRef = { chainId, communityId: String(proposal.communityId), proposalId: String(proposal.id) }

  return (
    <article className={styles.proposalItem}>
      <header className={styles.proposalItem__byline}>
        <BankIcon size={14} aria-hidden="true" />
        <span>
          <Link href={`/${proposal.proposer}`} className={styles.proposalItem__author}>
            <CreatorName address={proposal.proposer} />
          </Link>{' '}
          started a proposal
        </span>
        {Number.isFinite(time) && <time dateTime={new Date(time).toISOString()}>· {toRelativeTime(Math.floor(time / 1000))}</time>}
      </header>
      <ProposalEmbed proposalRef={proposalRef} />
    </article>
  )
}
