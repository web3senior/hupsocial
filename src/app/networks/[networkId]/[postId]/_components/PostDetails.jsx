'use client'

import { useState, useEffect, useId, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useWaitForTransactionReceipt, useConnection, useWriteContract, useReadContract } from 'wagmi'
import { initHupContract, getCommentsByPostId, getActiveChain } from '@/lib/communication'
import { getPostById, getProfile, getUniversalProfile, recordPostView } from '@/lib/api'
import { useClientMounted } from '@/hooks/useClientMount'
import Profile from '@/components/Profile'
import { CommentIcon, ShareIcon, BlueCheckMarkIcon, RepostIcon } from '@/components/Icons'
import Post from '@/components/Post'
import PageTitle from '@/components/PageTitle'
import GlobalLoader, { ContentSpinner } from '@/components/Loading'
import Comments from '@/components/Comments'
import styles from './PostDetails.module.scss'

// export async function generateMetadata({ params, searchParams }, parent) {
//   const slug = (await params).slug

//   // fetch post information
//   const post = await fetch(`https://api.vercel.app/blog/${slug}`).then((res) =>
//     res.json()
//   )

//   return {
//     title: post.title,
//     description: post.description,
//   }
// }

export default function PostDetails({post}) {
  const [comments, setComments] = useState({ list: [] })
  const [commentsLoaded, setcommentsLoaded] = useState(0)
  const [isLoadedComment, setIsLoadedPoll] = useState(false)
  const [showCommentModal, setShowCommentModal] = useState()
  const mounted = useClientMounted()
  const params = useParams()
  const { address, isConnected } = useConnection()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const loadMoreComment = async (totalCount) => {
    if (isLoadedComment || commentsLoaded >= totalCount) return

    setIsLoadedPoll(true)

    try {
      const PAGE_SIZE = 40
      const remaining = totalCount - commentsLoaded
      const countToFetch = Math.min(PAGE_SIZE, remaining)
      const startIndex = Math.max(0, totalCount - commentsLoaded - countToFetch)

      console.log(`Fetching from index ${startIndex}, count: ${countToFetch}`)

      const newComments = await getCommentsByPostId(params.postId, startIndex, countToFetch, address)

      if (Array.isArray(newComments) && newComments.length > 0) {
        // Assuming you want the newest comments at the top or bottom?
        // Reverse if the contract returns them in descending index order.
        setComments((prev) => ({
          list: [...prev.list, ...newComments],
        }))
        setcommentsLoaded((prev) => prev + newComments.length)
      }
    } catch (error) {
      console.error('Error loading more comments:', error)
    } finally {
      setIsLoadedPoll(false)
    }
  }

  // Effect 1: Basic Post Data & Analytics
  useEffect(() => {
    // localStorage.setItem(
    //   `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`,
    //   params.networkId,
    // )
    // setChains(config.chains)

    recordPostView(params.networkId, params.postId, address)

    // getPostByIndex(params.postId, address).then((res) => {
    //   if (res) {
    //     res.postId = params.postId
    //     setPost(res)
    //   }
    // })
  }, [params.postId, params.networkId, address]) // Re-run if post or user changes

  // Effect 2: Initial Comments Load
  useEffect(() => {
    //   const initComments = async () => {
    //     try {
    //       const count = await getPostCommentCount(params.postId)
    //       const total = web3.utils.toNumber(count)
    //       setCommentCount(total)
    //       // Only auto-load if nothing has been loaded yet
    //       if (commentsLoaded === 0 && !isLoadedComment && total > 0) {
    //         await loadMoreComment(total)
    //       }
    //     } catch (err) {
    //       console.error('Failed to initialize comments', err)
    //     }
    //   }
    //  initComments()
  }, [params.postId, showCommentModal]) // Trigger when modal opens or post changes

  return (
    <>
      <div className={`${styles.post}`}>
        {/* {showCommentModal && (
          <CommentModal
            item={showCommentModal.data}
            parentId={showCommentModal.parentId}
            type={showCommentModal.type}
            setShowCommentModal={setShowCommentModal}
          />
        )} */}

        <div className={`__container ${styles.page__container}`} data-width={`small`}>
          {!post && <div className={`shimmer ${styles.pollShimmer}`} />}
          <div className={`${styles.grid} flex flex-column`}>
            {post && (
              <article className={`${styles.post} animate fade`}>
                <Post item={post} showContent={true} chainId={params.networkId} actions={[`like`, `comment`, 'hash',`repost`, `view`, `share`]} />
                <hr />
              </article>
            )}
          </div>

          {post && (
            <Comments networkId={params.networkId} postId={post.is_repost > 0 ? post.is_repost : params.postId} viewerAddress={address} />
          )}

          {/* {comments &&
            comments.list.length > 0 &&
            comments.list.map((item, i) => {
              return (
                <section
                  key={i}
                  className={`${styles.post} animate fade`}
                  onClick={() => router.push(`/${activeChain[0].id}/comment/${item.commentId}`)}
                >
                  <Comment
                    item={item}
                    showContent={true}
                    chainId={params.networkId}
                    actions={[`like`, `comment`, `repost`, `share`]}
                  />
                  <hr />
                </section>
              )
            })} */}

          {mounted && isConnected &&  false&& (
            <div
              className={`${styles.reply} flex align-items-center gap-025`}
              onClick={() => setShowCommentModal({ data: post, type: `post` })}
            >
              <Profile addr={address} variant="imageOnly" />
              Reply
              <p>{/* Reply to {post.creator.slice(0, 4)}…{post.creator.slice(38)} */}</p>
            </div>
          )}
        </div>
        {/* 
        {commentsLoaded !== commentCount && (
          <button className={`${styles.loadMore}`} onClick={() => loadMoreComment(commentCount)}>
            Load More
          </button>
        )} */}
      </div>
    </>
  )
}
/**

   {mounted && isConnected && (
            <div
              className={`${styles.reply} flex align-items-center gap-025`}
              onClick={() => setShowCommentModal({ data: post, type: `post` })}
            >
              <Profile creator={address} variant="imageOnly" />
           
              {<p>Reply to {post.creator.slice(0, 4)}…{post.creator.slice(38)}</p> }
            </div>
          )}

 */
