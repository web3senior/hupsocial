'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Post from '@/components/Post'
import CommentSkeletonList from '@/components/ui/CommentSkeleton'
import { usePostStore } from '@/stores/usePostStore'
import { useCommentsCacheStore, commentsCacheKey } from '@/stores/useCommentsCacheStore'
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

export default function Comments({ networkId, postId, viewerAddress }) {
  const router = useRouter()
  const setCurrentPost = usePostStore((state) => state.setCurrentPost)
  const fetchComments = useCommentsCacheStore((state) => state.fetchComments)

  const cacheKey = commentsCacheKey(networkId, postId)
  const viewer = viewerAddress ?? null
  const threadNonce = useCommentsCacheStore((state) => state.threadNonces[cacheKey] ?? 0)

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

    fetchComments(networkId, postId, viewer)
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
  }, [networkId, postId, viewer, cacheKey, fetchComments, threadNonce])

  if (thread.isLoading) return <CommentSkeletonList count={3} />

  return (
    <div className={styles.commentsList}>
      {thread.list.length === 0 ? (
        <p className={styles.commentsList__empty}>No comments yet. Start the conversation!</p>
      ) : (
        thread.list.map((comment, i) => (
          <section key={comment.id} className={styles.commentsList__item}
           onPointerDown={rememberCardPointerDown}
           onClick={(e) => {
             if (isTextSelectionDrag(e)) return
             // Seed the store so the detail route paints this comment instantly
             setCurrentPost(comment)
             router.push(`/networks/${networkId}/${comment.id}`)
           }}
           onMouseEnter={() => router.prefetch(`/networks/${networkId}/${comment.id}`)}
           onTouchStart={() => router.prefetch(`/networks/${networkId}/${comment.id}`)}
          >
            <Post
              item={comment}
              networkName={comment.network_name}
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
            {i < thread.list.length - 1 && <hr className={styles.commentsList__divider} />}
          </section>
        ))
      )}
    </div>
  )
}
