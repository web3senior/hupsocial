'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef } from 'react'
import useSWR from 'swr'
import clsx from 'clsx'
import { useProfile } from '@/hooks/useProfile'
import { getPostById } from '@/lib/api'
import { toRelativeTime } from '@/lib/dateHelper'
import { resolveIPFSImageUrl } from '@/lib/storageHelper'
import { amountOf, hrefOf, previewPostIdOf, quotedSubjectOf } from './notificationModel'
import styles from './NotificationRow.module.scss'

const MAX_AVATARS = 3
const READ_DELAY_MS = 1500
const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

const postFetcher = ([, networkId, postId]) =>
  getPostById(networkId, postId).then((response) => (Array.isArray(response?.data) ? response.data[0] : response?.data) || null)

export default function NotificationRow({ group, viewerAddress, onRead }) {
  const router = useRouter()
  const rowRef = useRef(null)
  const hasMarkedRead = useRef(false)

  const { meta, latest, actors, unreadIds } = group
  const Icon = meta.icon
  const href = useMemo(() => hrefOf(group), [group])
  const isUnread = unreadIds.length > 0

  // Your own activity needs no avatar — the row already says "You …", and a strip of your own
  // profile picture down the feed reads as noise.
  const isSelfOnly =
    actors.length <= 1 && (!actors[0] || actors[0].toLowerCase() === viewerAddress?.toLowerCase())

  // One fetch per group — SWR dedupes rows that point at the same post, so a burst of likes on the
  // same post costs a single request instead of one per notification.
  const previewPostId = previewPostIdOf(group)
  const { data: post } = useSWR(
    previewPostId && group.networkId ? ['notification-post', group.networkId, previewPostId] : null,
    postFetcher,
    // Deleted posts answer 404 forever — retrying them would burn requests for no preview.
    { revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true },
  )

  const preview = useMemo(() => {
    if (post) {
      const elements = post.content?.elements
      return {
        text: elements?.length ? elements[0]?.data?.text || '' : typeof post.content === 'string' ? post.content : '',
        media: elements?.length > 1 ? firstImageUrl(elements[1]?.data?.items) : null,
      }
    }

    // Rows that fall back to the stored message already contain their subject — quoting it again
    // underneath would just repeat the line.
    const subject = meta.verb ? quotedSubjectOf(latest.message) : null
    return subject ? { text: subject, media: null } : null
  }, [post, latest.message, meta.verb])

  // Same reasoning: "You bought an NFT for 0.00001 MON" needs no 0.00001 MON pill beside it.
  const amount = useMemo(() => (meta.verb ? amountOf(latest) : null), [latest, meta.verb])

  useEffect(() => {
    if (!isUnread || !onRead) return

    const element = rowRef.current
    if (!element) return

    let readTimer = null
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasMarkedRead.current) {
          readTimer = setTimeout(() => {
            hasMarkedRead.current = true
            onRead(unreadIds)
            observer.disconnect()
          }, READ_DELAY_MS)
          return
        }

        clearTimeout(readTimer)
        readTimer = null
      },
      { threshold: 0.5 },
    )

    observer.observe(element)
    return () => {
      observer.disconnect()
      clearTimeout(readTimer)
    }
  }, [isUnread, onRead, unreadIds])

  // The row is a link in behaviour but not in markup: actor avatars and names are real anchors, and
  // an <a> can never nest inside another <a>.
  const openTarget = () => href && router.push(href)
  const handleKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openTarget()
  }

  return (
    <article
      ref={rowRef}
      className={clsx(styles.row, isUnread && styles['row--unread'], href && styles['row--clickable'])}
      data-tone={meta.tone}
      role={href ? 'link' : undefined}
      tabIndex={href ? 0 : undefined}
      onClick={openTarget}
      onKeyDown={href ? handleKeyDown : undefined}
    >
      <span className={styles.row__icon}>
        <Icon size={22} weight={meta.weight || 'regular'} />
      </span>

      <div className={styles.row__body}>
        {actors.length > 0 && !isSelfOnly && (
          <div className={styles.row__actors}>
            {actors.slice(0, MAX_AVATARS).map((actor) => (
              <ActorAvatar key={actor} address={actor} />
            ))}
          </div>
        )}

        <p className={styles.row__sentence}>
          <Sentence group={group} />
          <span className={styles.row__time}> · {toRelativeTime(latest.created_at)}</span>
        </p>

        {(preview?.text || preview?.media) && (
          <div className={styles.row__preview}>
            {preview.text && <p className={styles.row__previewText}>{preview.text}</p>}
            {preview.media && (
              <span className={styles.row__thumb}>
                <Image src={preview.media} alt="" width={96} height={96} unoptimized />
              </span>
            )}
          </div>
        )}

        {amount && <span className={styles.row__amount}>{amount}</span>}
      </div>

      {isUnread && <span className={styles.row__dot} aria-label="Unread" />}
    </article>
  )
}

/**
 * "<Alice> and 2 others liked your post". Without a verb for the action type — your own activity,
 * or a type the app does not know yet — the indexer's own sentence is shown instead.
 */
function Sentence({ group }) {
  const { meta, actors, latest } = group
  const [firstActor] = actors
  const { profile } = useProfile(meta.verb ? firstActor : null)

  if (!meta.verb || !firstActor) {
    return <span className={styles.row__title}>{latest.message || latest.title}</span>
  }

  const others = actors.length - 1
  const name = profile?.fullName || profile?.name || `${firstActor.slice(0, 6)}…${firstActor.slice(-4)}`

  return (
    <>
      <Link href={`/${firstActor}`} className={styles.row__actorName} onClick={(event) => event.stopPropagation()}>
        {name}
      </Link>
      {others > 0 && <span className={styles.row__others}> and {compactNumber.format(others)} {others === 1 ? 'other' : 'others'}</span>}
      <span className={styles.row__verb}> {meta.verb}</span>
    </>
  )
}

function ActorAvatar({ address }) {
  const { profile } = useProfile(address)

  if (!profile) return <span className={clsx(styles.row__avatar, styles['row__avatar--pending'])} />

  return (
    <Link href={`/${address}`} className={styles.row__avatar} onClick={(event) => event.stopPropagation()} title={profile.fullName || profile.name}>
      <Image src={profile.profileImage} alt={profile.name} width={32} height={32} unoptimized />
    </Link>
  )
}

// Mirrors Gallery's resolver, narrowed to the single still image a preview can show.
function firstImageUrl(items) {
  const item = items?.find((candidate) => candidate?.type !== 'video' && candidate?.type !== 'audio')
  if (!item?.cid) return null
  if (item.storage === '0G') return `/api/0g/file?hash=${item.cid}`
  if (item.cid.startsWith('http')) return item.cid

  return resolveIPFSImageUrl(item.cid, { width: 192 })
}
