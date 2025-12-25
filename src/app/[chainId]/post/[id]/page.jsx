'use client'

import { useState, useEffect, useId, useRef, useCallback } from 'react'
import Link from 'next/link'
import moment from 'moment'
import { useParams, useRouter } from 'next/navigation'
import {
  useWaitForTransactionReceipt,
  useConnection,
  useWriteContract,
  useReadContract,
} from 'wagmi'
import {
  initPostContract,
  initPostCommentContract,
  getPosts,
  getPostByIndex,
  getPostCommentCount,
  getCommentsByPostId,
  getHasLikedPost,
  getHasLikedComment,
  getActiveChain,
} from '@/lib/communication'
import { getProfile, getUniversalProfile, addViewPost, getApps } from '@/lib/api'
import PollTimer from '@/components/PollTimer'
import { useAuth } from '@/contexts/AuthContext'
import Web3 from 'web3'
import { isPollActive } from '@/lib/utils'
import { useClientMounted } from '@/hooks/useClientMount'
import { config } from '@/config/wagmi'
import abi from '@/abi/post.json'
import commentAbi from '@/abi/post-comment.json'
import Profile, { ProfileImage } from '../../../../components/Profile'
import { CommentIcon, ShareIcon, BlueCheckMarkIcon, RepostIcon } from '@/components/Icons'
import Post from '@/components/Post'
import Comment from '@/components/Comment'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'
import GlobalLoader, { ContentSpinner } from '@/components/Loading'

moment.defineLocale('en-short', {
  relativeTime: {
    future: 'in %s',
    past: '%s', //'%s ago'
    s: '1s',
    ss: '%ds',
    m: '1m',
    mm: '%dm',
    h: '1h',
    hh: '%dh',
    d: '1d',
    dd: '%dd',
    M: '1mo',
    MM: '%dmo',
    y: '1y',
    yy: '%dy',
  },
})

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

export default function Page() {
  const [post, setPost] = useState()
  const [comments, setComments] = useState({ list: [] })
  const [commentsLoaded, setcommentsLoaded] = useState(0)
  const [viewCount, setViewCount] = useState(0)
  const [commentCount, setCommentCount] = useState(0)
  const [isLoadedComment, setIsLoadedPoll] = useState(false)
  const [showCommentModal, setShowCommentModal] = useState()
  const { web3, contract } = initPostContract()
  const giftModal = useRef()
  const mounted = useClientMounted()
  const [chains, setChains] = useState()
  const params = useParams()
  const activeChain = getActiveChain()
  const { address, isConnected } = useConnection()
  const router = useRouter()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const loadMoreComment = async (totalCount) => {
    // Guard clause: prevent concurrent fetches or loading beyond total
    if (isLoadedComment || commentsLoaded >= totalCount) return

    setIsLoadedPoll(true)

    try {
      const PAGE_SIZE = 40

      // Calculate how many to fetch, ensuring we don't go below index 0
      const remaining = totalCount - commentsLoaded
      const countToFetch = Math.min(PAGE_SIZE, remaining)
      const startIndex = Math.max(0, totalCount - commentsLoaded - countToFetch)

      console.log(`Fetching from index ${startIndex}, count: ${countToFetch}`)

      const newComments = await getCommentsByPostId(params.id, startIndex, countToFetch, address)

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
    localStorage.setItem(
      `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`,
      params.chainId
    )
    setChains(config.chains)

    addViewPost(params.chainId, params.id).then(setViewCount)

    getPostByIndex(params.id, address).then((res) => {
      if (res) {
        res.postId = params.id
        setPost(res)
      }
    })
  }, [params.id, params.chainId, address]) // Re-run if post or user changes

  // Effect 2: Initial Comments Load
  useEffect(() => {
    const initComments = async () => {
      try {
        const count = await getPostCommentCount(params.id)
        const total = web3.utils.toNumber(count)
        setCommentCount(total)

        // Only auto-load if nothing has been loaded yet
        if (commentsLoaded === 0 && !isLoadedComment && total > 0) {
          await loadMoreComment(total)
        }
      } catch (err) {
        console.error('Failed to initialize comments', err)
      }
    }

    initComments()
  }, [params.id, showCommentModal]) // Trigger when modal opens or post changes

  return (
    <>
      <PageTitle name={`post`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        {showCommentModal && (
          <CommentModal
            item={showCommentModal.data}
            parentId={showCommentModal.parentId}
            type={showCommentModal.type}
            setShowCommentModal={setShowCommentModal}
          />
        )}

        <div className={`__container ${styles.page__container}`} data-width={`medium`}>
          {!post && <div className={`shimmer ${styles.pollShimmer}`} />}
          <div className={`${styles.grid} flex flex-column`}>
            {post && (
              <article className={`${styles.post} animate fade`}>
                <Post
                  item={post}
                  showContent={true}
                  chainId={params.chainId}
                  actions={[`like`, `comment`, `repost`, `tip`, `view`, `share`]}
                />
                <hr />
              </article>
            )}
          </div>

          {comments &&
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
                    chainId={params.chainId}
                    actions={[`like`, `comment`, `repost`, `share`]}
                  />
                  <hr />
                </section>
              )
            })}

          {mounted && isConnected && (
            <div
              className={`${styles.reply} flex align-items-center gap-025`}
              onClick={() => setShowCommentModal({ data: post, type: `post` })}
            >
              <ProfileImage addr={address} />
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

const CommentModal = ({ item, postContent, setShowCommentModal }) => {
  const [status, setStatus] = useState(true)
  const [error, setError] = useState(null)
  const isMounted = useClientMounted()
  const [commentContent, setCommentContent] = useState('')
  const { address, isConnected } = useConnection()
  const activeChain = getActiveChain()
  const { web3, contract } = initPostCommentContract()
  const { data: hash, isPending: isSigning, error: submitError, writeContract } = useWriteContract()
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash,
  })

  const getHasLiked = async () => {
    return isConnected ? await getHasLikedPost(id, address) : false
  }

  const postComment = (e, id) => {
    e.stopPropagation()

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    writeContract({
      abi: commentAbi,
      address: activeChain[1].comment,
      functionName: 'addComment',
      args: [web3.utils.toNumber(id), 0, commentContent, ''],
    })
  }

  useEffect(() => {}, [])

  if (error) {
    return <span>{error}</span>
  }

  return (
    <div
      className={`${styles.modal} animate fade`}
      onClick={(e) => {
        e.stopPropagation()
        setShowCommentModal()
      }}
    >
      <div className={`${styles.modal__container}`} onClick={(e) => e.stopPropagation()}>
        <header className={`${styles.modal__container__header}`}>
          <div className={``} aria-label="Close" onClick={() => setShowCommentModal()}>
            Cancel
          </div>
          <div className={`flex-1`}>
            <h3>Post your reply</h3>
          </div>
          <div className={`pointer`} onClick={(e) => updateStatus(e)}>
            {isSigning
              ? `Signing...`
              : isConfirming
              ? 'Confirming...'
              : status && status.content !== ''
              ? `Update`
              : `Share`}
          </div>
        </header>

        <main className={`${styles.modal__container__main}`}>
          <article className={`${styles.modal__post}`}>
            <section className={`flex flex-column align-items-start justify-content-between`}>
              <header className={`${styles.modal__post__header}`}>
                <Profile creator={item.creator} createdAt={item.createdAt} />
              </header>
              <main className={`${styles.modal__post__main} w-100 flex flex-column grid--gap-050`}>
                <div className={`${styles.post__main__media}`}>
                  {postContent && (
                    <>
                      <div
                        className={`${styles.post__main__content} `}
                        id={`post${item.postId}`}
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(`${postContent.elements[0].data.text}`),
                        }}
                      />
                      <MediaGallery data={postContent.elements[1].data.items} />
                    </>
                  )}
                </div>
              </main>
            </section>
          </article>
        </main>

        <footer className={`${styles.modal__footer}  flex flex-column align-items-start`}>
          <ConnectedProfile addr={address} />
          <textarea
            autoFocus
            defaultValue={commentContent}
            onInput={(e) => setCommentContent(e.target.value)}
            placeholder={`Reply to ${item.creator.slice(0, 4)}…${item.creator.slice(38)}`}
          />
          <button className="btn" onClick={(e) => postComment(e, item.postId)}>
            Post comment
          </button>
        </footer>
      </div>
    </div>
  )
}

/**
 * Profile
 * @param {String} addr
 * @returns
 */
const ConnectedProfile = ({ addr }) => {
  const [profile, setProfile] = useState()
  const activeChain = getActiveChain()
  const defaultUsername = `hup-user`
  const [isItUp, setIsItUp] = useState()
  useEffect(() => {
    getUniversalProfile(addr).then((res) => {
      // console.log(res)
      if (res.data && Array.isArray(res.data.Profile) && res.data.Profile.length > 0) {
        setIsItUp(true)
        setProfile({
          wallet: res.data.id,
          name: res.data.Profile[0].name,
          description: res.data.description,
          profileImage:
            res.data.Profile[0].profileImages.length > 0
              ? res.data.Profile[0].profileImages[0].src
              : `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`,
          profileHeader: '',
          tags: JSON.stringify(res.data.tags),
          links: JSON.stringify(res.data.links_),
          lastUpdate: '',
        })
      } else {
        getProfile(addr).then((res) => {
          //  console.log(res)
          if (res.wallet) {
            const profileImage =
              res.profileImage !== ''
                ? `${process.env.NEXT_PUBLIC_UPLOAD_URL}${res.profileImage}`
                : `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`
            res.profileImage = profileImage
            setProfile(res)
          }
        })
      }
    })
  }, [])

  if (!profile)
    return (
      <div className={`${styles.profileShimmer} flex align-items-center gap-050`}>
        <div className={`shimmer rounded`} style={{ width: `36px`, height: `36px` }} />
        <div className={`flex flex-column justify-content-between gap-025`}>
          <span className={`shimmer rounded`} style={{ width: `60px`, height: `10px` }} />
          <span className={`shimmer rounded`} style={{ width: `40px`, height: `10px` }} />
        </div>
      </div>
    )

  return (
    <figure
      className={`${styles.profile} flex align-items-center`}
      onClick={(e) => {
        e.stopPropagation()
        router.push(`/u/${addr}`)
      }}
    >
      <img
        alt={profile.name || `Default PFP`}
        src={`${profile.profileImage}`}
        className={`rounded`}
      />

      <figcaption className={`flex flex-column`}>
        <div className={`flex align-items-center gap-025`}>
          <b>{profile.name ?? defaultUsername}</b>
          <BlueCheckMarkIcon />
          <div
            className={`${styles.badge}`}
            title={activeChain && activeChain[0].name}
            dangerouslySetInnerHTML={{ __html: `${activeChain && activeChain[0].icon}` }}
          ></div>
        </div>
        <code className={`text-secondary`}>{`${addr.slice(0, 4)}…${addr.slice(38)}`}</code>
      </figcaption>
    </figure>
  )
}
