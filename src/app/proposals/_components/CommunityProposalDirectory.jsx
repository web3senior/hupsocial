'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWRInfinite from 'swr/infinite'
import { useConnection } from 'wagmi'
import { CONTRACTS, appChains } from '@/config/contracts'
import { communityProposalsPath } from '@/lib/communityGovernance'
import { chainNameFor } from '@/lib/communityProposal'
import { Spinner, ContentSpinner } from '@/components/Loading'
import styles from './CommunityProposalDirectory.module.scss'

const communityContracts = appChains
  .filter((chain) => CONTRACTS[`chain${chain.id}`]?.community)
  .map((chain) => `${chain.id}:${CONTRACTS[`chain${chain.id}`].community}`)
  .join(',')

export default function CommunityProposalDirectory() {
  const { address } = useConnection()
  const [search, setSearch] = useState('')
  const { data, error, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite(
    (index, previous) => {
      if (!communityContracts || (previous && !previous.nextPage)) return null
      const query = new URLSearchParams({ contracts: communityContracts, page: String(index + 1), limit: '20', search })
      if (address) query.set('viewer_address', address)
      return `/api/v1/networks/communities?${query}`
    },
    async (url) => {
      const response = await fetch(url)
      const body = await response.json()
      if (!response.ok || !body.success) throw new Error('Could not load communities')
      return body
    },
  )
  const communities = data?.flatMap((page) => page.data) ?? []

  return (
    <div className={styles.directory}>
      <header className={styles.directory__intro}>
        <h2>Community proposals</h2>
        <p>Choose your community to propose ideas, vote, and manage its treasury. Every member gets one vote.</p>
      </header>
      <div className={styles.directory__toolbar}>
        <input className={styles.directory__select} aria-label="Search communities" placeholder="Search communities" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Link href="/communities" className={styles.directory__createButton}>Browse communities</Link>
      </div>
      {isLoading && <ContentSpinner />}
      {error && <div className={styles.directory__empty}><p>Could not load communities.</p><button type="button" onClick={() => mutate()}>Try again</button></div>}
      {!isLoading && !error && communities.length === 0 && <p>No communities found.</p>}
      <ul className={styles.directory__list}>
        {communities.map((community) => (
          <li key={`${community.network_id}:${community.contract_address}:${community.id}`} className={styles.directory__item}>
            <article className={styles.directory__card}>
              <div className={styles.directory__cardText}>
                <h3 className={styles.directory__title}>
                  <Link href={communityProposalsPath(community.network_id, community.id)} className={styles.directory__titleLink}>{community.name || `Community #${community.id}`}</Link>
                </h3>
                {community.summary && <p className={styles.directory__description}>{community.summary}</p>}
                <div className={styles.directory__meta}><span>{chainNameFor(community.network_id)}</span><span>Proposals & treasury</span></div>
              </div>
            </article>
          </li>
        ))}
      </ul>
      {data?.at(-1)?.nextPage && <button type="button" className={styles.directory__loadMore} disabled={isValidating} onClick={() => setSize(size + 1)}>{isValidating ? <><Spinner size={16} color="currentColor" /> Loading…</> : 'Load more'}</button>}
    </div>
  )
}
