'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { ChatCircleIcon } from '@phosphor-icons/react'
import Post from '@/components/Post'
import Avatar from '@/components/ui/Avatar'
import CommentSkeletonList from '@/components/ui/CommentSkeleton'
import { Spinner } from '@/components/Loading'
import { useBlockedUsers } from '@/hooks/useBlockedUsers'
import { useListPosts, useListState } from '@/db/lists'
import { COMMENTS_FRESH_MS, commentsScope, fetchThread } from '@/db/comments'
import { DEFAULT_COMMENTS_SORT } from '@/lib/commentsRequest'
import { rememberCardPointerDown, isTextSelectionDrag } from '@/lib/cardClick'
import { openPost } from '@/stores/usePostOverlayStore'
import styles from './comments.module.scss'

// Answers under a reply read as a conversation, so they open oldest first
const REPLIES_SORT = 'latest'

const REPLY_ACTIONS = ['like', 'comment', 'repost', 'view', 'share', 'tip', 'bookmark']

/**
 * A post's replies, Threads-style: a reply with answers ends in a curved connector to the faces
 * of who answered and "Show replies", which unfolds those answers in place (ReplyItem).
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
        list.map((comment, i) => (
          <section key={comment.id} className={styles.commentsList__item}>
            <ReplyItem comment={comment} networkId={networkId} viewer={viewer} threadAuthor={threadAuthor} />
            {i < list.length - 1 && <hr className={styles.commentsList__divider} />}
          </section>
        ))
      )}
    </div>
  )
}

/**
 * One reply and, once asked for, its answers under it. The answers are a thread list of their
 * own in the post store, so a reply unfolded once reopens with no request while it is fresh, and
 * each answer can unfold its own the same way.
 * @param {Object} props
 * @param {boolean} [props.connectBelow] The line from this reply's avatar runs on to a sibling
 *   answer below it, whether or not it has answers of its own.
 */
function ReplyItem({ comment, networkId, viewer, threadAuthor, connectBelow = false }) {
  const router = useRouter()
  const { isBlocked } = useBlockedUsers()
  const [expanded, setExpanded] = useState(false)
  const [failed, setFailed] = useState(false)

  const scope = commentsScope(networkId, comment.id, REPLIES_SORT)
  const replies = useListPosts(scope)
  const repliesState = useListState(scope)
  const loaded = Boolean(repliesState) && (repliesState.address ?? null) === viewer && repliesState.savedAt != null

  const networkIdOf = comment.network_id ?? networkId
  const path = `/networks/${networkIdOf}/${comment.id}`
  const hasReplies = Number(comment.total_comments || 0) > 0
  const shown = expanded && loaded ? replies.filter((reply) => !isBlocked(reply.wallet_address)) : []
  // Stays up while the answers load, and comes back if they could not
  const showToggle = hasReplies && (!expanded || !loaded || failed)
  const faces = (comment.repliers ?? []).filter((face) => !isBlocked(face.wallet_address))

  const unfold = (e) => {
    e.stopPropagation()
    setExpanded(true)
    setFailed(false)
    if (loaded && Date.now() - repliesState.savedAt < COMMENTS_FRESH_MS) return
    fetchThread(networkIdOf, comment.id, viewer, REPLIES_SORT).catch((err) => {
      console.error('Failed to load replies', err)
      setFailed(true)
    })
  }

  const isLoading = expanded && !loaded && !failed

  return (
    <>
      <div
        className={styles.commentsList__reply}
        onPointerDown={rememberCardPointerDown}
        onClick={(e) => {
          if (isTextSelectionDrag(e)) return
          // An answer is nested inside its reply's subtree; only the innermost one opens
          e.stopPropagation()
          openPost({ ...comment, network_id: networkIdOf }, router)
        }}
        onMouseEnter={() => router.prefetch(path)}
        onTouchStart={() => router.prefetch(path)}
      >
        <Post
          item={comment}
          chainId={networkId}
          threadAuthor={threadAuthor}
          hasCommentBelow={connectBelow || showToggle || shown.length > 0}
          actions={REPLY_ACTIONS.filter((action) => action !== 'comment' || comment.allow_comment)}
        />
      </div>
      {showToggle && (
        <button
          type="button"
          className={clsx(styles.commentsList__more, connectBelow && styles['commentsList__more--through'])}
          onClick={unfold}
          disabled={isLoading}
          aria-expanded={expanded && loaded}
        >
          {faces.length > 0 && (
            <span className={styles.commentsList__faces} aria-hidden="true">
              {faces.map((face) => (
                <Avatar key={face.wallet_address} className={styles.commentsList__face} src={face.profile_image} alt="" size={20} />
              ))}
            </span>
          )}
          <span className={styles.commentsList__moreLabel}>{failed ? 'Couldn’t load replies. Retry' : 'Show replies'}</span>
          {isLoading && <Spinner size={14} label="Loading replies" />}
        </button>
      )}
      {shown.map((reply, i) => (
        <ReplyItem
          key={reply.id}
          comment={reply}
          networkId={networkId}
          viewer={viewer}
          threadAuthor={threadAuthor}
          connectBelow={connectBelow || i < shown.length - 1}
        />
      ))}
    </>
  )
}
