'use client'

import { useState, useEffect, useId, useRef, useCallback } from 'react'
import { FluentProvider, webLightTheme, Badge } from '@fluentui/react-components'
import Link from 'next/link'
import moment from 'moment'
import txIcon from '@/../public/icons/tx.svg'
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
} from '@/util/communication'
import { getProfile } from '@/util/api'
import PollTimer from '@/components/PollTimer'
import { useAuth } from '@/contexts/AuthContext'
import Web3 from 'web3'
import { isPollActive } from '@/util/utils'
import { useClientMounted } from '@/hooks/useClientMount'
import { config } from '@/config/wagmi'
import abi from '@/abi/post.json'
import commentAbi from '@/abi/post-comment.json'
import { toast } from '@/components/NextToast'
import Shimmer from '@/helper/Shimmer'
import { InlineLoading } from '@/components/Loading'
import Profile, { ProfileImage } from '@/app/ui/Profile'
import { CommentIcon, ShareIcon, RepostIcon, TipIcon, InfoIcon, BlueCheckMarkIcon } from '@/components/Icons'
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

export default function Page() {
  const [post, setPost] = useState()

  const [comments, setComments] = useState({ list: [] })
  const [commentsLoaded, setcommentsLoaded] = useState(0)
  const [reactionCounter, setReactionCounter] = useState(0)
  const [commentCount, setCommentCount] = useState(0)
  const [isLoadedComment, setIsLoadedPoll] = useState(false)
  const [showCommentModal, setShowCommentModal] = useState()
  const { web3, contract } = initPostContract()
  const giftModal = useRef()
  const giftModalMessage = useRef()
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
      let showingCommentCount = 7
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
      const newComments = await getCommentsByPostId(params.id, startIndex, showingCommentCount)
      console.log(`newComments => `, newComments)
      newComments.reverse()

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
    getPostByIndex(params.id).then((res) => {
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

    const handleScroll = () => {
      const scrolledTo = window.scrollY + window.innerHeight
      // Use a small buffer (e.g., -100px) for better UX
      const isReachBottom = document.body.scrollHeight - 100 < scrolledTo

      // **Now this check prevents simultaneous loads**
      if (isReachBottom && !isLoadedComment) {
        loadMoreComment()
      }
    }
  }, [showCommentModal]) // Added necessary dependencies  [isLoadedComment, commentsLoaded]

  return (
    <div className={`${styles.page} ms-motion-slideDownIn`}>
      <h3 className={`page-title`}>home</h3>

      {showCommentModal && <CommentModal item={showCommentModal} setShowCommentModal={setShowCommentModal} />}

      <div className={`__container ${styles.page__container}`} data-width={`medium`}>
        {!post && <div className={`shimmer ${styles.pollShimmer}`} />}
        <div className={`${styles.grid} flex flex-column`}>
          {post &&(
                <article className={`${styles.post} animate fade`}>
                  <section data-name={post.name} className={`flex flex-column align-items-start justify-content-between`}>
                    <header className={`${styles.post__header}`}>
                      <Profile creator={post.creator} createdAt={post.createdAt} />
                    </header>
                    <main className={`${styles.post__main} w-100 flex flex-column grid--gap-050`}>
                      <div
                        className={`${styles.post__content} `}
                        // onClick={(e) => e.stopPropagation()}
                        id={`pollQuestion${post.pollId}`}
                      >
                        {post.content}
                      </div>

                      <div onClick={(e) => e.stopPropagation()} className={`${styles.post__actions} flex flex-row align-items-center justify-content-start`}>
                        <Like id={post.postId} likeCount={post.likeCount} />

                        {post.allowedComments && (
                          <button onClick={() => setShowCommentModal(post)}>
                            <CommentIcon />
                            <span>{post.commentCount}</span>
                          </button>
                        )}

                        <button>
                          <RepostIcon />
                        </button>

                        <button>
                          <ShareIcon />
                          <span>0</span>
                        </button>

                        <button>
                          <TipIcon />
                          <span>{new Intl.NumberFormat().format(0)}</span>
                        </button>
                        {/* <Link target={`_blank`} href={`https://exmaple.com/tx/`} className={`flex flex-row align-items-center gap-025  `}>
                          <img alt={`blue checkmark icon`} src={txIcon.src} />
                        </Link> */}
                      </div>
                    </main>
                  </section>
           <hr />
                </article>
              )}
        </div>

        <hr />

        {comments &&
          comments.list.length > 0 &&
          comments.list.map((item, i) => {
            return (
              <div key={i}>
                <div className={`${styles.comment}`}>
                  <Profile creator={item.creator} createdAt={item.createdAt} />

                  <div className={`${styles.comment__content}`}>
                    <p>{item.content}</p>
                    <div className={`${styles.comment__actions} flex flex-row align-items-center justify-content-start`}>
                      <LikeComment commentId={item.commentId} likeCount={item.likeCount} />

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
          <div className={`${styles.reply} flex align-items-center gap-025`} onClick={() => setShowCommentModal(post)}>
            <ProfileImage addr={address} />
            <p>Reply to {address}</p>
          </div>
        )}
      </div>

      {commentsLoaded !== commentCount && (
        <button className={`${styles.loadMore}`} onClick={() => loadMoreComment(postCount)}>
          Load More
        </button>
      )}
    </div>
  )
}


const CommentModal = ({ item, setShowCommentModal }) => {
  const [hasLiked, setHasLiked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const isMounted = useClientMounted()
  const [commentContent, setCommentContent] = useState('')
  const { address, isConnected } = useAccount()
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
    //  const web3 = new Web3(window.lukso)

    //   // // Create a Contract instance
    //   const contract = new web3.eth.Contract(commentAbi, process.env.NEXT_PUBLIC_CONTRACT_POST_COMMENT)

    //     window.lukso.request({ method: 'eth_requestAccounts' }).then((accounts) => {
    //       contract.methods
    //         .addComment(web3.utils.toNumber(id), commentContent, '')
    //         .send({
    //           from: accounts[0],
    //         })
    //         .then((res) => {
    //           console.log(res)
    //           toast(`Done`)
    //         })
    //         .catch((error) => {
    //           console.log(error)
    //           toast.dismiss(t)
    //         })
    //     })
    //     //-------------------------------

    writeContract({
      abi: commentAbi,
      address: process.env.NEXT_PUBLIC_CONTRACT_POST_COMMENT,
      functionName: 'addComment',
      args: [web3.utils.toNumber(id), 0, commentContent, ''],
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
      address: process.env.NEXT_PUBLIC_CONTRACT_POST,
      functionName: 'unlikePost',
      args: [id],
    })
  }

  useEffect(() => {
    // getHasLiked()
    //   .then((result) => {
    //     setHasLiked(result)
    //     setLoading(false)
    //   })
    //   .catch((err) => {
    //     console.log(err)
    //     setError(`⚠️`)
    //     setLoading(false)
    //   })
  }, [item])

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
            <h3>Post your reply</h3>
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
          <textarea autoFocus defaultValue={commentContent} onInput={(e) => setCommentContent(e.target.value)} placeholder={`Reply to ${item.creator}`} />
          <button className="btn" onClick={(e) => postComment(e, item.postId)}>
            Post comment
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
const Like = ({ id, likeCount }) => {
  const [hasLiked, setHasLiked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const isMounted = useClientMounted()
  const { address, isConnected } = useAccount()
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
      address: process.env.NEXT_PUBLIC_CONTRACT_POST,
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
      address: process.env.NEXT_PUBLIC_CONTRACT_POST,
      functionName: 'unlikePost',
      args: [id],
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



    writeContract({
      abi: commentAbi,
      address: process.env.NEXT_PUBLIC_CONTRACT_POST_COMMENT,
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
      address: process.env.NEXT_PUBLIC_CONTRACT_POST_COMMENT,
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
const ConnectedProfile = ({ addr, chainId = 4201 }) => {
  const [profile, setProfile] = useState()
  const [chain, setChain] = useState()
  const defaultUsername = `hup-user`

  useEffect(() => {
    getProfile(addr).then((res) => {
      if (res.data && Array.isArray(res.data.Profile) && res.data.Profile.length > 0) {
        setProfile(res)
      } else {
        setProfile({
          data: {
            Profile: [
              {
                fullName: 'annonymous',
                name: 'annonymous',
                tags: ['profile'],
                profileImages: [
                  {
                    isSVG: true,
                    src: `${toSvg(`${creator}`, 36)}`,
                    url: 'ipfs://',
                  },
                ],
              },
            ],
          },
        })
      }
    })

    setChain(config.chains.filter((filterItem) => filterItem.id === chainId)[0])
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
      {!profile.data.Profile[0].profileImages[0]?.isSVG ? (
        <img
          alt={profile.data.Profile[0].name || `Default PFP`}
          src={`${profile.data.Profile[0].profileImages.length > 0 ? profile.data.Profile[0].profileImages[0].src : 'https://ipfs.io/ipfs/bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm'}`}
          className={`rounded`}
        />
      ) : (
        <div dangerouslySetInnerHTML={{ __html: profile.data.Profile[0].profileImages[0].src }}></div>
      )}
      <figcaption className={`flex flex-column`}>
        <div className={`flex align-items-center gap-025`}>
          <b>{profile.data.Profile[0].name ?? defaultUsername}</b>
          <BlueCheckMarkIcon />
          <div className={`${styles.badge}`} title={chain && chain.name} dangerouslySetInnerHTML={{ __html: `${chain && chain.icon}` }}></div>
        </div>
        <code className={`text-secondary`}>{`${addr.slice(0, 4)}…${addr.slice(38)}`}</code>
      </figcaption>
    </figure>
  )
}
