'use client'

import { useState, useEffect, useId, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useWaitForTransactionReceipt, useConnection, useWriteContract, usePublicClient } from 'wagmi'
import { initHupContract, initPostCommentContract, getHasLikedPost, getVoteCountsForPoll, getVoterChoices } from '@/lib/communication'
import { getPostById } from '@/lib/api'
import PollTimer from '@/components/PollTimer'
import { isPollActive } from '@/lib/utils'
import { useClientMounted } from '@/hooks/useClientMount'
import abi from '@/abi/post.json'
import { getActiveChain } from '@/lib/communication'
import commentAbi from '@/abi/post-comment.json'
import { toast } from '@/components/NextToast'
import Profile from '@/components/Profile'
import { CommentIcon, ShareIcon, TipIcon, ViewIcon } from '@/components/Icons'
import MediaGallery from './Gallery'
import { Ellipsis, Pen, Repeat2, MessageCircle, Box, SendHorizonal, MessageSquareQuote } from 'lucide-react'
import { CONTRACTS } from '@/config/wagmi'
import { ContentType, ZERO_ADDRESS } from '@/lib/content'
import { renderMarkdown } from '@/lib/markdown'
import useSWR from 'swr'
import NativePopover from './ui/NativePopover'
import clsx from 'clsx'
import styles from './Post.module.scss'
import NewPost from './NewPost'
import { checkIsEnglish } from '@/lib/languageHelper'
import Like from './ui/Like'
import Comment from './ui/Comment'

// import React, { useState, useEffect } from 'react'
// import clsx from 'clsx'
// import { PostText } from './PostText'

export default function Post({ item, showContent, actions, chainId, showLastComment = false }) {
  const [showCommentModal, setShowCommentModal] = useState()
  const [showTipModal, setShowTipModal] = useState()
  const [showShareModal, setShowShareModal] = useState()
  const { web3, contract } = initHupContract()
  const mounted = useClientMounted()
  const { address, isConnected } = useConnection()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })
  const [repostedPost, setRepostedPost] = useState(null)
  const [isLoadingRepost, setIsLoadingRepost] = useState(false)
  const [lastComment, setLastComment] = useState(null)
  const isRepost = item.is_repost !== null && item.is_repost !== undefined
  const repostedPostId = isRepost ? Number(item.is_repost) : null
  const [showEditModal, setShowEditModal] = useState(false)

  // Fetch the original post data if this item is a repost
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
        setIsLoadingRepost(false)
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
  const commentTarget = displayItem || item

  // Retrieve the latest comment metadata for the active post context
  useEffect(() => {
    let cancelled = false

    if (!commentTarget?.id || !commentTarget?.network_id || Number(commentTarget?.total_comments || 0) < 1) {
      setLastComment(null)
      return
    }

    const params = new URLSearchParams({ last: 'true' })
    if (address) params.set('viewer_address', address)

    fetch(`/api/v1/networks/${commentTarget.network_id}/${commentTarget.id}/comments?${params.toString()}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null)

        if (!res.ok || body?.success === false) {
          throw new Error(body?.error || 'Failed to fetch last comment')
        }

        return body
      })
      .then((res) => {
        if (cancelled) return

        const comment = Array.isArray(res?.data) ? res.data[0] : res?.data
        setLastComment(comment || null)
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('[LAST_COMMENT_ERROR]:', error.message)
          setLastComment(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [commentTarget?.id, commentTarget?.network_id, commentTarget?.total_comments, address])

  // Extract raw source content string contextually based on data schema structure
  const getRawContentText = () => {
    if (displayItem?.content?.elements?.length > 1) {
      return displayItem?.content?.elements?.[0]?.data?.text || ''
    }
    return `${displayItem?.content || ''}`
  }

  const sourceText = getRawContentText()
  const lastCommentText = getCommentPreviewText(lastComment?.content)
  const hasLastCommentPreview = Boolean(lastCommentText) && showLastComment

  // Guard clause: Render global loading state until repost data is completely ready
  if (isRepost && isLoadingRepost) {
    return (
      <div className={`${styles.post} flex align-items-center justify-content-center p-4`}>
        <div className={styles.post__content}>Loading repost...</div>
      </div>
    )
  }

  // Guard clause: Handle instances where fallback records for repost data cannot be found
  if (isRepost && !displayItem) {
    return (
      <div className={`${styles.post} flex align-items-center justify-content-center p-4`}>
        <div className={styles.post__content}>Original post unavailable</div>
      </div>
    )
  }

  return (
    <>
      {showCommentModal && item && <Comment item={showCommentModal} setShowCommentModal={setShowCommentModal} />}

      {showTipModal && <TipModal item={showTipModal} setShowTipModal={setShowTipModal} />}

      {showShareModal && <ShareModal item={showShareModal} setShowShareModal={setShowShareModal} />}

      {showEditModal && (
        <>
          <NewPost
            actionType="edit"
            onClose={() => setShowEditModal(false)}
            existingPost={displayItem}
            setShowEditModal={setShowEditModal}
          />
        </>
      )}

      <section
        className={`${styles.post} flex flex-column align-items-start justify-content-between`}
        data-content={showContent ? true : false}
        data-commentable={item.allow_comment ? true : false}
        data-has-comments={hasLastCommentPreview ? true : false}
        data-has-last-comment={hasLastCommentPreview ? true : false}
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
          <Profile creator={displayItem?.wallet_address} createdAt={displayItem?.created_at} networkId={displayItem?.network_id} />

          <div
            className={clsx(styles.post__header__actions, 'flex align-items-center justify-content-start gap-050')}
            onClick={(e) => e.stopPropagation()}
          >
            {displayItem.is_edited === 1 && (
              <div className={clsx(styles['post__edited'])}>
                <NativePopover
                  trigger={
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className={clsx(styles.post__navTrigger, 'pointer', 'rounded-full')}
                      data-tooltip="Edited"
                    >
                      <Pen strokeWidth={1.5} size={10} />
                    </button>
                  }
                  placement="bottom-end"
                  type="auto"
                >
                  {({ close }) => (
                    <div className={clsx('flex', 'flex-column', 'align-items-center', 'justify-content-start', 'gap-050')}>
                      <p>This post is edited.</p>
                    </div>
                  )}
                </NativePopover>
              </div>
            )}

            <Nav item={item} setShowEditModal={setShowEditModal} />
          </div>
        </header>

        <main className={`${styles.post__main} w-100`}>
          {displayItem?.content?.elements?.length > 1 ? (
            <>
              <PostText
                sourceText={sourceText}
                postId={displayItem.id}
                styles={styles}
                renderMarkdown={renderMarkdown}
                isCollapsible={true}
                baseClassName={styles.post__main__content}
              />

              <div className={`${styles.post__main__media}`}>
                <MediaGallery data={displayItem.content.elements[1].data.items} />
              </div>
            </>
          ) : (
            <PostText
              sourceText={sourceText}
              postId={displayItem?.id}
              styles={styles}
              renderMarkdown={renderMarkdown}
              isCollapsible={false}
              baseClassName={styles.post__content}
            />
          )}
        </main>

        <footer className={`${styles.post__footer}`}>
          <div
            onClick={(e) => e.stopPropagation()}
            className={`${styles.post__actions} flex flex-row align-items-center justify-content-start`}
          >
            {actions.find((action) => action.toLowerCase() === 'like') !== undefined && <Like post={displayItem || item} />}

            {actions.find((action) => action.toLowerCase() === 'comment') !== undefined && (
              <>
                {commentTarget.allow_comment && (
                  <button
                    onClick={() => {
                      isConnected ? setShowCommentModal(commentTarget) : toast(`Please connect wallet`, `error`)
                    }}
                  >
                    <MessageCircle strokeWidth={1.5} width={17} height={17} />
                    {commentTarget.total_comments === 0 ? '' : <span>{commentTarget.total_comments}</span>}
                  </button>
                )}
              </>
            )}

            {actions.find((action) => action.toLowerCase() === 'repost') !== undefined && <Repost item={displayItem || item} />}

            {actions.find((action) => action.toLowerCase() === 'tip') !== undefined && (
              <button
                onClick={() => {
                  isConnected ? setShowTipModal(item) : toast(`Please connect wallet`, `error`)
                }}
              >
                <TipIcon />
              </button>
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

            {actions.find((action) => action.toLowerCase() === 'hash') !== undefined && (
              <a href={`${item.explorer_url}/tx/${item.tx_hash}`} target="_blank" rel="noopener noreferrer">
                <Box strokeWidth={1.5} width={17} height={17} />
              </a>
            )}

            {actions.find((action) => action.toLowerCase() === 'share') !== undefined && (
              <button
                onClick={() => {
                  isConnected ? setShowShareModal(displayItem) : toast(`Please connect wallet`, `error`)
                }}
              >
                <SendHorizonal strokeWidth={1.5} width={17} height={17} />
              </button>
            )}
          </div>
        </footer>

        {hasLastCommentPreview && <LastCommentPreview comment={lastComment} text={lastCommentText} />}
      </section>
    </>
  )
}

const Nav = ({ item, setShowEditModal }) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const isMounted = useClientMounted()
  const { address, isConnected } = useConnection()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })
  const publicClient = usePublicClient()

  const deletePost = async (e, id) => {
    e.stopPropagation()

    if (!isConnected || !address) {
      console.log('Please connect your wallet first', 'error')
      return
    }

    const targetChain = CONTRACTS[`chain${item.network_id}`]

    if (!targetChain?.hup) {
      console.log('Contract configuration missing for network', 'error')
      return
    }

    try {
      // const session = await isSessionActive({
      //   userAddress: address,
      //   publicClient,
      // })

      // if (session.active) {
      //   await writeWithBurnerSession({
      //     chain: activeChain[0],
      //     contractAddress: targetChain.hup,
      //     abi,
      //     functionName: 'batchLike',
      //     args: [address, [id]],
      //   })

      //   return
      // }

      writeContract({
        abi,
        address: targetChain.hup,
        functionName: 'deleteContent',
        args: [address, id],
      })
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  const activeChain = getActiveChain()
  return (
    <>
      <NativePopover
        trigger={
          <button onClick={(e) => e.stopPropagation()} className={clsx(styles.post__navTrigger, 'pointer rounded-full')}>
            <Ellipsis fill="currentColor" strokeWidth={1} width={18} height={18} />
          </button>
        }
        placement="bottom-end"
      >
        {({ close }) => (
          <div className={`${styles.postDropdown} flex flex-column align-items-center justify-content-start gap-050`}>
            <ul>
              <li>
                <Link href={`/networks/${item.network_id}/${item.id}`}>View post</Link>
              </li>
              {item.is_repost < 1 && (
                <li>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowEditModal(true)
                      close()
                    }}
                  >
                    Edit post
                  </button>
                </li>
              )}
              <li>
                <button onClick={(e) => deletePost(e, item.id)}>Delete post</button>
              </li>
            </ul>
          </div>
        )}
      </NativePopover>
    </>
  )
}

const LastCommentPreview = ({ comment, text }) => {
  const commenterLabel =
    comment?.display_name ||
    (comment?.wallet_address ? `${comment.wallet_address.slice(0, 4)}...${comment.wallet_address.slice(-4)}` : 'Last comment')

  return (
    <aside className={styles.post__lastComment} onClick={(e) => e.stopPropagation()}>
      <div className={styles.post__lastComment__avatar}>
        <Profile variant="full" creator={comment.wallet_address} createdAt={comment.created_at} networkId={comment.network_id} />
      </div>

      <div className={styles.post__lastComment__body}>
        <div
          className={styles.post__lastComment__content}
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(text),
          }}
        />
      </div>
    </aside>
  )
}

function getCommentPreviewText(content) {
  if (!content) return ''

  if (typeof content === 'string') {
    try {
      return getCommentPreviewText(JSON.parse(content))
    } catch {
      return content
    }
  }

  return content?.elements?.find((element) => element?.type === 'text')?.data?.text || ''
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

const Repost = ({ item }) => {
  const { web3, contract } = initHupContract()
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
        false, //false for all reposts
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

const Quote = ({ item }) => {
  const { web3, contract } = initHupContract()
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

const Options = ({ item }) => {
  const [status, setStatus] = useState(`loading`)
  const [optionsVoteCount, setOptionsVoteCount] = useState()
  const [voted, setVoted] = useState()
  const [topOption, setTopOption] = useState()
  const [totalVotes, setTotalVotes] = useState(0)
  const { web3, contract: readOnlyContract } = initHupContract()
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

// ■■■ Translation Core Infrastructure ■■■

const translationFetcher = async ([text, targetLang]) => {
  if (!text) return ''

  const targetUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`
  const res = await fetch(targetUrl)

  if (!res.ok) {
    throw new Error('Translation pipeline network response failed')
  }

  const data = await res.json()
  if (!data || !data[0]) return ''

  return data[0]
    .map((segment) => segment[0])
    .filter(Boolean)
    .join('')
}

// ■■■ Sub-Component Definition ■■■

export function PostText({ sourceText, postId, styles, renderMarkdown, isCollapsible = false, baseClassName }) {
  const [showTranslation, setShowTranslation] = useState(false)
  const contentRef = useRef(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [canShowMore, setCanShowMore] = useState(false)

  // Verify language profile to optimize translation button visibility using external helper
  const isEnglish = useMemo(() => checkIsEnglish(sourceText), [sourceText])

  // Execute external translation pipeline via cached hooks infrastructure
  const { data: translatedText, isValidating: isTranslating } = useSWR(
    showTranslation && sourceText ? [sourceText, 'en'] : null,
    translationFetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 600000,
    },
  )

  // Track layout heights to evaluate if the content body needs a show-more interface
  useEffect(() => {
    if (!isCollapsible) return
    const el = contentRef.current
    if (!el) return

    setCanShowMore(el.scrollHeight > el.clientHeight)
  }, [sourceText, showTranslation, translatedText, isCollapsible])

  const handleToggleTranslation = (e) => {
    e.stopPropagation()
    setShowTranslation((prev) => !prev)
  }

  const renderedContentText = showTranslation && translatedText ? translatedText : sourceText

  return (
    <div className="flex flex-column w-100">
      <div
        ref={isCollapsible ? contentRef : null}
        className={clsx(
          baseClassName,
          isCollapsible && (isExpanded ? styles.post__main__content_expanded : styles.post__main__content_collapsed),
        )}
        id={`post${postId}`}
        dangerouslySetInnerHTML={{
          __html: renderMarkdown(renderedContentText || ''),
        }}
      />

      {isCollapsible && canShowMore && (
        <button
          type="button"
          className={styles.post__showMore}
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded((prev) => !prev)
          }}
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      )}

      {/* Conditionally suppress translation controls if the original content is English */}
      {!isEnglish && (
        <div className="flex align-items-center mt-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={clsx(styles.post__translateTrigger, 'pointer border-none bg-transparent p-0 text-sm font-medium text-muted')}
            style={{ fontSize: '0.8rem', opacity: 0.8 }}
            onClick={handleToggleTranslation}
            disabled={isTranslating}
          >
            {isTranslating ? 'Translating...' : showTranslation && translatedText ? 'See original' : 'Translate'}
          </button>
        </div>
      )}
    </div>
  )
}
