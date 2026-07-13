'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeftIcon, CalendarBlankIcon, UserIcon, UsersIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import { toRelativeTime } from '@/lib/dateHelper'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { CommunityCard } from '../../../page'
import styles from './CommunityDetails.module.scss'

const membershipLabels = ['Public', 'Request-Based', 'Private', 'NFT-Gated', 'Token-Gated']
const typeLabels = ['Discussion', 'Broadcast']

export default function CommunityDetails({ networkId, communityId, initialName }) {
  const params = useParams()
  const resolvedNetworkId = networkId || params.networkId
  const resolvedCommunityId = communityId || params.communityId

  const [community, setCommunity] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/networks/communities/${resolvedCommunityId}?network_id=${resolvedNetworkId}`)
      .then((r) => r.json())
      .then((body) => { if (!cancelled && body?.data) setCommunity(body.data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [resolvedNetworkId, resolvedCommunityId])

  const name = community?.name || initialName || `Community #${resolvedCommunityId}`

  return (
    <div className={styles.details}>
      <PageTitle name={name} />

      <div className={`__container ${styles.details__container}`} data-width="medium">
        <Link href={`/communities`} className={styles.details__back}>
          <ArrowLeftIcon size={16} />
          Back to Communities
        </Link>

        {!community && <div className={clsx('shimmer', styles.details__shimmer)} />}

        {community && (
          <div className={`${styles.details__header} animate fade`}>
            {community.cover_url ? (
              <img src={resolveStorageImageUrl(community.cover_url, { width: 1200 })} alt="" className={styles.details__cover} />
            ) : (
              <div className={styles.details__cover} aria-hidden="true" />
            )}

            {community.logo_url ? (
              <img
                src={resolveStorageImageUrl(community.logo_url, { width: 400 })}
                alt={community.name}
                className={styles.details__logo}
              />
            ) : (
              <div className={clsx(styles.details__logo, styles['details__logo--placeholder'])} aria-hidden="true">
                {(community.name || '#').charAt(0).toUpperCase()}
              </div>
            )}

            <div className={styles.details__titleGroup}>
              <h1 className={styles.details__title}>{community.name}</h1>
              {community.summary && <p className={styles.details__summary}>{community.summary}</p>}
            </div>

            <div className={styles.details__tags}>
              <span className={styles.details__tag}>{membershipLabels[community.membership_type]}</span>
              {community.community_type !== null && community.community_type !== undefined && (
                <span className={styles.details__tag}>{typeLabels[community.community_type]}</span>
              )}
              {!community.is_active && (
                <span className={styles.details__tag} title="This space is archived — no new posts or joins until reactivated">
                  Archived
                </span>
              )}
              <span className={clsx(styles.details__tag, styles['details__tag--muted'])}>
                <UsersIcon size={13} />
                {community.member_count} {Number(community.member_count) === 1 ? 'member' : 'members'}
              </span>
            </div>

            {community.description && (
              <p className={styles.details__description}>{community.description}</p>
            )}

            <div className={styles.details__meta}>
              <span className={styles.details__metaItem}>
                <UserIcon size={13} />
                By{' '}
                <Link href={`/${community.creator_address}`} className={styles.details__creatorLink}>
                  {community.creator_address?.slice(0, 6)}...{community.creator_address?.slice(-4)}
                </Link>
              </span>
              <span className={styles.details__metaItem}>
                <CalendarBlankIcon size={13} />
                Created {toRelativeTime(community.created_at)}
              </span>
            </div>
          </div>
        )}

        <CommunityCard id={Number(resolvedCommunityId)} networkId={Number(resolvedNetworkId)} hideHeader />
      </div>
    </div>
  )
}
