'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChatCircleIcon } from '@phosphor-icons/react'
import { PostCard } from '@/components/Post'
import CommentSkeletonList from '@/components/ui/CommentSkeleton'
import { usePostStore } from '@/stores/usePostStore'
import { useCommentsCacheStore, commentsCacheKey, commentsThreadKey } from '@/stores/useCommentsCacheStore'
import { DEFAULT_COMMENTS_SORT } from '@/lib/commentsRequest'
import { rememberCardPointerDown, isTextSelectionDrag } from '@/lib/cardClick'
import styles from './comments.module.scss'

// Snapshot of a thread from the session cache, shaped for this component's state.
function readThread(key, viewer) {
  const cached = useCommentsCacheStore.getState().readCommentsCache(key, viewer)
  return { key, list: cached?.list ?? [], isLoading: !cached, isFresh: !!cached?.isFresh }
}

// Identifies the exact data currently painted. The nonce rides along so that invalidating a
// thread (a reply of the viewer's just landed in it) reads as "different data" and sends the
// fetch effect back out, without anything having to reach into a ref mid-render.
const appliedKey = (cacheKey, viewer, nonce) => `${cacheKey}|${viewer}|${nonce}`

/**
 * A post's replies, Threads-style: each reply carries its own latest answer nested under a
 * connector (PostCard), with a way into the rest when there are more.
 * @param {Object} props
 * @param {'top'|'latest'} [props.sort] Order of the replies; each order is cached on its own.
 * @param {string|null} [props.threadAuthor] Wallet that started the thread, tagged "Author".
 * @param {Array<string|number>|null} [props.hiddenIds] Replies already drawn elsewhere on the page
 *   (the author's own thread, under the post) and left out of the list.
 */
export default function Comments({ networkId, postId, viewerAddress, sort = DEFAULT_COMMENTS_SORT, threadAuthor = null, hiddenIds = null }) {
  const router = useRouter()
  const setCurrentPost = usePostStore((state) => state.setCurrentPost)
  const fetchComments = useCommentsCacheStore((state) => state.fetchComments)

  const cacheKey = commentsCacheKey(networkId, postId, sort)
  const viewer = viewerAddress ?? null
  // Kept per thread, not per order: a reply landing makes every ordering stale
  const threadNonce = useCommentsCacheStore((state) => state.threadNonces[commentsThreadKey(networkId, postId)] ?? 0)

  // Thread from an earlier visit this session, if any. Safe to read in an
  // initializer: the store is in-memory, so it's always empty during SSR
  // hydration and cache hits only ever happen on client-side remounts.
  const [thread, setThread] = useState(() => readThread(cacheKey, viewer))

  // Params whose data is already on screen. Set on data application, never on
  // fetch start, so StrictMode's double-run can't mark an in-flight request as
  // done. `isFresh` is read only here, to seed it.
  const appliedRef = useRef(thread.isFresh ? appliedKey(cacheKey, viewer, threadNonce) : null)

  // Navigating comment → parent keeps this component mounted with a new postId,
  // so the thread has to swap during render: an effect would paint the previous
  // post's replies under the new one for a frame.
  if (thread.key !== cacheKey) {
    const next = readThread(cacheKey, viewer)
    appliedRef.current = next.isFresh ? appliedKey(cacheKey, viewer, threadNonce) : null
    setThread(next)
  }

  useEffect(() => {
    const params = appliedKey(cacheKey, viewer, threadNonce)
    // Already applied — a snapshot fresh enough to trust, or a fetch this effect
    // already finished. Skipping here is what stops every visit from re-requesting
    // a thread the session already has.
    if (appliedRef.current === params) return

    let cancelled = false

    fetchComments(networkId, postId, viewer, sort)
      .then((list) => {
        if (cancelled) return
        appliedRef.current = params
        setThread({ key: cacheKey, list, isLoading: false, isFresh: true })
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to load comments', err)
        // A failed background revalidation leaves the cached thread on screen;
        // only a cold load has to drop out of the skeleton.
        setThread((prev) => (prev.isLoading ? { ...prev, isLoading: false } : prev))
      })

    return () => {
      cancelled = true
    }
  }, [networkId, postId, viewer, sort, cacheKey, fetchComments, threadNonce])

  if (thread.isLoading) return <CommentSkeletonList count={3} />

  // Filtered at render, not in the cache: the cached thread stays whole for every other reader
  const hidden = hiddenIds?.length ? new Set(hiddenIds.map(String)) : null
  const list = hidden ? thread.list.filter((comment) => !hidden.has(String(comment.id))) : thread.list

  return (
    <div className={styles.commentsList}>
      {list.length === 0 ? (
        <div className={styles.commentsList__empty}>
          <ChatCircleIcon className={styles.commentsList__emptyIcon} size={28} aria-hidden="true" />
          <p className={styles.commentsList__emptyText}>No replies yet</p>
        </div>
      ) : (
        list.map((comment, i) => {
          const openComment = () => {
            // Seed the store so the detail route paints this comment instantly
            setCurrentPost(comment)
            router.push(`/networks/${networkId}/${comment.id}`)
          }
          // PostCard already shows one answer under the reply; the rest are behind "Show replies"
          const hiddenReplies = Number(comment.total_comments || 0) - 1

          return (
            <section key={comment.id} className={styles.commentsList__item}
             onPointerDown={rememberCardPointerDown}
             onClick={(e) => {
               if (isTextSelectionDrag(e)) return
               openComment()
             }}
             onMouseEnter={() => router.prefetch(`/networks/${networkId}/${comment.id}`)}
             onTouchStart={() => router.prefetch(`/networks/${networkId}/${comment.id}`)}
            >
              <PostCard
                item={comment}
                chainId={networkId}
                networkName={comment.network_name}
                threadAuthor={threadAuthor}
                actions={[
                  'like',
                  comment.allow_comment ? 'comment' : null,
                  'repost',
                  'view',
                  'share',
                  'tip',
                  'bookmark',
                ].filter(Boolean)} // Simplified actions matrix for reply nodes
              />
              {hiddenReplies > 0 && (
                <button
                  type="button"
                  className={styles.commentsList__more}
                  onClick={(e) => {
                    e.stopPropagation()
                    openComment()
                  }}
                >
                  Show replies
                </button>
              )}
              {i < list.length - 1 && <hr className={styles.commentsList__divider} />}
            </section>
          )
        })
      )}
    </div>
  )
}
