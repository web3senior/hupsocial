'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import { recordPostView } from '@/lib/api'
import { useClientMounted } from '@/hooks/useClientMount'
import Post from '@/components/Post'
import Comments from '@/components/Comments'
import PostTippers from './PostTippers'
import ThreadBar from './ThreadBar'
import { DEFAULT_COMMENTS_SORT } from '@/lib/commentsRequest'
import { THREAD_PROGRESS_EVENT } from '@/lib/postPublication'
import ReplyBar from './ReplyBar'
import PostTitleRow from './PostTitleRow'
import { usePostStore } from '@/stores/usePostStore'
import styles from './PostDetails.module.scss'

const sameId = (a, b) => a != null && b != null && String(a) === String(b)

// Post ids restart from 1 on every chain, so a match needs the network too when the row names one
const isPost = (row, networkId, postId) =>
  sameId(row?.id, postId) && (row.network_id == null || sameId(row.network_id, networkId))

// What to paint for a post before its own request answers: the feed's cached copy first — it
// already carries the viewer's flags — else the row the server rendered the page with. Only a
// post that arrives by fetch into an empty mount gets the entry animation: a cached one was
// already painted by loading.jsx and a served one is in the HTML, and `animate fade` starts from
// opacity 0, so replaying it over either blanks a visible post.
const seedPostState = (networkId, postId, cachedPost, servedPost) => {
  const post = isPost(cachedPost, networkId, postId) ? cachedPost : isPost(servedPost, networkId, postId) ? servedPost : null
  return { post, forId: postId, animateEntry: post === null }
}

/**
 * @param {Object} props
 * @param {string} props.networkId
 * @param {string} props.postId
 * @param {Object|null} [props.initialPost] The row the page read on the server. It is what a
 *   cold open paints before any request is made; the feed's cached copy still wins over it on a
 *   navigation because that one already carries the viewer's own flags.
 */
export default function PostDetails({ networkId, postId, initialPost = null }) {
  const params = useParams()
  const router = useRouter()
  const resolvedNetworkId = networkId || params.networkId
  const resolvedPostId = postId || params.postId

  const { currentPost, setCurrentPost } = usePostStore()
  const { address } = useConnection()
  const mounted = useClientMounted()

  const [{ post, forId, animateEntry }, setPostState] = useState(() =>
    seedPostState(resolvedNetworkId, resolvedPostId, currentPost, initialPost),
  )

  // In-page navigation (comment → parent) keeps this component mounted with a new postId, so
  // the post has to swap during render: an effect would paint the previous one under the new
  // URL for a frame.
  if (!sameId(forId, resolvedPostId)) {
    setPostState(seedPostState(resolvedNetworkId, resolvedPostId, currentPost, initialPost))
  }

  useEffect(() => {
    let cancelled = false
    // Always runs, even over a server-rendered row: that row has no viewer flags and no tip or
    // sale dollars, and this is what fills them in. viewer_address makes the server compute
    // is_liked/is_bookmarked for this wallet; address in the deps refetches once wagmi finishes
    // reconnecting, since the first run usually fires before the connection is restored.
    const viewerQuery = address ? `?viewer_address=${address}` : ''
    fetch(`/api/v1/networks/${resolvedNetworkId}/${resolvedPostId}${viewerQuery}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled || !body?.data) return
        setPostState((prev) => ({ ...prev, post: body.data }))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [resolvedNetworkId, resolvedPostId, address])

  // A comment carries its parent's id — parent_id on current rows, is_comment on
  // legacy rows. Zero means "not a comment" onchain, so it must not count.
  const parentId = Number(post?.parent_id) || Number(post?.is_comment) || null
  // Kept with the id it answers for, so a thread that stops being a comment (or becomes a
  // different one) simply stops matching instead of needing to be cleared
  const [parentState, setParentState] = useState({ forParentId: null, post: null })

  useEffect(() => {
    if (!parentId) return
    let cancelled = false
    fetch(`/api/v1/networks/${resolvedNetworkId}/${parentId}${address ? `?viewer_address=${address}` : ''}`)
      .then((r) => r.json())
      .then((body) => { if (!cancelled && body?.data) setParentState({ forParentId: parentId, post: body.data }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [resolvedNetworkId, parentId, address])

  const parentPost = parentId && sameId(parentState.forParentId, parentId) ? parentState.post : null

  // A thread the author published in one go ({ part: 1, of: N } on the root): parts 2…N are
  // drawn under it as one piece, joined by the reply line, instead of competing with everyone
  // else's replies for a place in the list. A repost's row carries none of its original's content.
  const threadMarker = Number(post?.is_repost) > 0 ? null : post?.content?.thread
  const isThreadRoot = Number(threadMarker?.part) === 1 && Number(threadMarker?.of) > 1
  const [threadState, setThreadState] = useState({ forId: null, parts: [] })
  // Bumped as the author's own thread lands part by part (lib/threadPublication), so a page
  // opened on part one mid-publish fills in the rest instead of stopping at what it first found
  const [threadRevision, setThreadRevision] = useState(0)

  useEffect(() => {
    if (!isThreadRoot) return
    const onProgress = (event) => {
      if (sameId(event.detail?.rootId, resolvedPostId) && sameId(event.detail?.networkId, resolvedNetworkId)) setThreadRevision((n) => n + 1)
    }
    window.addEventListener(THREAD_PROGRESS_EVENT, onProgress)
    return () => window.removeEventListener(THREAD_PROGRESS_EVENT, onProgress)
  }, [resolvedNetworkId, resolvedPostId, isThreadRoot])

  useEffect(() => {
    if (!isThreadRoot) return
    let cancelled = false
    fetch(`/api/v1/networks/${resolvedNetworkId}/${resolvedPostId}/thread${address ? `?viewer_address=${address}` : ''}`)
      .then((r) => r.json())
      .then((body) => { if (!cancelled && Array.isArray(body?.data)) setThreadState({ forId: resolvedPostId, parts: body.data }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [resolvedNetworkId, resolvedPostId, address, isThreadRoot, threadRevision])

  const threadParts = isThreadRoot && sameId(threadState.forId, resolvedPostId) ? threadState.parts : []
  // Only part 2 replies to the root directly — the list below would show it twice
  const threadReplyIds = threadParts.length ? [threadParts[0].id] : null

  const openPost = (row) => {
    setCurrentPost(row)
    router.push(`/networks/${resolvedNetworkId}/${row.id}`)
  }

  useEffect(() => {
    if (mounted) recordPostView(resolvedNetworkId, resolvedPostId, address)
  }, [resolvedPostId, resolvedNetworkId, address, mounted])

  // Replies open on Top, as on Threads; the choice holds while this page is up
  const [sort, setSort] = useState(DEFAULT_COMMENTS_SORT)
  const isRepost = Number(post?.is_repost) > 0
  // A repost's thread is its original's
  const threadId = isRepost ? post.is_repost : resolvedPostId

  return (
    <div className={`${styles.post}`}>
      {/* Above the card, not inside it: Threads titles the thread on the page itself */}
      <div className={`__container`} data-width={`small`}>
        <PostTitleRow post={post} networkId={resolvedNetworkId} />
      </div>

      <div className={`__container ${styles.page__container}`} data-width={`small`}>
        {!post &&<div className={`shimmer ${styles.pollShimmer}`} />}

        {post && (
          <div className={`${styles.grid} flex flex-column`}>
            {parentPost && (
              <article
                className={`${styles.post} ${styles.post__parent} animate fade`}
                onClick={() => openPost(parentPost)}
                onMouseEnter={() => router.prefetch(`/networks/${resolvedNetworkId}/${parentPost.id}`)}
              >
                <Post
                  item={parentPost}
                  chainId={resolvedNetworkId}
                  actions={['like', 'comment', 'repost', 'tip', 'view', 'share', 'bookmark']}
                  hasCommentBelow={true}
                />
              </article>
            )}
            <article className={clsx(styles.post, animateEntry && 'animate fade')}>
              <Post
                item={post}
                showContent={true}
                chainId={resolvedNetworkId}
                actions={['like', 'comment', 'repost', 'tip', 'view', 'share', 'bookmark']}
                authorFallback
                hasCommentBelow={threadParts.length > 0}
              />
            </article>
            {/* The rest of the thread, each part its own post (own likes, own replies) and a way
                into its own page, the line running on from the root to the last part */}
            {threadParts.map((part, index) => (
              <article
                key={part.id}
                className={clsx(styles.post, styles.post__threadPart, 'animate fade')}
                onClick={() => openPost(part)}
                onMouseEnter={() => router.prefetch(`/networks/${resolvedNetworkId}/${part.id}`)}
              >
                <Post
                  item={part}
                  chainId={resolvedNetworkId}
                  actions={['like', 'comment', 'repost', 'tip', 'view', 'share', 'bookmark']}
                  hasCommentBelow={index < threadParts.length - 1}
                />
              </article>
            ))}
          </div>
        )}

        {/* Mounts with the post rather than after a request for it, so on a cold open the
            supporters strip and the thread are already loading while the post is on screen.
            Likes live in View activity (ThreadBar), not under the post. */}
        {post && <PostTippers networkId={resolvedNetworkId} postId={threadId} />}

        {/* A repost row carries none of its original's content or counts, so its activity sheet
            would describe the wrong post — that row keeps only the sort */}
        {post && <ThreadBar post={isRepost ? null : post} networkId={resolvedNetworkId} sort={sort} onSortChange={setSort} />}

        {post && <ReplyBar post={post} networkId={resolvedNetworkId} />}

        {post && (
          <Comments
            networkId={resolvedNetworkId}
            postId={threadId}
            viewerAddress={address}
            sort={sort}
            threadAuthor={isRepost ? null : post.wallet_address}
            hiddenIds={threadReplyIds}
          />
        )}
      </div>
    </div>
  )
}
