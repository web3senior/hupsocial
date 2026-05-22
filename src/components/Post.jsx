'use client'

import { useState, useEffect, useId, useRef, useCallback } from 'react'
import { useMemo } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useWaitForTransactionReceipt, useConnection, useWriteContract } from 'wagmi'
import { initPostContract, initPostCommentContract, getHasLikedPost, getVoteCountsForPoll, getVoterChoices } from '@/lib/communication'
import { getPostById, getProfile, getUniversalProfile, getViewPost } from '@/lib/api'
import PollTimer from '@/components/PollTimer'
import { isPollActive } from '@/lib/utils'
import { useClientMounted } from '@/hooks/useClientMount'
import abi from '@/abi/post.json'
import { getActiveChain } from '@/lib/communication'
import commentAbi from '@/abi/post-comment.json'
import { toast } from '@/components/NextToast'
import Profile from '@/components/Profile'
import { CommentIcon, ShareIcon, TipIcon, BlueCheckMarkIcon, ViewIcon } from '@/components/Icons'
import MediaGallery from './Gallery'
import { Ellipsis } from 'lucide-react'
import { Repeat2 } from 'lucide-react'
import { MessageCircle } from 'lucide-react'
import { Heart } from 'lucide-react'
import { Box } from 'lucide-react'
import { SendHorizonal } from 'lucide-react'
import styles from './Post.module.scss'
import { config, CONTRACTS } from '@/config/wagmi'
import { ContentType, ZERO_ADDRESS } from '@/lib/content'
import { renderMarkdown } from '@/lib/markdown'
import NativePopover from './ui/NativePopover'
import { QuoteIcon } from 'lucide-react'
import { MessageSquareQuote } from 'lucide-react'
import clsx from 'clsx'

export default function Post({ item, showContent, actions, chainId }) {
  const [showCommentModal, setShowCommentModal] = useState()
  const [showTipModal, setShowTipModal] = useState()
  const [showShareModal, setShowShareModal] = useState()
  const { web3, contract } = initPostContract()
  const mounted = useClientMounted()
  const { address, isConnected } = useConnection()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })
  const [repostedPost, setRepostedPost] = useState(null)
  const [isLoadingRepost, setIsLoadingRepost] = useState(false)

  const isRepost = item.is_repost !== null && item.is_repost !== undefined
  const repostedPostId = isRepost ? Number(item.is_repost) : null

  useEffect(() => {
    let cancelled = false

    if (!isRepost || !repostedPostId) {
      setRepostedPost(null)
      return
    }

    setIsLoadingRepost(true)

    getPostById(item.network_id, repostedPostId, address)
      .then((res) => {
        if (cancelled) return

        const post = Array.isArray(res?.data) ? res.data[0] : res?.data
        setRepostedPost(post || null)
      })
      .catch(() => {
        if (!cancelled) setRepostedPost(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingRepost(false)
      })

    return () => {
      cancelled = true
    }
  }, [isRepost, repostedPostId, item.network_id, address])
  const displayItem = isRepost ? repostedPost : item
  return (
    <>
      {showCommentModal && item && (
        <CommentModal item={showCommentModal} postContent={item.content.elements[0].data.text} setShowCommentModal={setShowCommentModal} />
      )}

      {showTipModal && <TipModal item={showTipModal} setShowTipModal={setShowTipModal} />}

      {showShareModal && <ShareModal item={showShareModal} setShowShareModal={setShowShareModal} />}

      <section
        className={`${styles.post} flex flex-column align-items-start justify-content-between`}
        data-content={showContent ? true : false}
      >
        {isRepost && (
          <div className={styles.post__repostLabel}>
            <Repeat2 strokeWidth={1.3} width={20} height={20} />
            {isRepost
              ? `${item.wallet_address.slice(0, 4)}...${item.wallet_address.slice(-4)}`
              : `${repostedPost?.wallet_address?.slice(0, 4)}...${repostedPost?.wallet_address?.slice(-4)}`}
            {` Reposted`}
          </div>
        )}
        <header className={`${styles.post__header} flex align-items-start justify-content-between w-100`}>
          <Profile creator={displayItem.wallet_address} createdAt={displayItem.created_at} networkId={displayItem.network_id} />
          <div onclick={(e) => e.stopPropagation()}>
            <Nav item={item} />
          </div>
        </header>

        <main className={`${styles.post__main}`}>
          {isRepost && isLoadingRepost ? (
            <div className={styles.post__content}>Loading repost...</div>
          ) : isRepost && !displayItem ? (
            <div className={styles.post__content}>Original post unavailable</div>
          ) : displayItem?.content?.elements?.length > 1 ? (
            <>
              <div
                className={styles.post__main__content}
                id={`post${displayItem.id}`}
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(displayItem?.content?.elements?.[0]?.data?.text || ''),
                }}
              />

              <div className={`${styles.post__main__media}`}>
                <MediaGallery data={displayItem.content.elements[1].data.items} />
              </div>
            </>
          ) : (
            <div
              className={`${styles.post__content}`}
              id={`post${displayItem?.id}`}
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(`${displayItem?.content || ''}`),
              }}
            />
          )}
        </main>

        <footer className={`${styles.post__footer}`}>
          <div
            onClick={(e) => e.stopPropagation()}
            className={`${styles.post__actions} flex flex-row align-items-center justify-content-start`}
          >
            {actions.find((action) => action.toLowerCase() === 'like') !== undefined && <Like item={displayItem || item} />}

            {actions.find((action) => action.toLowerCase() === 'comment') !== undefined && (
              <>
                {item.allow_comment && (
                  <button
                    onClick={() => {
                      isConnected ? setShowCommentModal(item) : toast(`Please connect wallet`, `error`)
                    }}
                  >
                    <MessageCircle strokeWidth={1.5} width={17} height={17} />
                    {item.total_comments === 0 ? '' : <span>{item.total_comments}</span>}
                  </button>
                )}
              </>
            )}

            {actions.find((action) => action.toLowerCase() === 'repost') !== undefined && <Repost item={displayItem || item} />}

            {/* {actions.find((action) => action.toLowerCase() === 'quote') !== undefined && (
              <Quote item={displayItem || item} />
            )} */}

            {actions.find((action) => action.toLowerCase() === 'tip') !== undefined && (
              <button
                onClick={() => {
                  isConnected ? setShowTipModal(item) : toast(`Please connect wallet`, `error`)
                }}
              >
                <TipIcon />
              </button>
            )}

            {actions.find((action) => action.toLowerCase() === 'hash') !== undefined && (
              <a href={`${item.explorer_url}/tx/${item.tx_hash}`} target="_blank" rel="noopener noreferrer">
                <Box strokeWidth={1.5} width={17} height={17} />
              </a>
            )}

            {actions.find((action) => action.toLowerCase() === 'view') !== undefined && (
              <button>
                <ViewIcon />
                {item.total_views > 0 && (
                  <span>
                    {new Intl.NumberFormat('en', {
                      notation: 'compact',
                      maximumFractionDigits: 1,
                    }).format(item.total_views)}
                  </span>
                )}
              </button>
            )}

            {actions.find((action) => action.toLowerCase() === 'share') !== undefined && (
              <button
                onClick={() => {
                  isConnected ? setShowShareModal(item) : toast(`Please connect wallet`, `error`)
                }}
              >
                <SendHorizonal strokeWidth={1.5} width={17} height={17} />
              </button>
            )}
          </div>
        </footer>
      </section>
    </>
  )
}

const Nav = ({ item }) => {
  const activeChain = getActiveChain()

  return (
    <>
      <NativePopover
        trigger={
          <button onclick={(e) => e.stopPropagation()} className={clsx(styles.post__navTrigger, 'pointer rounded-full')}>
            <Ellipsis fill="currentColor" strokeWidth={1} width={18} height={18} />
          </button>
        }
        placement="bottom-start"
      >
        <div className={`${styles.postDropdown} animate fade flex flex-column align-items-center justify-content-start gap-050`}>
          <ul>
            <li>
              <Link href={`/${activeChain[0].id}/${item.postId}`}>View post</Link>
            </li>
          </ul>
        </div>
      </NativePopover>
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
  const uploadObjectToIPFS = async (json) => {
    //setIsUploading(true)
    try {
      const uploadRequest = await fetch(`/api/ipfs/object`, {
        method: 'POST',
        // Set the Content-Type header
        headers: {
          'Content-Type': 'application/json',
        },
        // Stringify the JSON object directly (no extra wrapper)
        body: JSON.stringify(json),
      })

      // Check for non-200 status codes
      if (!uploadRequest.ok) {
        const errorData = await uploadRequest.json()
        throw new Error(errorData.error || `HTTP error! Status: ${uploadRequest.status}`)
      }

      const responseData = await uploadRequest.json()
      //setIsUploading(false)
      return responseData
    } catch (e) {
      //setIsUploading(false)
      console.error('Trouble uploading file/object:', e)
      // Re-throw the error or return null/undefined depending on your error handling preference
      throw e
    }
  }
  const getHasLiked = async () => {
    return isConnected ? await getHasLikedPost(id, address) : false
  }

  const postComment = async (e, id) => {
    e.stopPropagation()

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    //const formData = new FormData(e.target)

    const resultIPFS = await uploadObjectToIPFS({
      version: '1',
      elements: [
        { type: 'text', data: { text: commentContent } },
        {
          type: 'media',
          data: {
            items: [
              // { type: 'image', cid: 'Qm1234...image-cid-1', alt: 'Photo of the launch party.', mimeType: 'image/jpeg' },
              // { type: 'image', cid: 'Qm5678...image-cid-2', alt: 'Screenshot of the new interface.', mimeType: 'image/jpeg' },
              // { type: 'video', cid: 'Qm9012...video-cid-3', format: 'mp4', duration: 45 },
            ],
          },
        },
      ],
    })
    if (!resultIPFS.cid) {
      console.error(`CID not found`)
    }
    const metadata = resultIPFS.cid

    writeContract({
      abi,
      address: activeChain[1].hup,
      functionName: 'create',
      args: [address, 1, metadata, id, true], //formData.get(`allowComments`) === 'true' ? true : false
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
                <Profile creator={item.wallet_address} createdAt={item.created_at} networkId={item.network_id} />
              </header>
              <main className={`${styles.modal__post__main} w-100 flex flex-column grid--gap-050`}>
                <div className={`${styles.post__main__media}`}>
                  {postContent && (
                    <>
                      <div
                        className={`${styles.post__main__content} `}
                        id={`post${item.postId}`}
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(item?.content?.elements?.[0]?.data?.text || item?.content || ''),
                        }}
                      />
                      {item?.content?.elements?.[1]?.type === 'media' && <MediaGallery data={item.content.elements[1].data.items} />}
                    </>
                  )}
                </div>
              </main>
            </section>
          </article>
        </main>

        <footer className={`${styles.modal__footer}  flex flex-column align-items-start`}>
          <div className="flex flex-row align-items-center gap-050">
            <Profile variant="imageOnly" creator={item.wallet_address} createdAt={item.created_at} networkId={item.network_id} />
            <textarea
              autoFocus
              defaultValue={commentContent}
              onInput={(e) => setCommentContent(e.target.value)}
              placeholder={`Reply to ${item?.wallet_address?.slice(0, 4)}…${item?.wallet_address?.slice(-4)}`}
            />
          </div>
          <button className="btn" onClick={(e) => postComment(e, item.id)}>
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
  const [error, setError] = useState(null)
  const activeChain = getActiveChain()

  // --- Dynamic Content ---
  const postUrl = `${location.protocol}//${window.location.host}/networks/${item.network_id}/${item.id}`
  const postTitle = item?.content?.elements?.[0]?.data?.text || item?.content || ''
  const hupHandle = 'hupsocial' // <-- Replace with your actual X handle (without the @)
  const postContent = `${postTitle}\n\n Creator: ${item.wallet_address} \n\n`
  // --- Constructing the Share Link ---
  const shareLink =
    `https://x.com/intent/tweet?` + `text=${encodeURIComponent(postContent)}` + `&url=${encodeURIComponent(postUrl)}` + `&via=${hupHandle}` // <-- The recommended parameter for the handle

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const isMounted = useClientMounted()
  const activeChain = getActiveChain()
  const { address, isConnected } = useConnection()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const likePost = (e, id) => {
    // Prevent event bubbling to parent elements
    e.stopPropagation()

    // Guard clause for disconnected wallets
    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    // Ensure the target network configuration exists
    const targetChain = CONTRACTS[`chain${item.network_id}`]
    if (!targetChain || !targetChain.hup) {
      console.log(`Contract configuration missing for network`, 'error')
      return
    }
    console.log([address, [id]])
    // Execute the contract write using the passed id variable
    writeContract({
      abi,
      address: targetChain.hup,
      functionName: 'batchLike',
      args: [address, [id]], // Using the 'id' parameter passed to the function
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
  }, [])

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
          item.is_liked === 1 ? unlikePost(e, item.id) : likePost(e, item.id)
        } else toast(`Please connect wallet`, `error`)
      }}
    >
      <Heart strokeWidth={1.5} width={18} height={18} />
      {item.total_likes === 0 ? '' : <span>{item.total_likes}</span>}
    </button>
  )
}

function Repost({ item }) {
  const { web3, contract } = initPostContract()
  const { address, isConnected } = useConnection()
  const [isReposted, setIsReposted] = useState(false)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  // useEffect(() => {
  //   getRepostStatus(item.id)
  //     .then((result) => {
  //       console.log({ result })
  //       setIsReposted(result.reposted)
  //       setLoading(false)
  //     })
  //     .catch((err) => {
  //       console.log(err)
  //       setLoading(false)
  //     })
  // }, [])

  const repost = async (e, id) => {
    e.stopPropagation()

    if (!isConnected) {
      console.log('Please connect your wallet first', 'error')
      return
    }

    const targetChain = CONTRACTS[`chain${item.network_id}`]

    if (!targetChain?.hup) {
      console.log('Contract configuration missing for network', 'error')
      return
    }

    writeContract({
      abi,
      address: targetChain.hup,
      functionName: 'create',
      args: [
        ZERO_ADDRESS, // direct wallet call, not session owner
        ContentType.Repost,
        '', // repost metadata can be empty
        BigInt(id), // parent post id
        true, // allowedComments, mostly irrelevant for reposts
      ],
    })
  }

  const removeRepost = (e, id) => {
    e.stopPropagation()

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    writeContract({
      abi,
      address: activeChain[1].post,
      functionName: 'removeRepost',
      args: [id],
    })
  }

  if (loading) return null

  return (
    <button
      onClick={(e) => {
        if (isConnected) {
          isReposted ? removeRepost(e, item.id) : repost(e, item.id)
        } else toast(`Please connect wallet`, `error`)
      }}
    >
      <Repeat2 strokeWidth={1.3} width={20} height={20} />
      {item.repost_count === 0 ? '' : <span>{item.repost_count}</span>}
    </button>
  )
}

function Quote({ item }) {
  const { web3, contract } = initPostContract()
  const { address, isConnected } = useConnection()
  const [isReposted, setIsReposted] = useState(false)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  // useEffect(() => {
  //   getRepostStatus(item.id)
  //     .then((result) => {
  //       console.log({ result })
  //       setIsReposted(result.reposted)
  //       setLoading(false)
  //     })
  //     .catch((err) => {
  //       console.log(err)
  //       setLoading(false)
  //     })
  // }, [])

  const repost = async (e, id) => {
    e.stopPropagation()

    if (!isConnected) {
      console.log('Please connect your wallet first', 'error')
      return
    }

    const targetChain = CONTRACTS[`chain${item.network_id}`]

    if (!targetChain?.hup) {
      console.log('Contract configuration missing for network', 'error')
      return
    }

    writeContract({
      abi,
      address: targetChain.hup,
      functionName: 'create',
      args: [
        ZERO_ADDRESS, // direct wallet call, not session owner
        ContentType.Repost,
        '', // repost metadata can be empty
        BigInt(id), // parent post id
        true, // allowedComments, mostly irrelevant for reposts
      ],
    })
  }

  const removeRepost = (e, id) => {
    e.stopPropagation()

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    writeContract({
      abi,
      address: activeChain[1].post,
      functionName: 'removeRepost',
      args: [id],
    })
  }

  if (loading) return null

  return (
    <button
      onClick={(e) => {
        if (isConnected) {
          isReposted ? removeRepost(e, item.id) : repost(e, item.id)
        } else toast(`Please connect wallet`, `error`)
      }}
    >
      <MessageSquareQuote strokeWidth={1.3} width={17} height={17} />
      {item.repost_count === 0 ? '' : <span>{item.repost_count}</span>}
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
  const { address, isConnected } = useConnection()
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
                isPollActive(item.startTime, item.endTime).status === `endeed`
                  ? styles.poll__options__optionEndeed
                  : styles.poll__options__option
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
