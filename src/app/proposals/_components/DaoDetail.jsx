'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { formatUnits, zeroAddress } from 'viem'
import { useReadContract, useReadContracts } from 'wagmi'
import {
  PAGE_SIZE,
  VOTING_MODE,
  VOTING_MODE_OPTIONS,
  chainNameFor,
  daoAddressFor,
  describeSettings,
  formatPower,
  formatShare,
  sameAddress,
  shortAddress,
  votesLabel,
} from '@/lib/dao'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import daoAbi from '@/abis/HupDao.json'
import Profile from '@/components/Profile'
import CopyButton from '@/components/ui/CopyButton'
import { ContentSpinner } from '@/components/Loading'
import { BankIcon, CaretLeftIcon, PlusIcon } from '@phosphor-icons/react'
import CreateProposalModal from './CreateProposalModal'
import DelegateModal from './DelegateModal'
import EditGroupModal from './EditGroupModal'
import MembersModal from './MembersModal'
import ProposalCard from './ProposalCard'
import StakeModal from './StakeModal'
import { useDao, useDaoWrite } from './useDao'
import styles from './DaoDetail.module.scss'

const votesTokenAbi = [
  { name: 'delegates', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'address' }] },
]

// The roster is read in one call; past this the contract pages and so would we
const ROSTER_LIMIT = 100

const BackToDaos = () => (
  <Link href="/proposals" className={styles.detail__back}>
    <CaretLeftIcon size={14} weight="bold" aria-hidden="true" />
    All groups
  </Link>
)

/**
 * DAO Detail
 * The /dao/[networkId]/[daoId] page: who the DAO is, the viewer's voting power and what they
 * can do with it, the proposals, and the people holding votes.
 * @param {Object} props
 * @param {string|number} props.networkId
 * @param {string|number} props.daoId
 */
export default function DaoDetail({ networkId, daoId }) {
  const chainId = Number(networkId)
  const router = useRouter()
  const daoAddress = daoAddressFor(chainId)
  const { dao, metadata, token, decimals, isLoading, notFound, refetch: refetchDao } = useDao(chainId, daoId)
  const { send, busy, account } = useDaoWrite(chainId)
  const [tab, setTab] = useState('proposals')
  const [pages, setPages] = useState(1)
  // Pinned rather than read per render: it is a query argument, and a fresh value each render
  // would refetch forever. Moved forward on every refresh.
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))

  const proposalRef = useRef(null)
  const stakeRef = useRef(null)
  const delegateRef = useRef(null)
  const membersRef = useRef(null)
  const editRef = useRef(null)

  const id = BigInt(daoId || 0)
  const mode = dao ? Number(dao.mode) : null
  const onToken = mode === VOTING_MODE.VotesToken
  const isAdmin = Boolean(dao && account) && sameAddress(dao.admin, account)

  const { data: viewer, refetch: refetchViewer } = useReadContracts({
    allowFailure: true,
    contracts: [
      { abi: daoAbi, address: daoAddress, functionName: 'getVotes', args: [id, account], chainId },
      { abi: daoAbi, address: daoAddress, functionName: 'unitsOf', args: [id, account], chainId },
      onToken
        ? { abi: votesTokenAbi, address: dao?.token, functionName: 'delegates', args: [account], chainId }
        : { abi: daoAbi, address: daoAddress, functionName: 'delegates', args: [id, account], chainId },
    ],
    query: { enabled: Boolean(dao && account) },
  })
  const votes = viewer?.[0]?.status === 'success' ? viewer[0].result : 0n
  const units = viewer?.[1]?.status === 'success' ? viewer[1].result : 0n
  const delegate = viewer?.[2]?.status === 'success' ? viewer[2].result : null
  const delegatedAway = Boolean(delegate) && !sameAddress(delegate, account) && !sameAddress(delegate, zeroAddress)

  // A votes token's total lives on the token and can only be read for a past timepoint
  const { data: totalVotes, refetch: refetchTotal } = useReadContract({
    abi: daoAbi,
    address: daoAddress,
    functionName: 'getPastTotalVotes',
    args: [id, BigInt(nowSeconds)],
    chainId,
    query: { enabled: Boolean(dao) && !onToken },
  })

  const { data: proposals, isLoading: isLoadingProposals, refetch: refetchProposals } = useReadContract({
    abi: daoAbi,
    address: daoAddress,
    functionName: 'getProposals',
    args: [id, 0n, BigInt(PAGE_SIZE * pages)],
    chainId,
    query: { enabled: Boolean(dao), placeholderData: (previous) => previous },
  })
  const visibleProposals = useMemo(() => (proposals ?? []).filter((proposal) => !proposal.hidden), [proposals])

  const { data: proposalReads } = useReadContracts({
    allowFailure: true,
    contracts: visibleProposals.flatMap((proposal) => [
      { abi: daoAbi, address: daoAddress, functionName: 'state', args: [proposal.id], chainId },
      { abi: daoAbi, address: daoAddress, functionName: 'getTallies', args: [proposal.id], chainId },
    ]),
    query: { enabled: visibleProposals.length > 0 },
  })

  const { data: roster, refetch: refetchRoster } = useReadContract({
    abi: daoAbi,
    address: daoAddress,
    functionName: 'getParticipants',
    args: [id, 0n, BigInt(ROSTER_LIMIT)],
    chainId,
    query: { enabled: Boolean(dao) && !onToken },
  })
  const rosterRows = useMemo(
    () => [...(roster ?? [])].sort((a, b) => (b.votes > a.votes ? 1 : b.votes < a.votes ? -1 : 0)),
    [roster],
  )

  const refreshAll = () => {
    refetchDao()
    refetchViewer()
    setNowSeconds(Math.floor(Date.now() / 1000))
    refetchTotal()
    refetchProposals()
    refetchRoster()
  }

  const leave = async () => {
    const receipt = await send('leave', { functionName: 'leaveDao', args: [id] }, { success: 'You left the DAO', failure: 'Could not leave' })
    if (receipt) refreshAll()
  }

  if (!daoAddress) {
    return (
      <div className={styles.detail}>
        <BackToDaos />
        <div className={styles.detail__empty}>
          <BankIcon size={32} />
          <p>Proposals aren&apos;t available on {chainNameFor(chainId)} yet.</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className={styles.detail}>
        <BackToDaos />
        <div className={styles.detail__empty}>
          <ContentSpinner />
        </div>
      </div>
    )
  }

  if (notFound || !dao) {
    return (
      <div className={styles.detail}>
        <BackToDaos />
        <div className={styles.detail__empty}>
          <BankIcon size={32} />
          <p>This group doesn&apos;t exist.</p>
        </div>
      </div>
    )
  }

  const name = metadata?.name || `Group #${dao.id}`
  const image = metadata?.image ? resolveStorageImageUrl(metadata.image, { width: 160 }) || metadata.image : null
  const symbol = token.symbol || 'tokens'
  const share = totalVotes && totalVotes > 0n ? Number((votes * 10_000n) / totalVotes) / 10_000 : null
  const hasMoreProposals = Number(dao.proposalCount) > PAGE_SIZE * pages

  return (
    <div className={styles.detail}>
      <BackToDaos />

      <header className={styles.detail__header}>
        <div className={styles.detail__avatar} aria-hidden="true">
          {image ? <img src={image} alt="" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}
        </div>
        <div className={styles.detail__heading}>
          <h2 className={styles.detail__name}>{name}</h2>
          <div className={styles.detail__chips}>
            <span className={styles.detail__chip}>{VOTING_MODE_OPTIONS[mode]?.tag}</span>
            <span className={styles.detail__network}>{chainNameFor(chainId)}</span>
            <CopyButton value={`/proposals/${chainId}/${dao.id}`} title="Copy group link" copiedTitle="Link copied" toastMessage="Group link copied" size={13} />
          </div>
        </div>
      </header>

      {metadata?.description && <p className={styles.detail__description}>{metadata.description}</p>}

      <ul className={styles.detail__rules}>
        {describeSettings(dao.settings, decimals).map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
        {!onToken && totalVotes !== undefined && <li>{votesLabel(totalVotes, decimals)} in total</li>}
        {mode !== VOTING_MODE.Members && (
          <li>
            {symbol} · {shortAddress(dao.token)}
          </li>
        )}
      </ul>

      <section className={styles.detail__power} aria-label="Your votes">
        {!account ? (
          <p className={styles.detail__muted}>Connect a wallet to see your votes.</p>
        ) : (
          <>
            <div className={styles.detail__powerStats}>
              <div>
                <span className={styles.detail__statLabel}>Your votes</span>
                <strong className={styles.detail__statValue}>{formatPower(votes, decimals)}</strong>
                {share !== null && <span className={styles.detail__muted}>{formatShare(share)} of all votes</span>}
              </div>
              {mode === VOTING_MODE.Staked && (
                <div>
                  <span className={styles.detail__statLabel}>Locked</span>
                  <strong className={styles.detail__statValue}>
                    {formatPower(units, decimals)} <small>{symbol}</small>
                  </strong>
                </div>
              )}
              {mode === VOTING_MODE.Members && (
                <div>
                  <span className={styles.detail__statLabel}>Membership</span>
                  <strong className={styles.detail__statValue}>{units > 0n ? 'Member' : 'Not a member'}</strong>
                </div>
              )}
            </div>

            {delegatedAway && (
              <p className={styles.detail__muted}>
                <strong>{shortAddress(delegate)}</strong> votes for you with your{' '}
                {mode === VOTING_MODE.Staked ? `${formatUnits(units, decimals)} ${symbol}` : 'vote'}.
              </p>
            )}
            {onToken && sameAddress(delegate ?? zeroAddress, zeroAddress) && (
              <p className={styles.detail__muted}>Your token votes are off until you turn them on — tap “Delegate voting”.</p>
            )}

            <div className={styles.detail__actions}>
              {mode === VOTING_MODE.Staked && (
                <>
                  <button type="button" className={styles.detail__primary} onClick={() => stakeRef.current?.open('stake')}>
                    Lock tokens
                  </button>
                  {units > 0n && (
                    <button type="button" className={styles.detail__secondary} onClick={() => stakeRef.current?.open('unstake')}>
                      Unlock
                    </button>
                  )}
                </>
              )}
              {(mode !== VOTING_MODE.Members || units > 0n) && (
                <button type="button" className={styles.detail__secondary} onClick={() => delegateRef.current?.open()}>
                  Delegate voting
                </button>
              )}
              {mode === VOTING_MODE.Members && units > 0n && (
                <button type="button" className={styles.detail__secondary} onClick={leave} disabled={busy === 'leave'}>
                  {busy === 'leave' ? 'Leaving…' : 'Leave'}
                </button>
              )}
              {isAdmin && mode === VOTING_MODE.Members && (
                <button type="button" className={styles.detail__secondary} onClick={() => membersRef.current?.open('add')}>
                  Manage members
                </button>
              )}
              {isAdmin && (
                <button type="button" className={styles.detail__secondary} onClick={() => editRef.current?.open()}>
                  Edit group
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <div className={styles.detail__tabBar}>
        <div className={styles.detail__tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'proposals'}
            className={clsx(styles.detail__tab, tab === 'proposals' && styles['detail__tab--active'])}
            onClick={() => setTab('proposals')}
          >
            Proposals <span>{dao.proposalCount.toString()}</span>
          </button>
          {!onToken && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'people'}
              className={clsx(styles.detail__tab, tab === 'people' && styles['detail__tab--active'])}
              onClick={() => setTab('people')}
            >
              {mode === VOTING_MODE.Members ? 'Members' : 'Voters'} <span>{roster?.length ?? 0}</span>
            </button>
          )}
        </div>

        {tab === 'proposals' && account && (
          <button type="button" className={styles.detail__primary} onClick={() => proposalRef.current?.open()}>
            <PlusIcon size={14} weight="bold" />
            New proposal
          </button>
        )}
      </div>

      {tab === 'proposals' && (
        <>
          {isLoadingProposals && !proposals ? (
            <div className={styles.detail__empty}>
              <ContentSpinner />
            </div>
          ) : visibleProposals.length === 0 ? (
            <div className={styles.detail__empty}>
              <p>No proposals yet.</p>
            </div>
          ) : (
            <ul className={styles.detail__list}>
              {visibleProposals.map((proposal, index) => {
                const stateRead = proposalReads?.[index * 2]
                const tallyRead = proposalReads?.[index * 2 + 1]
                return (
                  <ProposalCard
                    key={proposal.id.toString()}
                    proposal={proposal}
                    state={stateRead?.status === 'success' ? stateRead.result : undefined}
                    tallies={tallyRead?.status === 'success' ? tallyRead.result : undefined}
                    chainId={chainId}
                    decimals={decimals}
                  />
                )
              })}
            </ul>
          )}
          {hasMoreProposals && (
            <button type="button" className={styles.detail__loadMore} onClick={() => setPages(pages + 1)}>
              Load more
            </button>
          )}
        </>
      )}

      {tab === 'people' && !onToken && (
        <ul className={styles.detail__roster}>
          {rosterRows.length === 0 && <li className={styles.detail__muted}>Nobody holds votes yet.</li>}
          {rosterRows.map((row) => {
            const rowShare = totalVotes && totalVotes > 0n ? Number((row.votes * 10_000n) / totalVotes) / 10_000 : 0
            const delegatesAway = !sameAddress(row.delegate, row.account)
            return (
              <li key={row.account} className={styles.detail__person}>
                <Profile variant="fullWithoutTime" creator={row.account} networkId={chainId} className={styles.detail__profile} />
                <div className={styles.detail__personStats}>
                  <strong>{votesLabel(row.votes, decimals)}</strong>
                  <span>
                    {formatShare(rowShare)}
                    {delegatesAway && ` · ${shortAddress(row.delegate)} votes for them`}
                  </span>
                </div>
                {account && !sameAddress(row.account, account) && (mode !== VOTING_MODE.Members || units > 0n) && (
                  <button type="button" className={styles.detail__secondary} onClick={() => delegateRef.current?.open(row.account)}>
                    Let them vote for me
                  </button>
                )}
                {isAdmin && mode === VOTING_MODE.Members && row.units > 0n && (
                  <button type="button" className={styles.detail__secondary} onClick={() => membersRef.current?.open('remove', row.account)}>
                    Remove
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <CreateProposalModal
        ref={proposalRef}
        chainId={chainId}
        dao={dao}
        decimals={decimals}
        votes={votes}
        onCreated={(proposalId) => (proposalId ? router.push(`/proposals/${chainId}/${dao.id}/${proposalId}`) : refreshAll())}
      />
      <DelegateModal ref={delegateRef} chainId={chainId} dao={dao} currentDelegate={delegate} onDone={refreshAll} />
      {mode === VOTING_MODE.Staked && <StakeModal ref={stakeRef} chainId={chainId} dao={dao} token={token} staked={units} onDone={refreshAll} />}
      {mode === VOTING_MODE.Members && isAdmin && <MembersModal ref={membersRef} chainId={chainId} dao={dao} onDone={refreshAll} />}
      {isAdmin && <EditGroupModal ref={editRef} chainId={chainId} dao={dao} metadata={metadata} decimals={decimals} onDone={refreshAll} />}
    </div>
  )
}
