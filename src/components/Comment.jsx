'use client'

import { useState, useEffect, useId, useRef, useCallback } from 'react'
import Link from 'next/link'
import moment from 'moment'
import { useParams, useRouter } from 'next/navigation'
import { useWaitForTransactionReceipt, useConnection, useWriteContract } from 'wagmi'
import {
  initPostContract,
  initPostCommentContract,
  getHasLikedPost,
  getVoteCountsForPoll,
  getVoterChoices,
} from '@/lib/communication'
import { getProfile, getUniversalProfile, getViewPost } from '@/lib/api'
import { useClientMounted } from '@/hooks/useClientMount'
import { getActiveChain } from '@/lib/communication'
import commentAbi from '@/abi/post-comment.json'
import { toast } from '@/components/NextToast'
import Profile from '@/components/Profile'
import {
  CommentIcon,
  ShareIcon,
  RepostIcon,
  BlueCheckMarkIcon,
  ViewIcon,
} from '@/components/Icons'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { getIPFS } from '@/lib/ipfs'
import MediaGallery from './Gallery'
import styles from './Post.module.scss'
import { Ellipsis } from 'lucide-react'

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

export default function Comment({ item, showContent, actions, chainId }) {
  console.log(item)
  const [postContent, setPostContent] = useState()
  const [showCommentModal, setShowCommentModal] = useState()
  const [showTipModal, setShowTipModal] = useState()
  const [showShareModal, setShowShareModal] = useState()
  const { web3, contract } = initPostContract()
  const mounted = useClientMounted()
  const { address, isConnected } = useConnection()
  const router = useRouter()
  const [viewCount, setViewCount] = useState(0)
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })
  const commentCount = Number(item.commentCount)

  useEffect(() => {
    if (navigator.vibrate) {
      navigator.vibrate(200)
    }

    if (chainId !== undefined) {
      getViewPost(chainId, item.postId).then((result) => {
        setViewCount(result)
      })
    }

    if (item.metadata !== ``) {
      getIPFS(item.metadata).then((result) => {
        setPostContent(result)
      })
    }

    // document.querySelectorAll(`video`).forEach((element) => {
    //   element.addEventListener(`clikc`, (e) => e.stopPropagation())
    // })
  }, [showCommentModal, showTipModal])

  return (
    <>
      {showCommentModal && postContent && (
        <CommentModal
          item={showCommentModal}
          postContent={postContent}
          setShowCommentModal={setShowCommentModal}
        />
      )}

      {showShareModal && (
        <ShareModal
          metadata={postContent}
          item={showShareModal}
          setShowShareModal={setShowShareModal}
        />
      )}
      {/* 
      {posts.list.length === 0 && <div className={`shimmer ${styles.pollShimmer}`} />} */}

      <section
        className={`${styles.post} flex flex-column align-items-start justify-content-between`}
        data-content={showContent ? true : false}
      >
        <header
          className={`${styles.post__header} flex align-items-start justify-content-between w-100`}
        >
          <Profile creator={item.creator} createdAt={item.createdAt} />
          <Nav item={item} />
        </header>

        {/* Main */}
        <main className={`${styles.post__main}`}>
          {/* Check if post contains metadata or not */}
          {postContent && postContent.elements && postContent.elements.length > 1 ? (
            <>
              <div
                className={`${styles.post__main__content} `}
                id={`post${item.postId}`}
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(`${postContent.elements[0].data.text}`),
                }}
              />

              <div className={`${styles.post__main__media}`}>
                {postContent && (
                  <>
                    <MediaGallery data={postContent.elements[1].data.items} />
                  </>
                )}
              </div>
            </>
          ) : (
            <div
              className={`${styles.post__content} `}
              id={`post${item.postId}`}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(`${item.content}`) }}
            />
          )}
        </main>

        <footer className={`${styles.post__footer}`}>
          <div
            onClick={(e) => e.stopPropagation()}
            className={`${styles.post__actions} flex flex-row align-items-center justify-content-start`}
          >
            {actions.find((action) => action.toLowerCase() === 'like') !== undefined && (
              <Like item={item} />
            )}

            {actions.find((action) => action.toLowerCase() === 'comment') !== undefined && (
              <>
                <button
                  onClick={(e) => {
                    setShowCommentModal({
                      data: item,
                      parentId: item.commentId,
                      type: `comment`,
                    })
                  }}
                >
                  <CommentIcon />
                  <span>{Number(item.replyCount) === 0 ? '' : Number(item.replyCount)}</span>
                </button>
              </>
            )}

            {actions.find((action) => action.toLowerCase() === 'repost') !== undefined && (
              <button>
                <RepostIcon />
              </button>
            )}

            {actions.find((action) => action.toLowerCase() === 'view') !== undefined && (
              <button>
                <ViewIcon />
                <span>
                  {viewCount === 0
                    ? ''
                    : new Intl.NumberFormat('en', {
                        notation: 'compact',
                        maximumFractionDigits: 1,
                      }).format(viewCount)}
                </span>
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
        </footer>
      </section>
    </>
  )
}

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
        <Ellipsis fill="currentColor" strokeWidth={1} width={18} height={18} />
      </button>

      {showPostDropdown && (
        <div
          className={`${styles.postDropdown} animate fade flex flex-column align-items-center justify-content-start gap-050`}
        >
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
      args: [Number(id), 0, commentContent, ''],
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

const ShareModal = ({ item, metadata, setShowShareModal }) => {
  const [hasLiked, setHasLiked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const activeChain = getActiveChain()

  console.log(metadata)

  // --- Dynamic Content ---
  const postUrl = `${location.protocol}//${window.location.host}/${activeChain[0].id}/p/${item.postId}`
  const postTitle =
    metadata && metadata.elements && metadata.elements.length > 1
      ? metadata.elements[0].data.text
      : item.content
  const hupHandle = 'hupsocial' // <-- Replace with your actual X handle (without the @)
  const postContent = `${postTitle}\n\n Creator: ${item.creator} \n\n`
  // --- Constructing the Share Link ---
  const shareLink =
    `https://twitter.com/intent/tweet?` +
    `text=${encodeURIComponent(postContent)}` +
    `&url=${encodeURIComponent(postUrl)}` +
    `&via=${hupHandle}` // <-- The recommended parameter for the handle

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
const Like = ({ item }) => {
  const [error, setError] = useState(null)
  const activeChain = getActiveChain()
  const { address, isConnected } = useConnection()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  // Contant
  const id =item.commentId
  const hasLiked = item.hasLiked
  const likeCount = item.likeCount

  const like = (e, id) => {
    e.stopPropagation()

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    writeContract({
      abi: commentAbi,
      address: activeChain[1].comment,
      functionName: 'likeComment',
      args: [Number(id)],
    })
  }

  const unlike = (e, id) => {
    e.stopPropagation()

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    writeContract({
      abi: commentAbi,
      address: activeChain[1].comment,
      functionName: 'unlikeComment',
      args: [Number(id)],
    })
  }

  useEffect(() => {}, [id])

  if (error) {
    return <span>{error}</span>
  }

  return (
    <button
      onClick={(e) => {
        if (isConnected) {
          hasLiked ? unlike(e, id) : like(e, id)
        } else toast(`Please connect wallet`, `error`)
      }}
      title={hasLiked ? `Unlike` : `Like`}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill={hasLiked ? `#EC3838` : `none`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12.6562 3.75C14.7552 3.75003 16.1562 5.45397 16.1562 7.53125V7.54102C16.1563 8.03245 16.1552 8.68082 15.8682 9.48828C15.5795 10.3003 15.0051 11.2653 13.8701 12.4004C12.0842 14.1864 10.1231 15.619 9.37988 16.1406C9.15102 16.3012 8.85009 16.3012 8.62109 16.1406C7.87775 15.6191 5.91688 14.1865 4.13086 12.4004H4.12988C2.99487 11.2653 2.42047 10.3003 2.13184 9.48828C1.84477 8.68054 1.84374 8.03163 1.84375 7.54004V7.53125C1.84375 5.45396 3.24485 3.75 5.34375 3.75C6.30585 3.75 7.06202 4.19711 7.64844 4.80273C8.01245 5.17867 8.31475 5.61978 8.56445 6.06152L9 6.83105L9.43555 6.06152C9.68527 5.61978 9.98756 5.17867 10.3516 4.80273C10.938 4.1971 11.6942 3.75 12.6562 3.75Z"
          stroke={hasLiked ? `#EC3838` : `#424242`}
        />
      </svg>
      {likeCount === 0 ? '' : <span>{likeCount}</span>}
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
