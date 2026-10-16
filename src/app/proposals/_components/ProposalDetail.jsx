'use client'

import { useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { useReadContract, useReadContracts } from 'wagmi'
import {
  MAX_REASON_LENGTH,
  chainNameFor,
  daoAddressFor,
  formatPower,
  formatRelative,
  formatShare,
  formatWhen,
  optionLabels,
  proposalStatus,
  quorumCounted,
  sameAddress,
  tallyRows,
  votesLabel,
} from '@/lib/dao'
import daoAbi from '@/abis/HupDao.json'
import Profile from '@/components/Profile'
import CopyButton from '@/components/ui/CopyButton'
import ProgressBar from '@/components/ui/ProgressBar'
import { ContentSpinner, Spinner } from '@/components/Loading'
import { BankIcon, CaretLeftIcon } from '@phosphor-icons/react'
import ResultsBar from './ResultsBar'
import { useDao, useDaoWrite, useIpfsJson } from './useDao'
import styles from './ProposalDetail.module.scss'

/**
 * Proposal Detail
 * The /dao/[networkId]/[daoId]/[proposalId] page. Shows the question, the running result and
 * quorum, and the viewer's ballot. Voting power is what the viewer held at the proposal's
 * snapshot — not now — which is the line the vote panel spells out.
 * @param {Object} props
 * @param {string|number} props.networkId
 * @param {string|number} props.daoId
 * @param {string|number} props.proposalId
 */
export default function ProposalDetail({ networkId, daoId, proposalId }) {
  const chainId = Number(networkId)
  const daoAddress = daoAddressFor(chainId)
  const { dao, metadata: daoMetadata, decimals } = useDao(chainId, daoId)
  const { send, busy, account } = useDaoWrite(chainId)
  const [choice, setChoice] = useState(null)
  const [reason, setReason] = useState('')
  const id = BigInt(proposalId || 0)

  const { data: reads, isLoading, refetch } = useReadContracts({
    allowFailure: true,
    contracts: [
      { abi: daoAbi, address: daoAddress, functionName: 'getProposal', args: [id], chainId },
      { abi: daoAbi, address: daoAddress, functionName: 'state', args: [id], chainId },
      { abi: daoAbi, address: daoAddress, functionName: 'getTallies', args: [id], chainId },
    ],
    query: { enabled: Boolean(daoAddress && proposalId) },
  })
  const proposal = reads?.[0]?.status === 'success' && Number(reads[0].result.id) > 0 ? reads[0].result : null
  const stateValue = reads?.[1]?.status === 'success' ? reads[1].result : undefined
  const tallies = reads?.[2]?.status === 'success' ? reads[2].result : []
  const belongs = proposal && String(proposal.daoId) === String(daoId)

  const { data: metadata } = useIpfsJson(belongs ? proposal.metadata : null)

  const { data: viewerReads, refetch: refetchViewer } = useReadContracts({
    allowFailure: true,
    contracts: [
      { abi: daoAbi, address: daoAddress, functionName: 'getReceipt', args: [id, account], chainId },
      { abi: daoAbi, address: daoAddress, functionName: 'getPastVotes', args: [BigInt(daoId || 0), account, BigInt(proposal?.snapshot ?? 0)], chainId },
    ],
    query: { enabled: Boolean(belongs && account) },
  })
  const receipt = viewerReads?.[0]?.status === 'success' ? viewerReads[0].result : null
  const power = viewerReads?.[1]?.status === 'success' ? viewerReads[1].result : 0n

  const back = (
    <Link href={`/proposals/${chainId}/${daoId}`} className={styles.proposal__back}>
      <CaretLeftIcon size={14} weight="bold" aria-hidden="true" />
      {daoMetadata?.name || `Group #${daoId}`}
    </Link>
  )

  if (!daoAddress || isLoading || !belongs) {
    return (
      <div className={styles.proposal}>
        {back}
        <div className={styles.proposal__empty}>
          {!daoAddress ? (
            <p>Proposals aren&apos;t available on {chainNameFor(chainId)} yet.</p>
          ) : isLoading ? (
            <ContentSpinner />
          ) : (
            <>
              <BankIcon size={32} />
              <p>This proposal doesn&apos;t exist.</p>
            </>
          )}
        </div>
      </div>
    )
  }

  const status = proposalStatus(stateValue)
  const labels = optionLabels(proposal, metadata)
  const rows = tallyRows(proposal, tallies, labels)
  const settled = status.key === 'succeeded' || status.key === 'defeated'
  const counted = quorumCounted(proposal, tallies)
  const quorumVotes = BigInt(proposal.quorumVotes)
  const quorumShare = quorumVotes > 0n ? Math.min(1, Number((counted * 10_000n) / quorumVotes) / 10_000) : 1
  const hasVoted = Boolean(receipt?.hasVoted)
  const isProposer = sameAddress(proposal.proposer, account)
  const isAdmin = Boolean(dao) && sameAddress(dao.admin, account)
  const canCancel = (isProposer && (status.key === 'pending' || status.key === 'active')) || (isAdmin && status.key === 'pending')

  const refresh = () => {
    refetch()
    refetchViewer()
  }

  const castVote = async () => {
    if (choice === null) return
    const done = await send(
      'vote',
      { functionName: 'castVote', args: [id, choice, reason.trim()] },
      { success: `Voted ${labels[choice]}`, failure: 'Vote failed' },
    )
    if (done) {
      setReason('')
      refresh()
    }
  }

  const cancel = async () => {
    const done = await send('cancel', { functionName: 'cancel', args: [id] }, { success: 'Proposal canceled', failure: 'Could not cancel' })
    if (done) refresh()
  }

  return (
    <div className={styles.proposal}>
      {back}

      <header className={styles.proposal__header}>
        <div className={styles.proposal__top}>
          <span className={clsx(styles.proposal__badge, styles[`proposal__badge--${status.key}`])}>{status.label}</span>
          <span className={styles.proposal__muted}>Proposal #{proposal.id.toString()}</span>
          <CopyButton
            value={`/proposals/${chainId}/${daoId}/${proposal.id}`}
            title="Copy proposal link"
            copiedTitle="Link copied"
            toastMessage="Proposal link copied"
            size={13}
          />
        </div>
        <h2 className={styles.proposal__title}>{metadata?.title || `Proposal #${proposal.id}`}</h2>
        <Profile variant="fullWithoutTime" creator={proposal.proposer} networkId={chainId} className={styles.proposal__proposer} />
      </header>

      {metadata?.body && <p className={styles.proposal__body}>{metadata.body}</p>}

      <dl className={styles.proposal__facts}>
        <div>
          <dt>Voting {status.key === 'pending' ? 'opens' : 'opened'}</dt>
          <dd>{formatWhen(proposal.voteStart)}</dd>
        </div>
        <div>
          <dt>Voting {settled || status.key === 'canceled' ? 'closed' : 'closes'}</dt>
          <dd>
            {formatWhen(proposal.voteEnd)}
            {status.key === 'active' && <span className={styles.proposal__muted}> · {formatRelative(proposal.voteEnd)}</span>}
          </dd>
        </div>
        <div>
          <dt>Voters</dt>
          <dd>
            {Number(proposal.voterCount)} · {votesLabel(proposal.totalVotes, decimals)}
          </dd>
        </div>
      </dl>

      <section className={styles.proposal__section} aria-label="Results">
        <h3>Results</h3>
        <ResultsBar rows={rows} decimals={decimals} settled={settled} viewerOption={hasVoted ? Number(receipt.option) : null} />
        <ProgressBar
          percent={quorumShare * 100}
          height={4}
          color={quorumShare >= 1 ? 'var(--status-success, #15803d)' : 'var(--dao-accent)'}
          gradient={false}
          label={<span className={styles.proposal__muted}>Enough people voted?</span>}
          hint={
            <span className={styles.proposal__muted}>
              {formatPower(counted, decimals)} / {formatPower(quorumVotes, decimals)} ({formatShare(quorumShare)})
            </span>
          }
          ariaLabel="Turnout needed"
        />
      </section>

      {status.key === 'active' && (
        <section className={styles.proposal__section} aria-label="Your vote">
          <h3>Your vote</h3>
          {!account ? (
            <p className={styles.proposal__muted}>Connect a wallet to vote.</p>
          ) : hasVoted ? (
            <p className={styles.proposal__muted}>
              You voted <strong>{labels[Number(receipt.option)]}</strong> with {votesLabel(receipt.weight, decimals)}. Votes can’t be changed.
            </p>
          ) : power === 0n ? (
            <p className={styles.proposal__muted}>
              You had no votes when this was posted, so you can&apos;t vote on it. Votes you get now count on the next proposal.
            </p>
          ) : (
            <>
              <p className={styles.proposal__muted}>You have {votesLabel(power, decimals)} here — what you held when this was posted.</p>
              <div className={styles.proposal__choices} role="radiogroup" aria-label="Options">
                {labels.map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={choice === index}
                    className={clsx(styles.proposal__choice, choice === index && styles['proposal__choice--selected'])}
                    onClick={() => setChoice(index)}
                    disabled={Boolean(busy)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className={styles.proposal__reason}>
                <span>Reason (optional, public)</span>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={MAX_REASON_LENGTH} rows={2} disabled={Boolean(busy)} />
              </label>
              <button type="button" className={styles.proposal__submit} onClick={castVote} disabled={choice === null || Boolean(busy)}>
                {busy === 'vote' && <Spinner size={16} color="currentColor" />}
                {busy === 'vote' ? 'Voting…' : choice === null ? 'Pick an option' : `Vote ${labels[choice]}`}
              </button>
            </>
          )}
        </section>
      )}

      {canCancel && (
        <button type="button" className={styles.proposal__cancel} onClick={cancel} disabled={Boolean(busy)}>
          {busy === 'cancel' ? 'Canceling…' : 'Cancel proposal'}
        </button>
      )}
    </div>
  )
}
