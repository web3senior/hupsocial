'use client'

import { useState, useEffect, useId, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { usePostStore } from '@/stores/usePostStore'
import { useWaitForTransactionReceipt, useConnection, useWriteContract, usePublicClient } from 'wagmi'
import { initHupContract, getVoteCountsForPoll, getVoterChoices } from '@/lib/communication'
import { getPostById, recordPostView } from '@/lib/api'
import PollTimer from '@/components/PollTimer'
import { isPollActive } from '@/lib/utils'
import { useClientMounted } from '@/hooks/useClientMount'
import { useProfile } from '@/hooks/useProfile'
import abi from '@/abi/post.json'
import { getActiveChain } from '@/lib/communication'
import { toast } from '@/components/NextToast'
import Profile from '@/components/Profile'
import { CommentIcon, ShareIcon } from '@/components/Icons'
import MediaGallery from './Gallery'
import {
  ChartLineDownIcon,
  DotsThreeIcon,
  EyeIcon,
  FlagIcon,
  NotePencilIcon,
  PackageIcon,
  PaperPlaneRightIcon,
  PenIcon,
  RepeatIcon,
  TagIcon,
  TrashSimpleIcon,
  UsersIcon,
} from '@phosphor-icons/react'
import { CONTRACTS } from '@/config/wagmi'
import { renderMarkdown } from '@/lib/markdown'
import useSWR, { useSWRConfig } from 'swr'
import { getPostStatsKey } from '@/hooks/usePostStats'
import NativePopover from './ui/NativePopover'
import SellItemPopover from './SellItemPopover'
import TipModal from './TipModal'
import BuyButton from './BuyButton'
import TradeCard from './TradeCard'
import NewPost from './NewPost'
import { checkIsEnglish } from '@/lib/languageHelper'
import Like from './ui/Like'
import CommentAction from './ui/CommentAction'
import Repost from './ui/Repost'
import Tip from './ui/Tip'
import View from './ui/View'
import Bookmark from './ui/Bookmark'
import Share from './ui/Share'
import clsx from 'clsx'
import styles from './Post.module.scss'
// Encrypted community content (posts, comments, quoted cards — everything inside encrypted
// communities is sealed with the community key): attempts in-place decryption using the
// session's unlocked identity. Promptless and best-effort — viewers without the key keep the
// locked placeholder. Returns the item with content swapped for the decrypted version when
// possible, otherwise the item untouched.
function useDecryptedCommunityItem(item) {
  const { address } = useConnection()
  const [decryptedContent, setDecryptedContent] = useState(null)
  const decryptClient = usePublicClient({
    chainId: item?.network_id ? Number(item.network_id) : undefined,
  })

  useEffect(() => {
    const content = item?.content
    if (!content?.encrypted || !address) {
      setDecryptedContent(null)
      return
    }

    let cancelled = false
    const communityContract = CONTRACTS[`chain${item.network_id}`]?.community
    import('@/lib/communityVault')
      .then(({ tryDecryptCommunityContent }) => tryDecryptCommunityContent(decryptClient, communityContract, address, content))
      .then((decrypted) => {
        if (!cancelled && decrypted) setDecryptedContent(decrypted)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [item?.id, item?.network_id, item?.content?.encrypted, address])

  return useMemo(() => {
    if (!item || !item.content?.encrypted || !decryptedContent) return item
    return { ...item, content: decryptedContent }
  }, [item, decryptedContent])
}

export default function Post({ item, showContent, actions, chainId, hasCommentBelow = false }) {
  const [showCommentModal, setShowCommentModal] = useState()
  const [showTipModal, setShowTipModal] = useState()
  const [showQuoteModal, setShowQuoteModal] = useState(null)
  const { web3, contract } = initHupContract()
  const mounted = useClientMounted()
  const { address } = useConnection()
  const { mutate: mutateStats } = useSWRConfig()
  const { data: hash, isPending, mutate: writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })
  const [repostedPost, setRepostedPost] = useState(null)
  const [isLoadingRepost, setIsLoadingRepost] = useState(false)
  const isRepost = item.is_repost !== null && item.is_repost !== undefined
  const isActioned = Number(item.actioned_reports || 0) >= 3 || Number(item.moderation_flagged || 0) === 1
  const repostedPostId = isRepost ? Number(item.is_repost) : null
  const [showEditModal, setShowEditModal] = useState(false)
  const [showReportModal, setShowReportModal] = useState(null)
  const sectionRef = useRef(null)

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

  const baseDisplayItem = isRepost ? repostedPost : item
  const displayItem = useDecryptedCommunityItem(baseDisplayItem)
  const commentTarget = displayItem || item

  // Fire view recording only when the post scrolls into the viewport.
  // `repostReady` is included so the observer re-attaches once the loading
  // skeleton/fallback (which render without the ref'd <section>) give way
  // to the real markup — otherwise the ref never gets observed for reposts.
  const repostReady = !isRepost || !!repostedPost
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          recordPostView(item.network_id, item.id, address)
          io.disconnect()
        }
      },
      { threshold: 0.5 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [item.network_id, item.id, address, repostReady])

  // Extract raw source content string contextually based on data schema structure
  const getRawContentText = () => {
    // Encrypted community content (posts and replies) — a ciphertext envelope that decrypts in
    // place above when the viewer holds the community key; this placeholder is what non-members
    // (or locked-vault sessions) see instead.
    if (displayItem?.content?.encrypted) {
      return '🔒 Encrypted community content — only members can view'
    }
    if (displayItem?.content?.elements?.length > 1) {
      return displayItem?.content?.elements?.[0]?.data?.text || ''
    }
    return `${displayItem?.content || ''}`
  }

  const sourceText = getRawContentText()
  const actionsSet = useMemo(() => new Set(actions.map((a) => a.toLowerCase())), [actions])

  // Guard clause: Render global loading state until repost data is completely ready
  if (isRepost && isLoadingRepost) {
    return <PostSkeleton />
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
      {showCommentModal && <NewPost actionType="comment" replyTarget={showCommentModal} onClose={() => setShowCommentModal()} />}
      {showQuoteModal && (
        <NewPost
          actionType="quote"
          quoteTarget={showQuoteModal}
          onClose={() => setShowQuoteModal(null)}
          onConfirmed={() => {
            // Quotes count into the merged repost metric (X-style). Bump the quoted post's
            // shared stats entry without revalidating — the indexer lags the receipt, so an
            // immediate refetch would return the pre-quote count and wipe the bump.
            mutateStats(
              getPostStatsKey(showQuoteModal, address),
              (prev) => {
                const base = prev || showQuoteModal
                return { ...base, total_reposts: (Number(base.total_reposts) || 0) + 1 }
              },
              { revalidate: false }
            )
          }}
        />
      )}
      {showTipModal && <TipModal item={showTipModal} setShowTipModal={setShowTipModal} />}
      {showReportModal && <ReportModal item={showReportModal} setShowReportModal={setShowReportModal} />}

      {showEditModal && (
        <NewPost actionType="edit" onClose={() => setShowEditModal(false)} existingPost={displayItem} setShowEditModal={setShowEditModal} />
      )}

      <section
        ref={sectionRef}
        className={`${styles.post} flex flex-column justify-content-between`}
        data-content={showContent ? true : false}
        data-commentable={item.allow_comment ? true : false}
        data-has-comments={hasCommentBelow ? true : false}
      >
        {isRepost && <RepostLabel walletAddress={item.wallet_address} />}
        {displayItem?.community_name && (
          <Link
            href={`/communities/${displayItem.network_id}/${displayItem.community_id}`}
            className={styles.post__communityBadge}
            onClick={(e) => e.stopPropagation()}
          >
            <UsersIcon size={13} />
            {`Posted in ${displayItem.community_name}`}
          </Link>
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
                      aria-label="Post has been edited"
                    >
                      <PenIcon size={10} />
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

            <Nav item={item} setShowEditModal={setShowEditModal} setShowReportModal={setShowReportModal} />
          </div>
        </header>

        <main className={clsx(styles.post__main, 'w-100')}>
          {isActioned ? (
            <div className={styles.post__flagBanner}>
              <FlagIcon size={14} weight="fill" />
              This post has been flagged for violations.
            </div>
          ) : displayItem?.content?.elements?.length > 1 ? (
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

          {!isActioned && displayItem?.content?.quoteOf && (
            <QuotedPost networkId={displayItem.network_id} quoteId={displayItem.content.quoteOf} quotedBy={displayItem.wallet_address} />
          )}

          {!isActioned && displayItem?.content?.nftListing && (
            <TradeCard
              listing={displayItem.content.nftListing}
              // Buying through someone's repost credits the reposter with the listing's
              // referral share — HupTrade rejects self- and seller-referrals onchain
              referral={
                isRepost && item.wallet_address?.toLowerCase() !== displayItem?.wallet_address?.toLowerCase()
                  ? item.wallet_address
                  : null
              }
            />
          )}

          <BuyButton item={displayItem || item} />
        </main>

        <footer className={`${styles.post__footer}`}>
          <div
            onClick={(e) => e.stopPropagation()}
            className={`${styles.post__actions} flex flex-row align-items-center justify-content-between`}
          >
            <div className="flex flex-row align-items-center justify-content-start`" style={{ gap: `4px` }}>
              {actionsSet.has('like') && <Like post={displayItem || item} />}

              {actionsSet.has('comment') && <CommentAction post={commentTarget} onComment={setShowCommentModal} />}

              {actionsSet.has('repost') && <Repost post={displayItem || item} onQuote={() => setShowQuoteModal(displayItem || item)} />}

              {actionsSet.has('tip') && <Tip post={displayItem || item} onTip={setShowTipModal} />}

              {actionsSet.has('view') && <View post={item} />}
            </div>
            <div className="flex align-items-center gap-025">
              {actionsSet.has('bookmark') && <Bookmark post={displayItem || item} />}
              {actionsSet.has('share') && <Share item={displayItem || item} />}
            </div>
          </div>
        </footer>
      </section>
    </>
  )
}

const RepostLabel = ({ walletAddress }) => {
  const { profile } = useProfile(walletAddress)
  const truncatedAddress = walletAddress ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}` : ''
  const displayName = profile?.name || truncatedAddress

  return (
    <Link href={`/${walletAddress}`} className={styles.post__repostLabel} onClick={(e) => e.stopPropagation()}>
      <RepeatIcon width={16} height={16} />
      <span className={styles.post__repostLabel__name}>{displayName}</span>
      {` Reposted`}
    </Link>
  )
}

const PostSkeleton = () => (
  <div style={{ padding: '20px 20px 0.5rem 20px' }}>
    <div className="flex align-items-start gap-050">
      <div className="shimmer rounded" style={{ width: 36, height: 36, flexShrink: 0 }} />
      <div className="flex flex-column gap-025" style={{ flex: 1 }}>
        <div className="shimmer rounded" style={{ width: '25%', height: 12 }} />
        <div className="shimmer rounded" style={{ width: '60%', height: 12, marginTop: 4 }} />
        <div className="shimmer rounded" style={{ width: '45%', height: 12, marginTop: 2 }} />
      </div>
    </div>
  </div>
)

const LastCommentShimmer = () => (
  <aside className={styles.post__lastCommentShimmer} onClick={(e) => e.stopPropagation()}>
    <div className="shimmer" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
    <div className="shimmer rounded" style={{ width: '65%', height: 12 }} />
  </aside>
)

const Nav = ({ item, setShowEditModal, setShowReportModal }) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const isMounted = useClientMounted()
  const router = useRouter()
  const { setCurrentPost } = usePostStore()
  const { address, isConnected } = useConnection()
  const { data: hash, isPending, mutate: writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })
  const publicClient = usePublicClient()
  const sellPopoverRef = useRef(null)

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
          <button
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={() => router.prefetch(`/networks/${item.network_id}/${item.id}`)}
            className={clsx(styles.post__navTrigger, 'pointer rounded-full')}
            aria-label="Post options"
          >
            <DotsThreeIcon width={20} height={20} />
          </button>
        }
        placement="bottom-end"
      >
        {({ close }) => (
          <div className={`${styles.post__dropdown} flex flex-column align-items-center justify-content-start gap-050`}>
            <ul>
              <li>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setCurrentPost(item)
                    router.push(`/networks/${item.network_id}/${item.id}`)
                  }}
                >
                  <span>View</span>
                  <EyeIcon size={18} />
                </button>
              </li>
              {item.tx_hash && (
                <li>
                  <a
                    href={`${item.explorer_url}/tx/${item.tx_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View transaction proof on block explorer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Proof</span>
                    <PackageIcon size={18} />
                  </a>
                </li>
              )}
              {address?.toLowerCase() === item.wallet_address?.toLowerCase() && (
                <li>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      sellPopoverRef.current?.open()
                      close()
                    }}
                  >
                    <span>Sell</span>
                    <TagIcon size={18} />
                  </button>
                </li>
              )}
              {address?.toLowerCase() === item.wallet_address?.toLowerCase() && item.is_repost < 1 && (
                <li>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowEditModal(true)
                      close()
                    }}
                  >
                    <span>Edit</span>
                    <NotePencilIcon size={18} />
                  </button>
                </li>
              )}
              {address?.toLowerCase() === item.wallet_address?.toLowerCase() && (
                <li>
                  <button onClick={(e) => deletePost(e, item.id)}>
                    <span>Delete</span>
                    <TrashSimpleIcon size={18} />
                  </button>
                </li>
              )}
              {address?.toLowerCase() !== item.wallet_address?.toLowerCase() && (
                <li>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowReportModal(item)
                      close()
                    }}
                  >
                    <span>Report</span>
                    <FlagIcon size={16} />
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}
      </NativePopover>
      <SellItemPopover ref={sellPopoverRef} item={item} />
    </>
  )
}

export function PostCard({ item, actions, chainId, networkName }) {
  const router = useRouter()
  const { setCurrentPost } = usePostStore()
  const [lastComment, setLastComment] = useState(null)
  const [isLastCommentLoading, setIsLastCommentLoading] = useState(false)
  const { address } = useConnection()

  const shouldFetch = Number(item?.total_comments || 0) > 0

  useEffect(() => {
    if (!shouldFetch || !item?.id || !item?.network_id) {
      setLastComment(null)
      return
    }

    let cancelled = false
    setIsLastCommentLoading(true)

    const params = new URLSearchParams({ last: 'true' })
    if (address) params.set('viewer_address', address)

    fetch(`/api/v1/networks/${item.network_id}/${item.id}/comments?${params.toString()}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok || body?.success === false) throw new Error(body?.error || 'Failed to fetch last comment')
        return body
      })
      .then((res) => {
        if (cancelled) return
        const comment = Array.isArray(res?.data) ? res.data[0] : res?.data
        setLastComment(comment || null)
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[LAST_COMMENT_ERROR]:', err.message)
          setLastComment(null)
        }
      })
      .finally(() => {
        if (!cancelled) setIsLastCommentLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [item?.id, item?.network_id, item?.total_comments, address, shouldFetch])

  const hasCommentBelow = shouldFetch && (isLastCommentLoading || !!lastComment)

  const openLastComment = (e) => {
    e.stopPropagation()
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) return
    setCurrentPost(lastComment)
    router.push(`/networks/${lastComment.network_id}/${lastComment.id}`)
  }

  return (
    <>
      <Post item={item} actions={actions} chainId={chainId} networkName={networkName} hasCommentBelow={hasCommentBelow} />
      {shouldFetch &&
        (isLastCommentLoading ? (
          <LastCommentShimmer />
        ) : lastComment ? (
          <div
            className={styles.post__commentLink}
            onClick={openLastComment}
            onMouseEnter={() => router.prefetch(`/networks/${lastComment.network_id}/${lastComment.id}`)}
          >
            <Post item={lastComment} actions={['like', 'comment', 'share', 'repost', 'tip', 'view', 'quote', 'bookmark']} chainId={chainId} />
          </div>
        ) : null)}
    </>
  )
}

const ReportModal = ({ item, setShowReportModal }) => {
  const { address } = useConnection()
  const [categories, setCategories] = useState([])
  const [categoryId, setCategoryId] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch('/api/v1/reports/categories')
      .then((r) => r.json())
      .then((body) => {
        if (body.success) setCategories(body.data)
      })
      .catch(() => {})
  }, [])

  const handleSubmit = async (e) => {
    e.stopPropagation()
    if (!categoryId) return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/v1/networks/${item.network_id}/${item.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reporter_address: address, category_id: Number(categoryId), reason }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed')
      setDone(true)
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className={`${styles.modal} animate fade`}
      onClick={(e) => {
        e.stopPropagation()
        setShowReportModal(null)
      }}
    >
      <div className={`${styles.modal__container}`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="pointer" onClick={() => setShowReportModal(null)}>
            Cancel
          </div>
          <div className="flex-1">
            <h3>Report post</h3>
          </div>
          <div />
        </header>
        <main className="flex flex-column align-items-start justify-content-between gap-050">
          {done ? (
            <p>Thank you. Your report has been submitted.</p>
          ) : (
            <>
              <div className="flex flex-column align-items-start w-100 gap-050">
                <label>Reason</label>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-100">
                  <option value="">Select a category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.category_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-column align-items-start w-100 gap-050">
                <label>Additional details (optional)</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className="w-100"
                  placeholder="Describe the issue..."
                />
              </div>
            </>
          )}
        </main>
        {!done && (
          <footer>
            <button onClick={handleSubmit} disabled={!categoryId || submitting}>
              {submitting ? 'Submitting…' : 'Submit report'}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}

// Compact embedded card for quote posts — `quoteOf` lives inside the post's
// content JSON (the contract forces parentId = 0 for regular posts), so the
// quoted post has to be fetched by id from the same network.
const QuotedPost = ({ networkId, quoteId, quotedBy }) => {
  const router = useRouter()
  const { address } = useConnection()
  const [fetchedQuotedPost, setFetchedQuotedPost] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    getPostById(networkId, quoteId, address)
      .then((res) => {
        if (cancelled) return
        const post = Array.isArray(res?.data) ? res.data[0] : res?.data
        setFetchedQuotedPost(post || null)
      })
      .catch(() => {
        if (!cancelled) setFetchedQuotedPost(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [networkId, quoteId, address])

  // Same in-place decryption the main card gets — a quoted encrypted post renders readable for
  // members instead of the locked placeholder. Called before the early returns (hook rules).
  const quotedPost = useDecryptedCommunityItem(fetchedQuotedPost)

  if (isLoading) return null

  if (!quotedPost) {
    return <div className={clsx(styles.post__quoteCard, styles.post__quoteCard_unavailable)}>Original post unavailable</div>
  }

  const quotedText = quotedPost?.content?.encrypted
    ? '🔒 Encrypted community content — only members can view'
    : quotedPost?.content?.elements?.length > 1
      ? quotedPost.content.elements[0]?.data?.text || ''
      : `${quotedPost?.content || ''}`
  const quotedMedia = quotedPost?.content?.elements?.length > 1 ? quotedPost.content.elements[1]?.data?.items || [] : []

  return (
    <div
      className={styles.post__quoteCard}
      onClick={(e) => {
        e.stopPropagation()
        router.push(`/networks/${networkId}/${quoteId}`)
      }}
    >
      <Profile variant="fullWithoutTime" creator={quotedPost.wallet_address} networkId={quotedPost.network_id} />
      {quotedText && (
        <div
          className={styles.post__quoteCard__text}
          onClick={(e) => {
            if (e.target.closest('a')) e.stopPropagation()
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(quotedText) }}
        />
      )}
      {quotedMedia.length > 0 && (
        <div className={styles.post__quoteCard__media}>
          <MediaGallery data={quotedMedia} />
        </div>
      )}
      {quotedPost?.content?.nftListing && (
        // Quoting a listing is a referral channel like reposting: buys made from this
        // quote credit the quote's author with the listing's referral share
        <TradeCard listing={quotedPost.content.nftListing} referral={quotedBy} />
      )}
    </div>
  )
}

const Poll = ({ polls }) => {
  return (
    <>
      {polls &&
        polls.list.length > 0 &&
        polls.list.map((item, i) => {
          return (
            <article
              key={i}
              className={`${styles.poll} animate fade`}
              onClick={() => router.push(`p/${item.pollId}`)}
              onMouseEnter={() => router.prefetch(`p/${item.pollId}`)}
            >
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
                      <button aria-label="Comment on poll">
                        <CommentIcon />

                        <span>{0}</span>
                      </button>
                    )}

                    <button aria-label="Repost poll"></button>

                    <button aria-label="Share poll">
                      <ShareIcon />
                    </button>

                    <button aria-label="Tip the author">
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
  const { data: hash, isPending, mutate: writeContract } = useWriteContract()
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
    }
  )

  useEffect(() => {
    if (!isCollapsible) return
    const el = contentRef.current
    if (!el) return

    const measure = () => {
      if (!isExpanded) setCanShowMore(el.scrollHeight > el.clientHeight)
    }
    measure()

    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isCollapsible, isExpanded, sourceText, showTranslation, translatedText])

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
          isCollapsible && (isExpanded ? styles.post__main__content_expanded : styles.post__main__content_collapsed)
        )}
        id={`post${postId}`}
        dir="auto"
        onClick={(e) => {
          // Links inside dangerouslySetInnerHTML have no React handler; keep their clicks from opening post details
          if (e.target.closest('a')) e.stopPropagation()
        }}
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
