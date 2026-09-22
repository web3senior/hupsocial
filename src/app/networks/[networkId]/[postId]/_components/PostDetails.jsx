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

  useEffect(() => {
    if (mounted) recordPostView(resolvedNetworkId, resolvedPostId, address)
  }, [resolvedPostId, resolvedNetworkId, address, mounted])

  return (
    <div className={`${styles.post}`}>
      <div className={`__container ${styles.page__container}`} data-width={`small`}>
        {!post && <div className={`shimmer ${styles.pollShimmer}`} />}

        {post && (
          <div className={`${styles.grid} flex flex-column`}>
            {parentPost && (
              <article
                className={`${styles.post} ${styles.post__parent} animate fade`}
                onClick={() => {
                  setCurrentPost(parentPost)
                  router.push(`/networks/${resolvedNetworkId}/${parentPost.id}`)
                }}
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
              />
              <hr />
            </article>
          </div>
        )}

        {/* Both mount with the post rather than after a request for it, so on a cold open the
            thread and the supporters strip are already loading while the post is on screen */}
        {post && <PostTippers networkId={resolvedNetworkId} postId={post.is_repost > 0 ? post.is_repost : resolvedPostId} />}

        {post && (
          <Comments
            networkId={resolvedNetworkId}
            postId={post.is_repost > 0 ? post.is_repost : resolvedPostId}
            viewerAddress={address}
          />
        )}
      </div>
    </div>
  )
}
