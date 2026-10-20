'use client'

import Link from 'next/link'
import clsx from 'clsx'
import { LockSimpleIcon, UsersIcon } from '@phosphor-icons/react'
import { appChains } from '@/config/contracts'
import { getCommunityCategory } from '@/config/communityCategories'
import { chainIconFor, networkColorStyle } from '@/lib/networkColors'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import Profile from '@/components/Profile'
import Shimmer from '@/components/ui/Shimmer'
import { ADMISSION_OPTIONS } from '../membershipOptions'
import { coverObjectPosition, coverPositionFrom } from '@/lib/coverPosition'
import styles from './CommunityTile.module.scss'

const memberFormat = new Intl.NumberFormat(undefined, { notation: 'compact' })
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' })
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

const AGE_UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]

const ageLabel = (dateValue) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(dateValue).getTime()) / 1000))
  const [unit, size] = AGE_UNITS.find(([, unitSeconds]) => seconds >= unitSeconds) ?? AGE_UNITS[AGE_UNITS.length - 1]
  return relativeFormat.format(-Math.max(1, Math.floor(seconds / size)), unit)
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The search term, marked wherever it occurs in `text` — case-insensitive, like the API's LIKE. */
function Highlight({ text, term }) {
  if (!term || !text) return text
  const parts = text.split(new RegExp(`(${escapeRegExp(term)})`, 'gi'))
  return parts.map((part, index) =>
    part.toLowerCase() === term.toLowerCase() ? (
      <mark key={index} className={styles.tile__mark}>
        {part}
      </mark>
    ) : (
      part
    )
  )
}

/**
 * One community in the directory grid, painted from its indexed row alone — no RPC reads. The
 * tile is a way in, not a control panel: joining, invites and moderation live on the community
 * page, which runs the live onchain card.
 *
 * @param {object} props.row The indexed /api/v1/networks/communities row.
 * @param {object} props.metadata The row's metadata, reshaped by metadataFromRow.
 * @param {Array} props.categories Category list from useCommunityCategories.
 * @param {string} [props.highlight] Active search term, marked in the name and summary.
 */
export default function CommunityTile({ row, metadata, categories, highlight = '' }) {
  const chainId = Number(row.network_id)
  const id = Number(row.id)
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const chainIcon = chainIconFor(chainInfo)

  const name = metadata.name || `Community #${id}`
  const summary = metadata.summary || metadata.description
  const coverUrl = metadata['cover url'] ? resolveStorageImageUrl(metadata['cover url'], { width: 600 }) || metadata['cover url'] : null
  const logoUrl = metadata['logo url'] ? resolveStorageImageUrl(metadata['logo url'], { width: 120 }) || metadata['logo url'] : null

  const memberCount = Number(row.member_count ?? 0)
  const admission = ADMISSION_OPTIONS[Number(row.membership_type)]
  const isPrivate = Boolean(Number(row.is_encrypted))
  const isMember = Boolean(Number(row.viewer?.is_member))
  const isInvited = !isMember && Boolean(Number(row.viewer?.is_invited))
  const isPending = !isMember && Boolean(Number(row.viewer?.is_pending))
  const standing = isMember ? 'Joined' : isInvited ? 'Invited' : isPending ? 'Requested' : null

  const tooltip = [name, chainInfo?.name, row.created_at ? `created ${dateFormat.format(new Date(row.created_at))}` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    // Colours come from the community's chain, not the connected wallet's
    <li className={styles.tile} style={networkColorStyle(chainInfo)}>
      <Link href={`/communities/${chainId}/${id}`} className={styles.tile__link} title={tooltip}>
        <span className={styles.tile__media}>
          {coverUrl ? (
            <img
              src={coverUrl}
              alt=""
              loading="lazy"
              className={styles.tile__cover}
              style={{ objectPosition: coverObjectPosition(coverPositionFrom(metadata)) }}
            />
          ) : (
            <span className={styles.tile__coverFallback} aria-hidden="true" />
          )}

          {(standing || isPrivate) && (
            <span className={styles.tile__badges}>
              {isPrivate && (
                <span className={styles.tile__chip} title="Post content is end-to-end encrypted for members">
                  <LockSimpleIcon size={12} weight="fill" aria-hidden="true" />
                  Private
                </span>
              )}
              {standing && <span className={clsx(styles.tile__chip, styles['tile__chip--standing'])}>{standing}</span>}
            </span>
          )}

          {logoUrl ? (
            <img src={logoUrl} alt="" loading="lazy" className={styles.tile__logo} />
          ) : (
            <span className={clsx(styles.tile__logo, styles['tile__logo--placeholder'])} aria-hidden="true">
              {name.charAt(0).toUpperCase()}
            </span>
          )}
        </span>

        <span className={styles.tile__info}>
          <span className={styles.tile__nameRow}>
            <strong className={styles.tile__name}>
              <Highlight text={name} term={highlight} />
            </strong>
            <span className={styles.tile__category}>{getCommunityCategory(metadata.category, categories).label}</span>
          </span>

          <span className={styles.tile__summary}>{summary ? <Highlight text={summary} term={highlight} /> : 'No description yet.'}</span>

          <span className={styles.tile__stats}>
            <b>
              <UsersIcon size={14} weight="bold" aria-hidden="true" />
              {memberFormat.format(memberCount)} {memberCount === 1 ? 'member' : 'members'}
            </b>
            {admission && <em>{admission.tag}</em>}
          </span>
        </span>
      </Link>

      {/* Rides over the cover, outside the tile's link */}
      <span className={styles.tile__overlay}>
        <span className={clsx(styles.tile__chip, styles['tile__chip--age'])}>
          {chainIcon && <img src={chainIcon} alt="" loading="lazy" />}
          {row.created_at ? ageLabel(row.created_at) : chainInfo?.name}
        </span>

        {/* The one part of the overlay that answers a pointer — the creator's profile card */}
        {row.creator_address && (
          <span className={styles.tile__creator}>
            <Profile creator={row.creator_address} networkId={chainId} variant="imageOnly" size={26} fingerprint={false} />
          </span>
        )}
      </span>
    </li>
  )
}

/** Placeholder tile at the populated tile's proportions, so the grid doesn't jump on arrival. */
export function CommunityTileSkeleton() {
  return (
    <li className={clsx(styles.tile, styles['tile--skeleton'])} aria-hidden="true">
      <Shimmer className={styles.tile__skeletonMedia} />
      <div className={styles.tile__info}>
        <Shimmer className={clsx(styles.tile__skeletonLine, styles['tile__skeletonLine--title'])} />
        <Shimmer className={styles.tile__skeletonLine} />
        <Shimmer className={clsx(styles.tile__skeletonLine, styles['tile__skeletonLine--short'])} />
      </div>
    </li>
  )
}
