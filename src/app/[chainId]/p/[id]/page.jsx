'use client'

import { useState, useEffect, useId, useRef, useCallback } from 'react'
import Link from 'next/link'
import moment from 'moment'
import { useParams, useRouter } from 'next/navigation'
import { useConnectorClient, useConnections, useClient, networks, useWaitForTransactionReceipt, useAccount, useDisconnect, Connector, useConnect, useWriteContract, useReadContract } from 'wagmi'
import {
  initPostContract,
  initPostCommentContract,
  getPosts,
  getPostByIndex,
  getPostCommentCount,
  getCommentsByPostId,
  getHasLikedPost,
  getHasLikedComment,
  getPollLikeCount,
  getPostCount,
  getVoteCountsForPoll,
  getVoterChoices,
  getActiveChain,
} from '@/lib/communication'
import { getProfile, getUniversalProfile, newView, getViewPost, addViewPost, getApps } from '@/lib/api'
import PollTimer from '@/components/PollTimer'
import { useAuth } from '@/contexts/AuthContext'
import Web3 from 'web3'
import { isPollActive } from '@/lib/utils'
import { useClientMounted } from '@/hooks/useClientMount'
import { config } from '@/config/wagmi'
import abi from '@/abi/post.json'
import commentAbi from '@/abi/post-comment.json'
import { toast } from '@/components/NextToast'
import Shimmer from '@/components/ui/Shimmer'
import { InlineLoading } from '@/components/Loading'
import Profile, { ProfileImage } from '../../../../components/Profile'
import { CommentIcon, ShareIcon, RepostIcon, TipIcon, InfoIcon, BlueCheckMarkIcon } from '@/components/Icons'
import Post from '@/components/Post'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'

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

  const { address, isConnected } = useAccount()
  const router = useRouter()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const loadMoreComment = async (totalComment) => {
    // 1. **Add a guard clause to prevent re-entry**
    if (isLoadedComment) return

    // 2. Set to true *before* starting the async operation
    setIsLoadedPoll(true)

    try {
      let showingCommentCount = 20
      let startIndex = totalComment - commentsLoaded - showingCommentCount

      // **Stop loading if all posts are accounted for**
      if (commentsLoaded >= totalComment) {
        console.log('All polls loaded.')
        // We can return here, but still need to handle setIsLoadedPoll(false)
      }

      if (startIndex < 0) {
        // Check if we are trying to load past the first post
        showingCommentCount = totalComment - commentsLoaded
        startIndex = 0
        if (showingCommentCount <= 0) {
          // All loaded
          console.log('All polls loaded.')
          return // Exit early
        }
      }

      // ... (rest of your logic for calculating startIndex/showingCommentCount) ...

      // 3. Fetch the next batch of polls
      console.log(startIndex + 1, showingCommentCount)
      const newComments = await getCommentsByPostId(params.id, startIndex, showingCommentCount, address)
      console.log(`newComments => `, newComments)

      if (Array.isArray(newComments) && newComments.length > 0) {
        setComments((prevComments) => ({ list: [...prevComments.list, ...newComments] }))
        setcommentsLoaded((prevLoaded) => prevLoaded + newComments.length)
      }
    } catch (error) {
      console.error('Error loading more polls:', error)
    } finally {
      // 4. **Crucial: Set to false in finally block**
      // This re-enables loading for the next scroll event.
      setIsLoadedPoll(false)
    }
  }

  const openModal = (e, item) => {
    e.target.innerText = `Sending...`
    setSelectedEmoji({ e: e.target, item: item, message: null })
    giftModal.current.showModal()
  }

  useEffect(() => {
    localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`, params.chainId)

    // View
    addViewPost(params.chainId, params.id).then((result) => {
      setViewCount(result)
    })

    getPostByIndex(params.id, address).then((res) => {
      console.log(res)
      res.postId = params.id
      setPost(res)
    })

    // Comments
    getPostCommentCount(params.id).then((count) => {
      const totalComment = web3.utils.toNumber(count)
      setCommentCount(totalComment)

      if (commentsLoaded === 0 && !isLoadedComment) {
        loadMoreComment(totalComment)
      }
    })

    setChains(config.chains)
  }, [showCommentModal]) // Added necessary dependencies  [isLoadedComment, commentsLoaded]

  return (
    <>
      <PageTitle name={`post`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        {showCommentModal && <CommentModal item={showCommentModal.data} parentId={showCommentModal.parentId} type={showCommentModal.type} setShowCommentModal={setShowCommentModal} />}

        <div className={`__container ${styles.page__container}`} data-width={`medium`}>
          {!post && <div className={`shimmer ${styles.pollShimmer}`} />}
          <div className={`${styles.grid} flex flex-column`}>
            {post && (
              <article className={`${styles.post} animate fade`}>
                <Post item={post} showContent={true} chainId={params.chainId} actions={[`like`, `comment`, `repost`, `tip`, `view`, `share`]} />
                <hr />
              </article>
            )}
          </div>

          {comments &&
            comments.list.length > 0 &&
            comments.list.map((item, i) => {
              return (
                <div key={i}>
                  <div className={`${styles.comment}`} onClick={() => router.push(`/comment/${item.commentId}`)}>
                    <Profile creator={item.creator} createdAt={item.createdAt} />

                    <div className={`${styles.comment__content}`}>
                      <p>{item.content}</p>

                      <div onClick={(e) => e.stopPropagation()} className={`${styles.comment__actions} flex flex-row align-items-center justify-content-start`}>
                        <LikeComment commentId={item.commentId} likeCount={item.likeCount} />

                        <button onClick={() => setShowCommentModal({ data: item, parentId: item.commentId, type: `comment` })}>
                          <CommentIcon />
                          <span>{item.replyCount}</span>
                        </button>

                        <button>
                          <ShareIcon />
                          <span>0</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  <hr />
                </div>
              )
            })}

          {mounted && isConnected && (
            <div className={`${styles.reply} flex align-items-center gap-025`} onClick={() => setShowCommentModal({ data: post, type: `post` })}>
              <ProfileImage addr={address} />
              <p>
                Reply
                {/* to {post.creator.slice(0, 4)}…{post.creator.slice(38)} */}
              </p>
            </div>
          )}
        </div>

        {commentsLoaded !== commentCount && (
          <button className={`${styles.loadMore}`} onClick={() => loadMoreComment(postCount)}>
            Load More
          </button>
        )}
      </div>
    </>
  )
}

const CommentModal = ({ item, type, parentId = 0, setShowCommentModal }) => {
  const [hasLiked, setHasLiked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const isMounted = useClientMounted()
  const [commentContent, setCommentContent] = useState('')
  const { address, isConnected } = useAccount()
  const [activeChain, setActiveChain] = useState(getActiveChain())
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

  const postComment = (e) => {
    e.stopPropagation()

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }
    console.log(parentId)
    writeContract({
      abi: commentAbi,
      address: activeChain[1].comment,
      functionName: 'addComment',
      args: [web3.utils.toNumber(item.postId), parentId, commentContent, ''],
    })
  }

  const unlikePost = (e, id) => {
    e.stopPropagation()

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    writeContract({
      abi,
      address: activeChain[1].post,
      functionName: 'unlikePost',
      args: [id],
    })
  }

  useEffect(() => { }, [item])

  // if (loading) {
  //   return <InlineLoading />
  // }

  if (error) {
    return <span>{error}</span>
  }

  return (
    <div className={`${styles.commentModal} animate fade`} onClick={() => setShowCommentModal()}>
      <div className={`${styles.commentModal__container}`} onClick={(e) => e.stopPropagation()}>
        <header className={`${styles.commentModal__container__header}`}>
          <div className={``} aria-label="Close" onClick={() => setShowCommentModal()}>
            Cancel
          </div>
          <div className={`flex-1`}>
            <h3>Post your {type === `post` ? `comment` : `reply`}</h3>
          </div>
          <div className={`pointer`} onClick={(e) => updateStatus(e)}>
            {isSigning ? `Signing...` : isConfirming ? 'Confirming...' : status && status.content !== '' ? `Update` : `Share`}
          </div>
        </header>

        <main className={`${styles.commentModal__container__main}`}>
          <article className={`${styles.commentModal__post}`}>
            <section className={`flex flex-column align-items-start justify-content-between`}>
              <header className={`${styles.commentModal__post__header}`}>
                <Profile creator={item.creator} createdAt={item.createdAt} />
              </header>
              <main className={`${styles.commentModal__post__main} w-100 flex flex-column grid--gap-050`}>
                <div
                  className={`${styles.post__content} `}
                  // onClick={(e) => e.stopPropagation()}
                  id={`post${item.postId}`}
                >
                  {item.content}
                </div>
              </main>
            </section>
          </article>
        </main>

        <footer className={`${styles.commentModal__footer}  flex flex-column align-items-start`}>
          <ConnectedProfile addr={address} />
          <textarea
            autoFocus
            defaultValue={commentContent}
            onInput={(e) => setCommentContent(e.target.value)}
            placeholder={`${type === `post` ? `Comment` : `Reply`} to ${item.creator.slice(0, 4)}…${item.creator.slice(38)}`}
          />
          <button className="btn" onClick={(e) => postComment(e)}>
            Post {type === `post` ? `comment` : `reply`}
          </button>
        </footer>
      </div>
    </div>
  )
}
/**
 * Like
 * @param {*} param0
 * @returns
 */
const Like = ({ id, likeCount, hasLiked }) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const isMounted = useClientMounted()
  const { address, isConnected } = useAccount()
  const [activeChain, setActiveChain] = useState(getActiveChain())
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const getHasLiked = async () => {
    return isConnected ? await getHasLikedPost(id, address) : false
  }

  const likePost = (e, id) => {
    e.stopPropagation()

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    writeContract({
      abi,
      address: activeChain[1].post,
      functionName: 'likePost',
      args: [id],
    })
  }

  const unlikePost = (e, id) => {
    e.stopPropagation()

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    writeContract({
      abi,
      address: activeChain[1].post,
      functionName: 'unlikePost',
      args: [id],
    })
  }

  useEffect(() => { }, [id])

  // if (loading) {
  //   return <InlineLoading />
  // }

  if (error) {
    return <span>{error}</span>
  }

  return (
    <button onClick={(e) => (hasLiked ? unlikePost(e, id) : likePost(e, id))}>
      <svg width="18" height="18" viewBox="0 0 18 18" fill={hasLiked ? `#EC3838` : `none`} xmlns="http://www.w3.org/2000/svg">
        <path
          d="M12.6562 3.75C14.7552 3.75003 16.1562 5.45397 16.1562 7.53125V7.54102C16.1563 8.03245 16.1552 8.68082 15.8682 9.48828C15.5795 10.3003 15.0051 11.2653 13.8701 12.4004C12.0842 14.1864 10.1231 15.619 9.37988 16.1406C9.15102 16.3012 8.85009 16.3012 8.62109 16.1406C7.87775 15.6191 5.91688 14.1865 4.13086 12.4004H4.12988C2.99487 11.2653 2.42047 10.3003 2.13184 9.48828C1.84477 8.68054 1.84374 8.03163 1.84375 7.54004V7.53125C1.84375 5.45396 3.24485 3.75 5.34375 3.75C6.30585 3.75 7.06202 4.19711 7.64844 4.80273C8.01245 5.17867 8.31475 5.61978 8.56445 6.06152L9 6.83105L9.43555 6.06152C9.68527 5.61978 9.98756 5.17867 10.3516 4.80273C10.938 4.1971 11.6942 3.75 12.6562 3.75Z"
          stroke={hasLiked ? `#EC3838` : `#424242`}
        />
      </svg>
      <span>{likeCount}</span>
    </button>
  )
}

/**
 * Like
 * @param {*} param0
 * @returns
 */
const LikeComment = ({ commentId: id, likeCount }) => {
  const [hasLiked, setHasLiked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const isMounted = useClientMounted()
  const [activeChain, setActiveChain] = useState(getActiveChain())
  const { address, isConnected } = useAccount()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const getHasLiked = async () => {
    return isConnected ? await getHasLikedComment(id, address) : false
  }

  const likeComment = (e) => {
    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    console.log(id)

    writeContract({
      abi: commentAbi,
      address: activeChain[1].comment,
      functionName: 'likeComment',
      args: [Web3.utils.toNumber(id)],
    })
  }

  const unlikeComment = (e) => {
    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    writeContract({
      abi: commentAbi,
      address: activeChain[1].comment,
      functionName: 'unlikeComment',
      args: [Web3.utils.toNumber(id)],
    })
  }

  useEffect(() => {
    getHasLiked()
      .then((result) => {
        setHasLiked(result)
        setLoading(false)
      })
      .catch((err) => {
        console.log(err)
        setError(`⚠️`)
        setLoading(false)
      })
  }, [id])

  // if (loading) {
  //   return <InlineLoading />
  // }

  if (error) {
    return <span>{error}</span>
  }

  return (
    <button onClick={(e) => (hasLiked ? unlikeComment(e) : likeComment(e))}>
      <svg width="18" height="18" viewBox="0 0 18 18" fill={hasLiked ? `#EC3838` : `none`} xmlns="http://www.w3.org/2000/svg">
        <path
          d="M12.6562 3.75C14.7552 3.75003 16.1562 5.45397 16.1562 7.53125V7.54102C16.1563 8.03245 16.1552 8.68082 15.8682 9.48828C15.5795 10.3003 15.0051 11.2653 13.8701 12.4004C12.0842 14.1864 10.1231 15.619 9.37988 16.1406C9.15102 16.3012 8.85009 16.3012 8.62109 16.1406C7.87775 15.6191 5.91688 14.1865 4.13086 12.4004H4.12988C2.99487 11.2653 2.42047 10.3003 2.13184 9.48828C1.84477 8.68054 1.84374 8.03163 1.84375 7.54004V7.53125C1.84375 5.45396 3.24485 3.75 5.34375 3.75C6.30585 3.75 7.06202 4.19711 7.64844 4.80273C8.01245 5.17867 8.31475 5.61978 8.56445 6.06152L9 6.83105L9.43555 6.06152C9.68527 5.61978 9.98756 5.17867 10.3516 4.80273C10.938 4.1971 11.6942 3.75 12.6562 3.75Z"
          stroke={hasLiked ? `#EC3838` : `#424242`}
        />
      </svg>
      <span>{likeCount}</span>
    </button>
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
          profileImage: res.data.Profile[0].profileImages.length > 0 ? res.data.Profile[0].profileImages[0].src : `${process.env.NEXT_PUBLIC_IPFS_GATEWAY}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`,
          profileHeader: '',
          tags: JSON.stringify(res.data.tags),
          links: JSON.stringify(res.data.links_),
          lastUpdate: '',
        })
      } else {
        getProfile(addr).then((res) => {
          //  console.log(res)
          if (res.wallet) {
            const profileImage = res.profileImage !== '' ? `${process.env.NEXT_PUBLIC_UPLOAD_URL}${res.profileImage}` : `${process.env.NEXT_PUBLIC_IPFS_GATEWAY}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`
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
      <img alt={profile.name || `Default PFP`} src={`${profile.profileImage}`} className={`rounded`} />

      <figcaption className={`flex flex-column`}>
        <div className={`flex align-items-center gap-025`}>
          <b>{profile.name ?? defaultUsername}</b>
          <BlueCheckMarkIcon />
          <div className={`${styles.badge}`} title={activeChain && activeChain[0].name} dangerouslySetInnerHTML={{ __html: `${activeChain && activeChain[0].icon}` }}></div>
        </div>
        <code className={`text-secondary`}>{`${addr.slice(0, 4)}…${addr.slice(38)}`}</code>
      </figcaption>
    </figure>
  )
}
