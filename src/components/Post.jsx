'use client'

import { useState, useEffect, useId, useRef, useCallback } from 'react'
import Link from 'next/link'
import moment from 'moment'
import { useParams, useRouter } from 'next/navigation'
import { useWaitForTransactionReceipt, useAccount, useWriteContract } from 'wagmi'
import { initPostContract, initPostCommentContract, getHasLikedPost, getVoteCountsForPoll, getVoterChoices } from '@/lib/communication'
import { getProfile, getUniversalProfile, getViewPost } from '@/lib/api'
import PollTimer from '@/components/PollTimer'
import Web3 from 'web3'
import { isPollActive } from '@/lib/utils'
import { useClientMounted } from '@/hooks/useClientMount'
import { config } from '@/config/wagmi'
import abi from '@/abi/post.json'
import { getActiveChain } from '@/lib/communication'
import commentAbi from '@/abi/post-comment.json'
import { toast } from '@/components/NextToast'
import Shimmer from '@/components/ui/Shimmer'
import { InlineLoading } from '@/components/Loading'
import Profile from '@/components/Profile'
import { CommentIcon, ShareIcon, RepostIcon, TipIcon, BlueCheckMarkIcon, ThreeDotIcon, ViewIcon } from '@/components/Icons'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { getIPFS } from '@/lib/ipfs'
import styles from './Post.module.scss'

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

/**
 * Converts Markdown to sanitized HTML with links set to open in a new tab.
 * @param {string} markdown - The markdown content to process.
 * @returns {string} The sanitized HTML.
 */
function renderMarkdown(markdown) {
  // 1. Create a custom renderer
  const renderer = new marked.Renderer()

  // 2. Override the link method to add target="_blank" and rel attributes
  renderer.link = (href, title, text) => {
    // Use the default marked behavior, but insert the desired attributes
    const link = marked.Renderer.prototype.link.call(renderer, href, title, text)

    // Add target="_blank" to open in a new tab
    // Add rel="noopener noreferrer" for security and performance best practices
    return link.replace(/^<a /, '<a  rel="noopener noreferrer" target="_blank"')
  }

  // 3. Configure marked to use the custom renderer
  marked.setOptions({
    renderer: renderer,
    gfm: true, // Generally good to enable GitHub Flavored Markdown
  })

  // 4. Render the markdown to HTML using the custom renderer
  const dirtyHtml = marked.parse(markdown)

  // 5. Sanitize the HTML using DOMPurify
  // DOMPurify is crucial for preventing XSS attacks from the rendered content
  const cleanHtml = DOMPurify.sanitize(dirtyHtml, {
    ADD_ATTR: ['target', 'rel'],
  })

  return cleanHtml
}

export default function Post({ item, showContent, actions, chainId }) {
  const [postContent, setPostContent] = useState()
  const [showCommentModal, setShowCommentModal] = useState()
  const [showTipModal, setShowTipModal] = useState()
  const [showShareModal, setShowShareModal] = useState()
  const { web3, contract } = initPostContract()
  const mounted = useClientMounted()
  const { address, isConnected } = useAccount()
  const router = useRouter()
  const [viewCount, setViewCount] = useState(0)
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  useEffect(() => {
    if (chainId !== undefined) {
      getViewPost(chainId, item.postId).then((result) => {
        setViewCount(result)
      })
    }

    if (item.metadata !== ``) {
      getIPFS(item.metadata).then((result) => {
        console.log(result)
        setPostContent(result)
      })
    }

    // document.querySelectorAll(`video`).forEach((element) => {
    //   element.addEventListener(`clikc`, (e) => e.stopPropagation())
    // })
  }, [showCommentModal, showTipModal])

  return (
    <>
      {showCommentModal && <CommentModal item={showCommentModal} setShowCommentModal={setShowCommentModal} />}
      {showTipModal && <TipModal item={showTipModal} setShowTipModal={setShowTipModal} />}
      {showShareModal && <ShareModal item={showShareModal} setShowShareModal={setShowShareModal} />}
      {/* 
      {posts.list.length === 0 && <div className={`shimmer ${styles.pollShimmer}`} />} */}

      <section className={`${styles.post} flex flex-column align-items-start justify-content-between`}>
        <header className={`${styles.post__header} flex align-items-start justify-content-between w-100`}>
          <Profile creator={item.creator} createdAt={item.createdAt} />
          <Nav item={item} />
        </header>
        <main className={`${styles.post__main}`}>
          {/* Check if post contains metadata or not */}
          {postContent && postContent.elements && postContent.elements.length > 1 ? (
            <>
              <div
                className={`${styles.post__content} `}
                id={`post${item.postId}`}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(`${postContent.elements[0].data.text}`) }}
              />
              <div className="flex flex-wrap gap-4 mb-4">
                {postContent &&
                  postContent.elements[1].data.items.map((item, index) => (
                    <div key={index} className="">
                      {item.type === 'image' ? (
                        <>
                          <figure>
                            <img src={`${process.env.NEXT_PUBLIC_GATEWAY_URL}${item.cid}`} alt="" style={{ width: `100%`, aspectRatio: `1/1` }} />
                          </figure>
                        </>
                      ) : (
                        <video src={`${process.env.NEXT_PUBLIC_GATEWAY_URL}${item.cid}`} controls style={{ width: `100%`, }} />
                      )}
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <>
              <div
                className={`${styles.post__content} `}
                id={`post${item.postId}`}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(`${item.content}`) }}
              />
            </>
          )}

          {/* style={{ maxHeight: `${showContent ? 'fit-content' : '150px'}` }} */}

          <div onClick={(e) => e.stopPropagation()} className={`${styles.post__actions} flex flex-row align-items-center justify-content-start`}>
            {actions.find((action) => action.toLowerCase() === 'like') !== undefined && (
              <Like id={item.postId} likeCount={item.likeCount} hasLiked={item.hasLiked} />
            )}

            {actions.find((action) => action.toLowerCase() === 'comment') !== undefined && (
              <>
                {item.allowedComments && (
                  <button
                    onClick={() => {
                      isConnected ? setShowCommentModal(item) : toast(`Please connect wallet`, `error`)
                    }}
                  >
                    <CommentIcon />
                    <span>{item.commentCount}</span>
                  </button>
                )}
              </>
            )}

            {actions.find((action) => action.toLowerCase() === 'repost') !== undefined && (
              <button>
                <RepostIcon />
                <span>0</span>
              </button>
            )}

            {actions.find((action) => action.toLowerCase() === 'tip') !== undefined && (
              <button
                onClick={() => {
                  isConnected ? setShowTipModal(item) : toast(`Please connect wallet`, `error`)
                }}
              >
                <TipIcon />
                <span>{new Intl.NumberFormat().format(0)}</span>
              </button>
            )}

            {actions.find((action) => action.toLowerCase() === 'view') !== undefined && (
              <button>
                <ViewIcon />
                <span>{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(viewCount)}</span>
              </button>
            )}

            {actions.find((action) => action.toLowerCase() === 'share') !== undefined && (
              <button
                onClick={() => {
                  isConnected ? setShowShareModal(item) : toast(`Please connect wallet`, `error`)
                }}
              >
                <ShareIcon />
              </button>
            )}
          </div>
        </main>
      </section>
    </>
  )
}

const PostImage = () => {}

const Nav = ({ item }) => {
  const [showPostDropdown, setShowPostDropdown] = useState()
  const activeChain = getActiveChain()

  return (
    <div className={`relative`}>
      <button
        className={`${styles.btnPostMenu} rounded`}
        onClick={(e) => {
          e.stopPropagation()
          setShowPostDropdown(!showPostDropdown)
        }}
      >
        <ThreeDotIcon />
      </button>

      {showPostDropdown && (
        <div className={`${styles.postDropdown} animate fade flex flex-column align-items-center justify-content-start gap-050`}>
          <ul>
            <li>
              <Link href={`/${activeChain[0].id}/p/${item.postId}`}>View post</Link>
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
            {isSigning ? `Signing...` : isConfirming ? 'Confirming...' : status && status.content !== '' ? `Update` : `Share`}
          </div>
        </header>

        <main className={`${styles.modal__container__main}`}>
          <article className={`${styles.modal__post}`}>
            <section className={`flex flex-column align-items-start justify-content-between`}>
              <header className={`${styles.modal__post__header}`}>
                <Profile creator={item.creator} createdAt={item.createdAt} />
              </header>
              <main className={`${styles.modal__post__main} w-100 flex flex-column grid--gap-050`}>
                <div
                  className={`${styles.post__content} `}
                  id={`post${item.postId}`}
                  style={{ maxHeight: 'fit-content' }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(`${item.content}`) }}
                />
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

const TipModal = ({ item, setShowTipModal }) => {
  const [hasLiked, setHasLiked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [amount, setAmount] = useState(1)
  const isMounted = useClientMounted()
  const [commentContent, setCommentContent] = useState('')
  const { address, isConnected } = useAccount()
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

  const handleTip = (e, id) => {
    e.stopPropagation()

    toast(`Coming soon`)
    return

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
    <div
      className={`${styles.modal} ${styles.modalTip} animate fade`}
      onClick={(e) => {
        e.stopPropagation()
        setShowTipModal()
      }}
    >
      <div className={`${styles.modal__container}`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div className={``} aria-label="Close" onClick={() => setShowTipModal()}>
            Cancel
          </div>
          <div className={`flex-1`}>
            <h3>Support creator</h3>
          </div>
          <div className={`pointer`} onClick={(e) => updateStatus(e)}>
            {isSigning ? `Signing...` : isConfirming ? 'Confirming...' : status && status.content !== '' ? `Update` : ``}
          </div>
        </header>

        <main className={`flex flex-column align-items-start justify-content-between gap-050`}>
          <div className={`flex flex-column align-items-start justify-content-between`}>
            <label htmlFor="">Post ID</label>
            <input type="text" name="" id="" value={`${item.postId}`} placeholder={``} disabled />
          </div>

          <div className={`flex flex-column align-items-start justify-content-between`}>
            <label htmlFor="">From</label>
            <input type="text" name="" id="" value={`${address}`} placeholder={``} disabled />
          </div>

          <div className={`flex flex-column align-items-start justify-content-between`}>
            <label htmlFor="">To {address.toLowerCase() === item.creator.toLowerCase() && `(Yourself)`}</label>
            <input type="text" name="" id="" value={`${item.creator}`} placeholder={``} disabled />
          </div>

          <div className={`flex flex-column align-items-start justify-content-between`}>
            <label htmlFor="">Token</label>
            <select name="" id="">
              <option value="">{`${activeChain[0].nativeCurrency.name} (${activeChain[0].nativeCurrency.symbol})`}</option>
            </select>
          </div>

          <div className={`flex flex-column align-items-start justify-content-between`}>
            <label htmlFor="">Amount</label>

            <div className={`${styles.tipAmount} w-100 flex flex-row align-items-start justify-content-between gap-025`}>
              <input type="number" name="" id="" value={amount} min={1} onChange={(e) => setAmount(e.target.value)} placeholder={`0`} />
              <button onClick={() => setAmount(2)}>2</button>
              <button onClick={() => setAmount(5)}>5</button>
              <button onClick={() => setAmount(10)}>10</button>
            </div>
          </div>
        </main>

        <footer className={``}>
          <button className="" onClick={(e) => handleTip(e, item.postId)} disabled={amount < 1}>
            Send
          </button>
        </footer>
      </div>
    </div>
  )
}

const ShareModal = ({ item, setShowShareModal }) => {
  const [hasLiked, setHasLiked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const activeChain = getActiveChain()

  // --- Dynamic Content ---
  const postUrl = `${location.protocol}//${window.location.host}/${activeChain[0].id}/p/${item.postId}`
  const postTitle = item.content
  const hupHandle = 'hupsocial' // <-- Replace with your actual X handle (without the @)
  const postContent = `${postTitle}\n\n Creator: ${item.creator} \n\n`
  // --- Constructing the Share Link ---
  const shareLink =
    `https://twitter.com/intent/tweet?` + `text=${encodeURIComponent(postContent)}` + `&url=${encodeURIComponent(postUrl)}` + `&via=${hupHandle}` // <-- The recommended parameter for the handle

  useEffect(() => {}, [item])

  // if (loading) {
  //   return <InlineLoading />
  // }

  if (error) {
    return <span>{error}</span>
  }

  return (
    <div
      className={`${styles.modal} ${styles.shareModal} animate fade`}
      onClick={(e) => {
        e.stopPropagation()
        setShowShareModal()
      }}
    >
      <div className={`${styles.modal__container}`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div className={``} aria-label="Close" onClick={() => setShowShareModal()}>
            Cancel
          </div>
          <div className={`flex-1`}>
            <h3>Share post</h3>
          </div>
        </header>

        <main className={`flex flex-column align-items-start justify-content-between gap-050`}>
          <a href={`${shareLink}`} target={`_blank`} className="">
            Share on 𝕏
          </a>
        </main>

        <footer className={``}></footer>
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
  const activeChain = getActiveChain()
  const { address, isConnected } = useAccount()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const getHasLiked = async () => {
    return isConnected ? await getHasLikedPost(Web3.utils.toNumber(id), address) : false
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
  }, [id])

  // if (loading) {
  //   return <InlineLoading />
  // }

  if (error) {
    return <span>{error}</span>
  }

  return (
    <button
      onClick={(e) => {
        if (isConnected) {
          hasLiked ? unlikePost(e, id) : likePost(e, id)
        } else toast(`Please connect wallet`, `error`)
      }}
    >
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
                  <div
                    className={`${styles.poll__question} `}
                    onClick={(e) => e.stopPropagation()}
                    id={`pollQuestion${item.pollId}`}
                    dangerouslySetInnerHTML={{ __html: `<p>${item.question}</p>` }}
                  />

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
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`${styles.poll__actions} flex flex-row align-items-center justify-content-start`}
                  >
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
              : `${process.env.NEXT_PUBLIC_IPFS_GATEWAY}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`,
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
                : `${process.env.NEXT_PUBLIC_IPFS_GATEWAY}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`
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
