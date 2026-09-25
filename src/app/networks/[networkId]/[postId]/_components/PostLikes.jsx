'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import Profile from '@/components/Profile'
import DialogSheet from '@/components/ui/DialogSheet'
import EmptyState from '@/components/ui/EmptyState'
import Shimmer from '@/components/ui/Shimmer'
import { profileFallbackFromRow } from '@/hooks/useProfile'
import { toRelativeTime } from '@/lib/dateHelper'
import styles from './PostLikes.module.scss'

const FACE_COUNT = 3
const PAGE_SIZE = 20

const fetcher = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Likes request failed: ${res.status}`)
  return res.json()
}

const formatCount = (count) => new Intl.NumberFormat('en', { notation: 'compact' }).format(count)

// Offset pages shift when a like lands between two of them, repeating a row across the seam
const uniqueByAddress = (rows) => {
  const seen = new Set()
  return rows.filter((row) => {
    const key = row.wallet_address.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * "Liked by" strip under a post: the latest likers' faces and the count, which opens the full
 * list. Renders nothing until the post has a like.
 */
export default function PostLikes({ networkId, postId }) {
  const dialogRef = useRef(null)
  const { data } = useSWR(`/api/v1/networks/${networkId}/${postId}/likes?limit=${FACE_COUNT}`, fetcher)

  const total = data?.meta?.total ?? 0
  if (!data?.success || total === 0) return null

  return (
    <section className={styles.likes}>
      <div className={styles.likes__faces}>
        {uniqueByAddress(data.data).map((row) => (
          <Profile
            key={row.wallet_address}
            variant="imageOnly"
            size={24}
            creator={row.wallet_address}
            networkId={networkId}
            fallback={profileFallbackFromRow(row)}
            fingerprint={false}
            className={styles.likes__face}
          />
        ))}
      </div>

      <button type="button" className={styles.likes__open} onClick={() => dialogRef.current?.open()}>
        Liked by <strong>{formatCount(total)}</strong> {total === 1 ? 'person' : 'people'}
      </button>

      <LikersDialog ref={dialogRef} networkId={networkId} postId={postId} />
    </section>
  )
}

const LikersDialog = forwardRef(function LikersDialog({ networkId, postId }, ref) {
  const dialogRef = useRef(null)
  const sentinelRef = useRef(null)
  const [opened, setOpened] = useState(false)

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

  const getKey = (pageIndex, previousPage) => {
    if (!opened) return null
    if (previousPage && !previousPage.nextPage) return null
    return `/api/v1/networks/${networkId}/${postId}/likes?page=${pageIndex + 1}&limit=${PAGE_SIZE}`
  }

  const { data: pages, error, isValidating, setSize } = useSWRInfinite(getKey, fetcher, {
    revalidateFirstPage: false,
    revalidateOnFocus: false,
  })

  const likers = useMemo(() => uniqueByAddress((pages ?? []).flatMap((page) => page?.data ?? [])), [pages])
  const hasMore = Boolean(pages?.[pages.length - 1]?.nextPage)
  const isFirstLoad = opened && !pages && !error

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isValidating) setSize((size) => size + 1)
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, isValidating, setSize])

  const close = () => dialogRef.current?.close()

  // A profile link navigates away; the dialog must not stay open over the next page
  const closeOnLink = (event) => {
    if (event.target.closest('a')) close()
  }

  return (
    <DialogSheet ref={dialogRef} lightDismiss aria-label="Likes" onClickCapture={closeOnLink}>
      <DialogSheet.Header title="Likes" onClose={close} />

      <DialogSheet.Body className={styles.likers}>
        {likers.length > 0 && (
          <DialogSheet.Group>
            {likers.map((row) => (
              <DialogSheet.Row key={row.wallet_address} meta={toRelativeTime(row.liked_ts)}>
                <Profile
                  variant="fullWithoutTime"
                  creator={row.wallet_address}
                  networkId={networkId}
                  fallback={profileFallbackFromRow(row)}
                  className={styles.likers__profile}
                />
              </DialogSheet.Row>
            ))}
          </DialogSheet.Group>
        )}

        {(isFirstLoad || (hasMore && isValidating)) && (
          <div className={styles.likers__loading}>
            <Shimmer className={styles.likers__skeleton} />
            <Shimmer className={styles.likers__skeleton} />
          </div>
        )}

        {error && likers.length === 0 && (
          <EmptyState size="sm" align="center">
            Couldn&rsquo;t load likes.
          </EmptyState>
        )}

        {pages && !error && likers.length === 0 && (
          <EmptyState size="sm" align="center">
            No likes yet.
          </EmptyState>
        )}

        {hasMore && <div ref={sentinelRef} className={styles.likers__sentinel} />}
      </DialogSheet.Body>
    </DialogSheet>
  )
})
