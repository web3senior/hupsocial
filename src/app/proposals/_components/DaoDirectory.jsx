'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { useConnection, useReadContract, useReadContracts } from 'wagmi'
import { PAGE_SIZE, VOTING_MODE_OPTIONS, chainNameFor, daoAddressFor, daoChains, formatRelative, sameAddress } from '@/lib/dao'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import daoAbi from '@/abis/HupDao.json'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { BankIcon, PlusIcon } from '@phosphor-icons/react'
import CreateDaoModal from './CreateDaoModal'
import { useIpfsJson } from './useDao'
import styles from './DaoDirectory.module.scss'

const SkeletonCard = () => (
  <li className={styles.directory__item} aria-hidden="true">
    <div className={clsx(styles.directory__card, styles.directory__skeleton)}>
      <div className="shimmer rounded" style={{ width: '44px', height: '44px' }} />
      <div className={styles.directory__cardText}>
        <div className="shimmer rounded" style={{ width: '9rem', height: '15px' }} />
        <div className="shimmer rounded" style={{ width: '80%', height: '12px' }} />
        <div className="shimmer rounded" style={{ width: '50%', height: '12px' }} />
      </div>
    </div>
  </li>
)

function DaoCard({ dao, chainId }) {
  const { data: metadata } = useIpfsJson(dao.metadata)
  const href = `/proposals/${chainId}/${dao.id}`
  const mode = VOTING_MODE_OPTIONS[Number(dao.mode)]
  const name = metadata?.name || `Group #${dao.id}`
  const image = metadata?.image ? resolveStorageImageUrl(metadata.image, { width: 96 }) || metadata.image : null
  const proposals = Number(dao.proposalCount)

  return (
    <li className={styles.directory__item}>
      <article className={styles.directory__card}>
        <div className={styles.directory__avatar} aria-hidden="true">
          {image ? <img src={image} alt="" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}
        </div>

        <div className={styles.directory__cardText}>
          <h3 className={styles.directory__title}>
            <Link href={href} className={styles.directory__titleLink}>
              {name}
            </Link>
          </h3>
          {metadata?.description && <p className={styles.directory__description}>{metadata.description}</p>}
          <div className={styles.directory__meta}>
            <span className={styles.directory__chip}>{mode?.tag ?? 'Group'}</span>
            <span>
              {proposals} {proposals === 1 ? 'proposal' : 'proposals'}
            </span>
            <span>· {chainNameFor(chainId)}</span>
            <span>· Created {formatRelative(dao.createdAt)}</span>
          </div>
        </div>
      </article>
    </li>
  )
}

/**
 * DAO Directory
 * The /dao index: every DAO on the selected network, newest first, read straight from HupDao.
 * There is no indexer behind this list yet, so it pages through getDaos on one chain at a time.
 */
export default function DaoDirectory() {
  const router = useRouter()
  const dialogRef = useRef(null)
  const { address, chain: walletChain } = useConnection()
  const chains = useMemo(() => daoChains(), [])
  const [chainId, setChainId] = useState(() =>
    walletChain?.id && chains.some((chain) => chain.id === walletChain.id) ? walletChain.id : chains[0]?.id ?? null,
  )
  const [scope, setScope] = useState('all')
  const [pages, setPages] = useState(1)

  const daoAddress = daoAddressFor(chainId)
  const { data: nextDaoId, isLoading: isCounting } = useReadContract({
    abi: daoAbi,
    address: daoAddress,
    functionName: 'nextDaoId',
    chainId,
    query: { enabled: Boolean(daoAddress) },
  })
  const total = nextDaoId ? Number(nextDaoId) - 1 : 0

  // Newest first: page i covers the PAGE_SIZE ids just below what page i-1 already shows
  const pageCalls = useMemo(() => {
    const calls = []
    for (let i = 0; i < pages; i++) {
      const end = total - i * PAGE_SIZE
      if (end <= 0) break
      const offset = Math.max(0, end - PAGE_SIZE)
      calls.push({ abi: daoAbi, address: daoAddress, functionName: 'getDaos', args: [BigInt(offset), BigInt(end - offset)], chainId })
    }
    return calls
  }, [pages, total, daoAddress, chainId])

  const { data: pageResults, isLoading: isPaging } = useReadContracts({
    contracts: pageCalls,
    // Keep the pages already on screen while "Load more" fetches the next one
    query: { enabled: pageCalls.length > 0, placeholderData: (previous) => previous },
  })

  const daos = useMemo(() => {
    const rows = (pageResults ?? []).flatMap((result) => (result?.status === 'success' ? [...result.result].reverse() : []))
    return rows.filter((dao) => !dao.hidden && (scope !== 'mine' || sameAddress(dao.admin, address)))
  }, [pageResults, scope, address])

  const isLoading = Boolean(daoAddress) && (isCounting || (pageCalls.length > 0 && isPaging && !pageResults))
  const hasMore = total > pages * PAGE_SIZE

  const scopes = [{ value: 'all', label: 'All' }, ...(address ? [{ value: 'mine', label: 'Mine' }] : [])]

  const handleCreated = (created) => {
    if (created?.daoId) router.push(`/proposals/${created.chainId}/${created.daoId}`)
  }

  return (
    <div className={styles.directory}>
      <header className={styles.directory__intro}>
        <h2>Proposals</h2>
        <p>Start a group, put ideas to a vote, and let someone you trust vote for you when you can’t.</p>
      </header>

      <div className={styles.directory__toolbar}>
        <SegmentedControl options={scopes} value={scope} onChange={setScope} label="Group filter" as="tabs" size="sm" />

        {chains.length > 1 && (
          <select
            className={styles.directory__select}
            value={chainId ?? ''}
            onChange={(e) => {
              setChainId(Number(e.target.value))
              setPages(1)
            }}
            aria-label="Network"
          >
            {chains.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        )}

        <button type="button" className={styles.directory__createButton} onClick={() => dialogRef.current?.open()} disabled={chains.length === 0}>
          <PlusIcon size={14} weight="bold" />
          New group
        </button>
      </div>

      {isLoading && (
        <ul className={styles.directory__list}>
          {Array.from({ length: 3 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </ul>
      )}

      {!isLoading && daos.length === 0 && (
        <div className={styles.directory__empty}>
          <BankIcon size={32} />
          <p>
            {chains.length === 0
              ? 'Proposals aren’t available on any network yet.'
              : scope === 'mine'
                ? 'You haven’t started a group yet.'
                : 'No groups yet. Start the first one.'}
          </p>
          {chains.length > 0 && (
            <button type="button" className={styles.directory__createButton} onClick={() => dialogRef.current?.open()}>
              <PlusIcon size={14} weight="bold" />
              Start a group
            </button>
          )}
        </div>
      )}

      {!isLoading && daos.length > 0 && (
        <ul className={styles.directory__list}>
          {daos.map((dao) => (
            <DaoCard key={`${chainId}-${dao.id}`} dao={dao} chainId={chainId} />
          ))}
        </ul>
      )}

      {hasMore && (
        <button type="button" className={styles.directory__loadMore} onClick={() => setPages(pages + 1)} disabled={isPaging}>
          {isPaging ? 'Loading…' : 'Load more'}
        </button>
      )}

      <CreateDaoModal ref={dialogRef} onCreated={handleCreated} />
    </div>
  )
}
