'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChatCircleIcon } from '@phosphor-icons/react'
import { PostCard } from '@/components/Post'
import CommentSkeletonList from '@/components/ui/CommentSkeleton'
import { useListPosts, useListState } from '@/db/lists'
import { COMMENTS_FRESH_MS, commentsScope, fetchThread } from '@/db/comments'
import { DEFAULT_COMMENTS_SORT } from '@/lib/commentsRequest'
import { rememberCardPointerDown, isTextSelectionDrag } from '@/lib/cardClick'
import styles from './comments.module.scss'

/**
 * A post's replies, Threads-style: each reply carries its own latest answer nested under a
 * connector (PostCard), with a way into the rest when there are more.
 *
 * The thread is a list in the session's post store (db/comments): navigating back repaints it
 * with no request, and a reply of the viewer's landing (lib/postPublication) ages the list's
 * state, which is what sends a mounted thread back out for the new reply.
 * @param {Object} props
 * @param {'top'|'latest'} [props.sort] Order of the replies; each order is its own list.
 * @param {string|null} [props.threadAuthor] Wallet that started the thread, tagged "Author".
 * @param {Array<string|number>|null} [props.hiddenIds] Replies already drawn elsewhere on the page
 *   (the author's own thread, under the post) and left out of the list.
 */
export default function Comments({ networkId, postId, viewerAddress, sort = DEFAULT_COMMENTS_SORT, threadAuthor = null, hiddenIds = null }) {
  const router = useRouter()
  const scope = commentsScope(networkId, postId, sort)
  const viewer = viewerAddress ?? null

  const threadList = useListPosts(scope)
  const listState = useListState(scope)
  // Only rows fetched for this viewer count — is_liked/is_bookmarked are decided per wallet
  const savedAt = listState && (listState.address ?? null) === viewer ? listState.savedAt : null
  // A cold load that failed drops out of the skeleton instead of shimmering forever
  const [failedKey, setFailedKey] = useState(null)
  const requestKey = `${scope}|${viewer}`

  useEffect(() => {
    // Fresh enough to trust: skipping here is what stops every visit from re-requesting a thread
    // the session already has. A finished fetch moves savedAt, so this also ends the loop.
    if (savedAt != null && Date.now() - savedAt < COMMENTS_FRESH_MS) return

    let cancelled = false
    fetchThread(networkId, postId, viewer, sort).catch((err) => {
      if (cancelled) return
      console.error('Failed to load comments', err)
      // A failed background revalidation leaves the thread on screen; only a cold load has to
      // stop showing the skeleton.
      setFailedKey(requestKey)
    })

    return () => {
      cancelled = true
    }
  }, [networkId, postId, viewer, sort, savedAt, requestKey])

  if (savedAt == null && failedKey !== requestKey) return <CommentSkeletonList count={3} />

  // Filtered at render, not in the store: the stored thread stays whole for every other reader
  const hidden = hiddenIds?.length ? new Set(hiddenIds.map(String)) : null
  const list = savedAt == null ? [] : hidden ? threadList.filter((comment) => !hidden.has(String(comment.id))) : threadList

  return (
    <div className={styles.commentsList}>
      {list.length === 0 ? (
        <div className={styles.commentsList__empty}>
          <ChatCircleIcon className={styles.commentsList__emptyIcon} size={28} aria-hidden="true" />
          <p className={styles.commentsList__emptyText}>No replies yet</p>
        </div>
      ) : (
        list.map((comment, i) => {
          // The reply is already in the post store, so the detail route paints it instantly
          const openComment = () => {
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
