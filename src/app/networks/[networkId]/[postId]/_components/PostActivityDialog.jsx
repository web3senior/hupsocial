'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import clsx from 'clsx'
import { formatUnits } from 'viem'
import { CaretRightIcon, CoinsIcon, HeartIcon, RepeatIcon } from '@phosphor-icons/react'
import DialogSheet from '@/components/ui/DialogSheet'
import EmptyState from '@/components/ui/EmptyState'
import Shimmer from '@/components/ui/Shimmer'
import Profile from '@/components/Profile'
import { profileFallbackFromRow } from '@/hooks/useProfile'
import { useFollowState } from '@/hooks/useFollowState'
import { toRelativeTime } from '@/lib/dateHelper'
import { getEmbedBodyText } from '@/lib/postEmbed'
import { formatTokenAmount } from './PostTippers'
import styles from './PostActivityDialog.module.scss'

const PAGE_SIZE = 20
const TIPS_LIMIT = 50
const MENTION_LINK = /\[@([^\]\n]{1,48})\]\(\/0x[0-9a-fA-F]{40}\)/g
const compactCount = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

const fetcher = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Activity request failed: ${res.status}`)
  return res.json()
}

/**
 * Threads' "Post activity" sheet: the post in brief, its likes / tips / reposts as summary rows,
 * and the people behind them with a Follow button each. Likes and Tips double as filters; reposts
 * only count, since nothing lists reposters yet. Fetches nothing until first opened.
 * @param {Object} props
 * @param {Object} props.post The thread root (a repost already resolved to its original).
 * @param {string|number} props.networkId
 */
const PostActivityDialog = forwardRef(function PostActivityDialog({ post, networkId }, ref) {
  const dialogRef = useRef(null)
  const sentinelRef = useRef(null)
  const [opened, setOpened] = useState(false)
  // null = everyone; 'like' / 'tip' narrows the list to that kind
  const [filter, setFilter] = useState(null)

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setOpened(true)
        dialogRef.current?.open()
      },
      close: () => dialogRef.current?.close(),
    }),
    []
  )

  const base = `/api/v1/networks/${networkId}/${post.id}`

  const getLikesKey = (pageIndex, previousPage) => {
    if (!opened) return null
    if (previousPage && !previousPage.nextPage) return null
    return `${base}/likes?page=${pageIndex + 1}&limit=${PAGE_SIZE}`
  }
  const { data: likePages, error: likesError, isValidating, setSize } = useSWRInfinite(getLikesKey, fetcher, {
    revalidateFirstPage: false,
    revalidateOnFocus: false,
  })
  const { data: tipsBody, error: tipsError } = useSWR(opened ? `${base}/tips?limit=${TIPS_LIMIT}` : null, fetcher, {
    revalidateOnFocus: false,
  })

  // The row's own counts until the lists answer, so the summary is right before anything loads
  const likesTotal = likePages?.[0]?.meta?.total ?? (Number(post.total_likes) || 0)
  const tipsTotal = tipsBody?.meta?.total ?? (Number(post.total_tips) || 0)
  const repostsTotal = Number(post.total_reposts) || 0

  // One timeline of who did what, newest first. Likes carry unix seconds, tips a datetime.
  const people = useMemo(() => {
    const likes = (likePages ?? []).flatMap((page) => page?.data ?? []).map((row) => ({
      kind: 'like',
      key: `like-${row.wallet_address.toLowerCase()}`,
      row,
      at: Number(row.liked_ts) || 0,
    }))
    const tips = (tipsBody?.data ?? []).map((row) => ({
      kind: 'tip',
      key: `tip-${row.tx_hash}-${row.wallet_address}`,
      row,
      at: Math.floor(new Date(String(row.tipped_at).replace(' ', 'T')).getTime() / 1000) || 0,
    }))

    // Offset pages shift when a like lands between two fetches, repeating a row across the seam
    const seen = new Set()
    return [...likes, ...tips]
      .filter((entry) => (filter ? entry.kind === filter : true))
      .filter((entry) => (seen.has(entry.key) ? false : seen.add(entry.key)))
      .sort((a, b) => b.at - a.at)
  }, [likePages, tipsBody, filter])

  const hasMoreLikes = Boolean(likePages?.[likePages.length - 1]?.nextPage) && filter !== 'tip'
  const isFirstLoad = opened && !likePages && !likesError

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMoreLikes) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isValidating) setSize((size) => size + 1)
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMoreLikes, isValidating, setSize])

  const close = () => dialogRef.current?.close()

  // A profile link navigates away; the sheet must not stay open over the next page
  const closeOnLink = (event) => {
    if (event.target.closest('a')) close()
  }

  const toggleFilter = (kind) => setFilter((current) => (current === kind ? null : kind))

  const preview = post.content?.encrypted ? '' : getEmbedBodyText(post).replace(MENTION_LINK, '@$1').trim()

  const countMeta = (count, actionable) => (
    <span className={styles.activity__count}>
      {compactCount.format(count)}
      {actionable && <CaretRightIcon size={16} aria-hidden="true" />}
    </span>
  )

  return (
    <DialogSheet ref={dialogRef} lightDismiss aria-label="Post activity" onClickCapture={closeOnLink} className={styles.activity}>
      <DialogSheet.Header title="Post activity" onClose={close} />

      <DialogSheet.Body className={styles.activity__body}>
        <article className={styles.activity__preview}>
          <Profile size={24} creator={post.wallet_address} createdAt={post.created_at} networkId={networkId} fallback={profileFallbackFromRow(post)} hoverCard={false} fingerprint={false} />
          {preview && <p className={styles.activity__previewText}>{preview}</p>}
        </article>

        <div className={styles.activity__summary}>
          <DialogSheet.Row
            className={styles.activity__stat}
            icon={<HeartIcon />}
            name="Likes"
            meta={countMeta(likesTotal, likesTotal > 0)}
            onClick={likesTotal > 0 ? () => toggleFilter('like') : undefined}
            active={filter === 'like'}
            aria-pressed={likesTotal > 0 ? filter === 'like' : undefined}
          />
          <DialogSheet.Row
            className={styles.activity__stat}
            icon={<CoinsIcon />}
            name="Tips"
            meta={countMeta(tipsTotal, tipsTotal > 0)}
            onClick={tipsTotal > 0 ? () => toggleFilter('tip') : undefined}
            active={filter === 'tip'}
            aria-pressed={tipsTotal > 0 ? filter === 'tip' : undefined}
          />
          <DialogSheet.Row className={styles.activity__stat} icon={<RepeatIcon />} name="Reposts" meta={countMeta(repostsTotal, false)} />
        </div>

        {people.length > 0 && (
          <ul className={styles.activity__people}>
            {people.map((entry) => (
              <ActivityPerson key={entry.key} entry={entry} networkId={networkId} />
            ))}
          </ul>
        )}

        {(isFirstLoad || (hasMoreLikes && isValidating)) && (
          <div className={styles.activity__loading}>
            <Shimmer className={styles.activity__skeleton} />
            <Shimmer className={styles.activity__skeleton} />
          </div>
        )}

        {likesError && tipsError && people.length === 0 && (
          <EmptyState size="sm" align="center">
            Couldn&rsquo;t load activity.
          </EmptyState>
        )}

        {likePages && tipsBody && people.length === 0 && (
          <EmptyState size="sm" align="center">
            No activity yet.
          </EmptyState>
        )}

        {hasMoreLikes && <div ref={sentinelRef} className={styles.activity__sentinel} />}
      </DialogSheet.Body>
    </DialogSheet>
  )
})

export default PostActivityDialog

/** One person in the list: who, what they did (the badge on their picture), and Follow. */
function ActivityPerson({ entry, networkId }) {
  const { row, kind } = entry
  const tipLabel =
    kind === 'tip' && row.amount != null
      ? `+${formatTokenAmount(Number(formatUnits(BigInt(row.amount), row.decimals ?? 18)))} ${row.symbol && row.symbol !== 'tokens' ? row.symbol : ''}`.trim()
      : null

  return (
    <li className={styles.person}>
      <div className={styles.person__identity}>
        <Profile
          variant="fullWithoutTime"
          creator={row.wallet_address}
          networkId={networkId}
          fallback={profileFallbackFromRow(row)}
          fingerprint={false}
          className={styles.person__profile}
        />
        <span className={clsx(styles.person__badge, styles[`person__badge--${kind}`])} aria-label={kind === 'like' ? 'Liked' : 'Tipped'}>
          {kind === 'like' ? <HeartIcon size={10} weight="fill" /> : <CoinsIcon size={10} weight="fill" />}
        </span>
      </div>

      <span className={styles.person__meta}>
        {tipLabel && <span className={styles.person__tip}>{tipLabel}</span>}
        <span suppressHydrationWarning>{toRelativeTime(entry.at)}</span>
      </span>

      <FollowToggle target={row.wallet_address} networkId={networkId} />
    </li>
  )
}

function FollowToggle({ target, networkId }) {
  const { followerSystemAddress, isSelf, isFollowing, isLoading, isBusy, isSigning, toggle } = useFollowState(target, networkId)

  // Nothing to follow yourself with, and nothing to follow on a chain without the system
  if (isSelf || !followerSystemAddress) return null
  if (isLoading) return <Shimmer className={styles.person__followShimmer} />

  return (
    <button
      type="button"
      className={clsx(styles.person__follow, isFollowing && styles['person__follow--following'])}
      onClick={toggle}
      disabled={isBusy}
    >
      {isSigning ? 'Confirm…' : isBusy ? '…' : isFollowing ? 'Following' : 'Follow'}
    </button>
  )
}
