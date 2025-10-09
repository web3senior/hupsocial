'use client'

import { useState, useEffect, useId, useRef, useCallback } from 'react'
import { FluentProvider, webLightTheme, Badge } from '@fluentui/react-components'
import Link from 'next/link'
import moment from 'moment'
import txIcon from '@/../public/icons/tx.svg'
import { useParams, useRouter } from 'next/navigation'
import { useConnectorClient, useConnections, useClient, networks, useWaitForTransactionReceipt, useAccount, useDisconnect, Connector, useConnect, useWriteContract, useReadContract } from 'wagmi'
import { initPostContract, initPostCommentContract, getPosts, getHasLikedPost, getPollLikeCount, getPostCount, getVoteCountsForPoll, getVoterChoices } from '@/util/communication'
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
import Profile from '@/app/ui/Profile'
import { CommentIcon, ShareIcon, RepostIcon, TipIcon, InfoIcon, BlueCheckMarkIcon, ThreeDotIcon } from '@/components/Icons'
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
  const [posts, setPosts] = useState({ list: [] })
  const [postsLoaded, setPostsLoaded] = useState(0)
  const [isLoadedPoll, setIsLoadedPoll] = useState(false)
  const [reactionCounter, setReactionCounter] = useState(0)
  const [postCount, setPostCount] = useState()
  const [showCommentModal, setShowCommentModal] = useState()
  const { web3, contract } = initPostContract()
  const giftModal = useRef()
  const giftModalMessage = useRef()
  const mounted = useClientMounted()
  const params = useParams()
  const { address, isConnected } = useAccount()
  const router = useRouter()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const loadMorePosts = async (totalPoll) => {
    // 1. **Add a guard clause to prevent re-entry**
    if (isLoadedPoll) return

    // 2. Set to true *before* starting the async operation
    setIsLoadedPoll(true)

    try {
      let postsPerPage = 20
      let startIndex = totalPoll - postsLoaded - postsPerPage

      // **Stop loading if all posts are accounted for**
      if (postsLoaded >= totalPoll) {
        console.log('All polls loaded.')
        // We can return here, but still need to handle setIsLoadedPoll(false)
      }

      if (startIndex < 0) {
        // Check if we are trying to load past the first post
        postsPerPage = totalPoll - postsLoaded
        startIndex = 0
        if (postsPerPage <= 0) {
          // All loaded
          console.log('All polls loaded.')
          return // Exit early
        }
      }

      // ... (rest of your logic for calculating startIndex/postsPerPage) ...

      // 3. Fetch the next batch of polls
      console.log(startIndex + 1, postsPerPage)
      const newPosts = await getPosts(startIndex + 1, postsPerPage)
      console.log(`newPosts => `, newPosts)
      newPosts.reverse()

      if (Array.isArray(newPosts) && newPosts.length > 0) {
        setPosts((prevPolls) => ({ list: [...prevPolls.list, ...newPosts] }))
        setPostsLoaded((prevLoaded) => prevLoaded + newPosts.length)
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
    /**
     * 
     *getPollByIndex(params.id).then((res) => {
      console.log(res)
      res.pollId = params.id
      setPolls({ list: res })
    })
     */

    getPostCount().then((count) => {
      const totalPoll = web3.utils.toNumber(count)
      setPostCount(totalPoll)

      if (postsLoaded === 0 && !isLoadedPoll) {
        loadMorePosts(totalPoll)
      }
    })

    const handleScroll = () => {
      const scrolledTo = window.scrollY + window.innerHeight
      // Use a small buffer (e.g., -100px) for better UX
      const isReachBottom = document.body.scrollHeight - 100 < scrolledTo

      // **Now this check prevents simultaneous loads**
      if (isReachBottom && !isLoadedPoll) {
        loadMorePosts()
      }
    }
  }, [showCommentModal]) // Added necessary dependencies  [isLoadedPoll, postsLoaded]

  return (
    <div className={`${styles.page} ms-motion-slideDownIn`}>
      <h3 className={`page-title`}>home</h3>

      {showCommentModal && <CommentModal item={showCommentModal} setShowCommentModal={setShowCommentModal} />}

      <div className={`__container ${styles.page__container}`} data-width={`medium`}>
        {posts.list.length === 0 && <div className={`shimmer ${styles.pollShimmer}`} />}
        <div className={`${styles.grid} flex flex-column`}>
          {posts &&
            posts.list.length > 0 &&
            posts.list.map((item, i) => {
              return (
                <article key={i} className={`${styles.post} animate fade`} 
                onClick={() => router.push(`p/${item.postId}`)}>
                  <section data-name={item.name} className={`flex flex-column align-items-start justify-content-between`}>
                    <header className={`${styles.post__header} flex align-items-start justify-content-between`}>
                      <Profile creator={item.creator} createdAt={item.createdAt} />
                      <Nav item={item}/>
                    </header>
                    <main className={`${styles.post__main} w-100 flex flex-column grid--gap-050`}>
                      <div className={`${styles.post__content} `} onClick={(e) => e.stopPropagation()} id={`pollQuestion${item.pollId}`}>
                        {item.content}
                      </div>

                      <div onClick={(e) => e.stopPropagation()} className={`${styles.post__actions} flex flex-row align-items-center justify-content-start`}>
                        <Like id={item.postId} likeCount={item.likeCount} />

                        {item.allowedComments && (
                          <button onClick={() => setShowCommentModal(item)}>
                            <CommentIcon />
                            <span>{item.commentCount}</span>
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
                  {i < posts.list.length - 1 && <hr />}
                </article>
              )
            })}
        </div>
      </div>

      {postsLoaded !== postCount && (
        <button className={`${styles.loadMore}`} onClick={() => loadMorePosts(postCount)}>
          Load More
        </button>
      )}
    </div>
  )
}

const Nav = ({item}) => {
  const [showPostDropdown, setShowPostDropdown] = useState()

  return (
    <div className={`relative`}>
      <button className={`${styles.btnPostMenu} rounded`} onClick={(e) => {
        e.stopPropagation()
        setShowPostDropdown(!showPostDropdown)
      }}>
        <ThreeDotIcon />
      </button>

      {showPostDropdown && (
        <div className={`${styles.postDropdown} animate fade flex flex-column align-items-center justify-content-start gap-050`}>
          <ul>
            <li>
              <Link href={`p/${item.postId}`}>View post</Link>
            </li>
          </ul>
        </div>
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

const Poll = ({ polls }) => {
  return (
    <>
      {polls &&
        polls.list.length > 0 &&
        polls.list.map((item, i) => {
          return (
            <article key={i} className={`${styles.poll} animate fade`} onClick={() => router.push(`p/${item.pollId}`)}>
              <section data-name={item.name} className={`flex flex-column align-items-start justify-content-between`}>
                <header className={`${styles.poll__header}`}>
                  <Profile creator={item.creator} createdAt={item.createdAt} chainId={4201} />
                </header>
                <main className={`${styles.poll__main} w-100 flex flex-column grid--gap-050`}>
                  <div className={`${styles.poll__question} `} onClick={(e) => e.stopPropagation()} id={`pollQuestion${item.pollId}`} dangerouslySetInnerHTML={{ __html: `<p>${item.question}</p>` }} />

                  {item.question.length > 150 && (
                    <button
                      className={`${styles.poll__btnShowMore} text-left`}
                      onClick={(e) => {
                        e.stopPropagation()
                        document.querySelector(`#pollQuestion${item.pollId}`).style.maxHeight = `unset !important`
                        e.target.remove()
                      }}
                    >
                      <b className={`text-primary`}>Show More</b>
                    </button>
                  )}
                  <div onClick={(e) => e.stopPropagation()} className={`${styles.poll__actions} flex flex-row align-items-center justify-content-start`}>
                    {<LikeCount pollId={item.pollId} />}

                    {item.allowedComments && (
                      <button>
                        <CommentIcon />

                        <span>{0}</span>
                      </button>
                    )}

                    <button></button>

                    <button>
                      <ShareIcon />
                    </button>

                    <button>
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                          d="M12 8.16338C12.1836 8.16338 12.3401 8.09875 12.4695 7.9695C12.5988 7.84012 12.6634 7.68363 12.6634 7.5C12.6634 7.31638 12.5988 7.15988 12.4695 7.0305C12.3401 6.90125 12.1836 6.83663 12 6.83663C11.8164 6.83663 11.6599 6.90125 11.5305 7.0305C11.4013 7.15988 11.3366 7.31638 11.3366 7.5C11.3366 7.68363 11.4013 7.84012 11.5305 7.9695C11.6599 8.09875 11.8164 8.16338 12 8.16338ZM6 6.5625H9.75V5.4375H6V6.5625ZM3.65625 15.375C3.26013 14.0076 2.86425 12.6471 2.46863 11.2933C2.07288 9.93944 1.875 8.55 1.875 7.125C1.875 6.08075 2.23894 5.19469 2.96681 4.46681C3.69469 3.73894 4.58075 3.375 5.625 3.375H9.5625C9.90575 2.924 10.3176 2.56125 10.7979 2.28675C11.2782 2.01225 11.8039 1.875 12.375 1.875C12.5818 1.875 12.7584 1.94831 12.9051 2.09494C13.0517 2.24156 13.125 2.41825 13.125 2.625C13.125 2.676 13.118 2.72694 13.104 2.77781C13.0901 2.82881 13.0755 2.87594 13.0601 2.91919C12.9909 3.09994 12.9319 3.28506 12.8833 3.47456C12.8348 3.66394 12.7933 3.85525 12.7586 4.0485L14.7101 6H16.125V10.5821L14.0783 11.2543L12.8438 15.375H9.375V13.875H7.125V15.375H3.65625ZM4.5 14.25H6V12.75H10.5V14.25H12L13.1625 10.3875L15 9.76875V7.125H14.25L11.625 4.5C11.625 4.25 11.6406 4.00938 11.6719 3.77813C11.7031 3.54688 11.7548 3.31488 11.8269 3.08213C11.4644 3.18213 11.1481 3.35644 10.8778 3.60506C10.6077 3.85356 10.4005 4.15188 10.2563 4.5H5.625C4.9 4.5 4.28125 4.75625 3.76875 5.26875C3.25625 5.78125 3 6.4 3 7.125C3 8.35 3.16875 9.54688 3.50625 10.7156C3.84375 11.8844 4.175 13.0625 4.5 14.25Z"
                          fill="#424242"
                        />
                      </svg>
                      <span>{new Intl.NumberFormat().format(0)}</span>
                    </button>
                    {/* <Link target={`_blank`} href={`https://exmaple.com/tx/`} className={`flex flex-row align-items-center gap-025  `}>
                          <img alt={`blue checkmark icon`} src={txIcon.src} />
                        </Link> */}
                  </div>
                </main>
              </section>
              {i < polls.length - 1 && <hr />}
            </article>
          )
        })}
    </>
  )
}

/**
 * Options
 * @param {Object} item
 * @returns
 */
const Options = ({ item }) => {
  const [status, setStatus] = useState(`loading`)
  const [optionsVoteCount, setOptionsVoteCount] = useState()
  const [voted, setVoted] = useState()
  const [topOption, setTopOption] = useState()
  const [totalVotes, setTotalVotes] = useState(0)
  const { web3, contract: readOnlyContract } = initPostContract()
  const { address, isConnected } = useAccount()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const vote = async (e, pollId, optionIndex) => {
    e.stopPropagation()
    console.log(isPollActive(item.startTime, item.endTime))

    if (isPollActive(item.startTime, item.endTime).status === `endeed`) {
      return
    }

    if (isPollActive(item.startTime, item.endTime).status === `willstart`) {
      toast(`Poll is not active yet.`, `warning`)
      return
    }

    if (voted) {
      return
    }

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    writeContract({
      abi,
      address: process.env.NEXT_PUBLIC_CONTRACT_POST,
      functionName: 'vote',
      args: [pollId, optionIndex],
    })
  }

  useEffect(() => {
    getVoteCountsForPoll(web3.utils.toNumber(item.pollId)).then((res) => {
      setOptionsVoteCount(res)
      setTotalVotes(res.reduce((a, b) => web3.utils.toNumber(a) + web3.utils.toNumber(b), 0))

      // 1. Map the array to convert all BigInts to standard numbers.
      const numbers = res.map((n) => web3.utils.toNumber(n))

      // 2. Find the maximum of the resulting standard numbers.
      const largestOne = Math.max(...numbers)

      setTopOption(largestOne)

      setStatus(``)
    })

    // Get connected wallet choice
    if (isConnected) {
      getVoterChoices(web3.utils.toNumber(item.pollId), address).then((res) => {
        if (web3.utils.toNumber(res) > 0) setVoted(web3.utils.toNumber(res))
      })
    }
  }, [item])

  if (status === `loading`)
    return (
      <>
        <div className={`shimmer ${styles.optionShimmer}`} />
        <div className={`shimmer ${styles.optionShimmer}`} />
        <div className={`shimmer ${styles.optionShimmer}`} />
      </>
    )

  return (
    <>
      <ul className={`${styles.poll__options} flex flex-column gap-050 w-100`}>
        {item.options.map((option, i) => {
          const votePercentage = totalVotes > 0 ? ((web3.utils.toNumber(optionsVoteCount[i]) / totalVotes) * 100).toFixed() : 0
          return (
            <li
              key={i}
              title={``}
              data-votes={web3.utils.toNumber(optionsVoteCount[i])}
              data-chosen={voted && voted === i + 1 ? true : false}
              style={{ '--data-width': `${votePercentage}%` }}
              data-percentage={votePercentage}
              data-isactive={isPollActive(item.startTime, item.endTime).isActive}
              data-top-option={topOption && topOption === i + 1 ? true : false}
              className={`${voted && voted > 0 && styles.showPercentage} ${
                isPollActive(item.startTime, item.endTime).status === `endeed` ? styles.poll__options__optionEndeed : styles.poll__options__option
              } flex flex-row align-items-center justify-content-between`}
              onClick={(e) => vote(e, web3.utils.toNumber(item.pollId), i)}
              disabled={isPending || isConfirming}
            >
              <span>{option}</span>
            </li>
          )
        })}
      </ul>

      <p className={`${styles.poll__footer}`}>
        {optionsVoteCount && <>{totalVotes}</>} votes • {` `}
        <PollTimer startTime={item.startTime} endTime={item.endTime} pollId={item.pollId} />
      </p>
    </>
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
