'use client'

import { useState, useEffect, useId, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { usePostStore } from '@/stores/usePostStore'
import { useWaitForTransactionReceipt, useConnection, useWriteContract, usePublicClient } from 'wagmi'
import { initHupContract } from '@/lib/communication'
import { getPostById, recordPostView } from '@/lib/api'
import { useClientMounted } from '@/hooks/useClientMount'
import { useProfile } from '@/hooks/useProfile'
import abi from '@/abi/post.json'
import { getActiveChain } from '@/lib/communication'
import { toast } from '@/components/NextToast'
import Profile from '@/components/Profile'
import { CommentIcon, ShareIcon } from '@/components/Icons'
import MediaGallery from './Gallery'
import {
  CaretDownIcon,
  ChartLineDownIcon,
  ClipboardTextIcon,
  CodeIcon,
  DotsThreeIcon,
  EyeIcon,
  FlagIcon,
  MarkdownLogoIcon,
  NotePencilIcon,
  PackageIcon,
  PaperPlaneRightIcon,
  PencilSimpleIcon,
  RepeatIcon,
  SparkleIcon,
  TagIcon,
  TrashSimpleIcon,
  UsersIcon,
} from '@phosphor-icons/react'
import { CONTRACTS } from '@/config/wagmi'
import { renderMarkdown } from '@/lib/markdown'
import { rememberCardPointerDown, isTextSelectionDrag } from '@/lib/cardClick'
import { postToMarkdown, getPostMarkdownUrl } from '@/lib/postMarkdown'
import { AI_TARGETS, buildPostAiUrl } from '@/lib/aiTargets'
import useSWR, { useSWRConfig } from 'swr'
import { getPostStatsKey } from '@/hooks/usePostStats'
import NativePopover from './ui/NativePopover'
import Tooltip from './ui/Tooltip'
import SellItemPopover from './SellItemPopover'
import EmbedPostDialog from './EmbedPostDialog'
import TipModal from './TipModal'
import BuyButton from './BuyButton'
import TradeCard from './TradeCard'
import ArticleCard from './ArticleCard'
import DropCard from './DropCard'
import PredictCard from './PredictCard'
import PollCard from './PollCard'
import LaunchCard from './LaunchCard'
import MiniAppEmbed from './MiniAppEmbed'
import CashtagStrip from './CashtagStrip'
import NewPost from './NewPost'
import { shouldOfferTranslation } from '@/lib/languageHelper'
import { usePreferredLanguage } from '@/hooks/usePreferredLanguage'
import Like from './ui/Like'
import { isSolanaNetworkId } from '@/config/solana'
import { useSolanaWallet } from '@/hooks/useSolanaWallet'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { hupInstruction } from '@/lib/solana/hup'
import { sendHupAction } from '@/lib/solana/relay'
import { sameAddress } from '@/lib/address'
import { txExplorerUrl } from '@/lib/explorer'
import { shortTxError } from '@/lib/utils'
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
  // The viewer is the wallet for the active network — stats keys, view records, quote lookups
  const { address } = useActiveWallet()
  const { mutate: mutateStats } = useSWRConfig()
  const { data: hash, isPending, mutate: writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })
  const isRepost = item.is_repost !== null && item.is_repost !== undefined
  // Flagged posts are never withheld — the content still renders, blurred behind a veil until
  // the viewer opts in. Revealing is per-post and resets on remount.
  const isActioned = Number(item.actioned_reports || 0) >= 3 || Number(item.moderation_flagged || 0) === 1
  const [isRevealed, setIsRevealed] = useState(false)
  const isVeiled = isActioned && !isRevealed
  const repostedPostId = isRepost ? Number(item.is_repost) : null
  const [showEditModal, setShowEditModal] = useState(false)
  const [showReportModal, setShowReportModal] = useState(null)
  const sectionRef = useRef(null)

  // Original post behind a repost row. Feed rows arrive with the original
  // embedded (repost_original, hydrated server-side by the posts route), so the
  // card renders in the same paint as the rest of the feed — the fetcher only
  // runs for rows from surfaces that don't embed (search, saved, older cached
  // feeds). It shares the SWR key the footer counters use (getPostStatsKey) so
  // stats mutations and the card content live in one cache entry, and that
  // cache survives unmounts — a feed restored from useFeedCacheStore repaints
  // repost cards synchronously instead of re-showing the skeleton and shifting
  // the restored scroll position. revalidateIfStale is off for parity with the
  // rest of the restored feed (usePostStats already revalidates this key on
  // focus); keepPreviousData holds the card through the anonymous → connected
  // key change on wagmi reconnect (the feed refetch on connect delivers a fresh
  // embed with the viewer's repost/bookmark state).
  const repostKey = isRepost ? getPostStatsKey({ id: repostedPostId, network_id: item.network_id }, address) : null
  const { data: repostedPost, isLoading: isLoadingRepost } = useSWR(
    repostKey,
    async () => {
      const res = await getPostById(item.network_id, repostedPostId, address)
      const post = Array.isArray(res?.data) ? res.data[0] : res?.data
      return post ?? null
    },
    { fallbackData: item.repost_original ?? undefined, revalidateIfStale: false, keepPreviousData: true },
  )

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

  // Guard clause: Render global loading state until repost data is completely ready.
  // Only on a truly cold load — keepPreviousData keeps the previous entry rendered
  // while the key swaps from the anonymous to the connected viewer.
  if (isRepost && isLoadingRepost && !repostedPost) {
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
            onClick={(e) => {
              if (e.target.closest('button, a, [popover]')) e.stopPropagation()
            }}
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
                      <PencilSimpleIcon size={13} weight="fill" />
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
          <div className={clsx(styles.post__sensitive, isVeiled && styles['post__sensitive--veiled'])}>
            <div className={styles.post__sensitive__body} inert={isVeiled}>
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

              {displayItem?.content?.quoteOf && (
                <QuotedPost networkId={displayItem.network_id} quoteId={displayItem.content.quoteOf} quotedBy={displayItem.wallet_address} />
              )}

              {displayItem?.content?.nftListing && (
                <TradeCard
                  listing={displayItem.content.nftListing}
                  // Referral attribution works repost-style: the reposter when there is one,
                  // otherwise the post's author — anyone can attach any listing to a post, and
                  // buys made through it credit them with the listing's referral share.
                  // HupTrade rejects self- and seller-referrals onchain (TradeCard zeroes those).
                  referral={
                    isRepost && item.wallet_address?.toLowerCase() !== displayItem?.wallet_address?.toLowerCase()
                      ? item.wallet_address
                      : displayItem?.wallet_address
                  }
                />
              )}

              {/* Long-form: the card renders entirely from the post payload, and only the
                  reader page ever fetches the body under article.bodyCid */}
              {displayItem?.content?.article && (
                <ArticleCard article={displayItem.content.article} networkId={displayItem.network_id} postId={displayItem.id} />
              )}

              {displayItem?.content?.predictMarket && <PredictCard marketRef={displayItem.content.predictMarket} />}

              {displayItem?.content?.poll && <PollCard pollRef={displayItem.content.poll} />}

              {displayItem?.content?.tokenLaunch && <LaunchCard launchRef={displayItem.content.tokenLaunch} />}

              {displayItem?.content?.nftDrop && (
                <DropCard
                  drop={displayItem.content.nftDrop}
                  // Same repost-style referral attribution as TradeCard above; HupDrops rejects
                  // self- and creator-referrals onchain (DropCard zeroes those).
                  referral={
                    isRepost && item.wallet_address?.toLowerCase() !== displayItem?.wallet_address?.toLowerCase()
                      ? item.wallet_address
                      : displayItem?.wallet_address
                  }
                />
              )}

              {/* Nothing loads until the viewer presses launch, so a veiled post never runs
                  third-party code — the inert wrapper blocks the launch button outright */}
              {displayItem?.content?.miniApp && <MiniAppEmbed reference={displayItem.content.miniApp} contextAddress={displayItem?.wallet_address} />}

              {/* Live prices for the tokens this post names. The author's kept list wins when
                  the post carries one; otherwise the symbols are read from the text, so posts
                  written before the composer control still get cards. Encrypted posts resolve
                  to the lock placeholder above, which contains no cashtags, so sealed content
                  never sources a card. */}
              <CashtagStrip text={getRawContentText()} cashtags={displayItem?.content?.cashtags} />

              <BuyButton item={displayItem || item} />
            </div>

            {isVeiled && (
              <div className={styles.post__sensitive__veil} onClick={(e) => e.stopPropagation()}>
                <FlagIcon size={14} weight="fill" />
                <button
                  type="button"
                  className={styles.post__sensitive__reveal}
                  title="This post has been flagged for violations"
                  onClick={() => setIsRevealed(true)}
                >
                  Show anyway
                </button>
              </div>
            )}
          </div>
        </main>
        

        <footer className={`${styles.post__footer}`}>
          <div
            onClick={(e) => {
              // Only real controls (and open popover panels) keep their clicks — blank
              // action-bar space still opens the details view like the rest of the card
              if (e.target.closest('button, a, [popover]')) e.stopPropagation()
            }}
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
              {/* captureRef: the card copies itself, exactly as it is on screen */}
              {actionsSet.has('share') && <Share item={displayItem || item} captureRef={sectionRef} />}
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

// Assistant logos live in /public/logos and are dropped in per brand. A missing file must not
// leave an empty slot, so a failed load falls back to the assistant's short mark.
const AiTargetLogo = ({ target }) => {
  const [failed, setFailed] = useState(false)

  if (failed) return <span className={styles.post__menuFallbackMark}>{target.short}</span>

  return <img src={target.logo} alt="" width={20} height={20} loading="lazy" data-ink={target.ink} onError={() => setFailed(true)} />
}

/**
 * One row of the post menu: a muted icon, the action, and a line saying what it does. Renders
 * as a link when `href` is set and a button otherwise — both share the same row shape, so it
 * lives here instead of being restated on every entry.
 */
const MenuItem = ({ icon, label, description, trailing, href, className, ...rest }) => {
  const body = (
    <>
      <span className={styles.post__menuIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.post__menuText}>
        <span className={styles.post__menuLabel}>{label}</span>
        {description && <small className={styles.post__menuDescription}>{description}</small>}
      </span>
      {trailing}
    </>
  )

  return (
    <li className={className}>
      {href ? (
        <a href={href} {...rest}>
          {body}
        </a>
      ) : (
        <button type="button" {...rest}>
          {body}
        </button>
      )}
    </li>
  )
}

/**
 * Document actions for a post — the same handoffs a docs page offers: take the content as
 * markdown, read it as plain text, or hand it to an assistant. Rendered inline inside the
 * post menu rather than as a nested popover: NativePopover panels are siblings of their
 * trigger, so a nested `auto` popover would light-dismiss the menu that opened it.
 */
const PostDocumentActions = ({ item, close }) => {
  const [showAiTargets, setShowAiTargets] = useState(false)

  const copyAsMarkdown = async (e) => {
    e.stopPropagation()

    try {
      await navigator.clipboard.writeText(postToMarkdown(item, { origin: window.location.origin }))
      toast('Post copied as markdown', 'success')
    } catch {
      toast('Failed to copy', 'error')
    }
    close()
  }

  const openAiTarget = (e, target) => {
    e.stopPropagation()
    window.open(buildPostAiUrl(target, item, { origin: window.location.origin }), '_blank', 'noopener,noreferrer')
    close()
  }

  return (
    <>
      <MenuItem icon={<ClipboardTextIcon size={20} />} label="Copy post" description="Copy the post as Markdown" onClick={copyAsMarkdown} />
      <MenuItem
        icon={<MarkdownLogoIcon size={20} />}
        label="View as markdown"
        description="View this post as plain text"
        href={getPostMarkdownUrl(item)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View this post as plain markdown"
        onClick={(e) => e.stopPropagation()}
      />
      <MenuItem
        icon={<SparkleIcon size={20} />}
        label="Summarize with AI"
        description="Hand this post to an assistant"
        trailing={<CaretDownIcon size={14} className={styles.post__menuCaret} data-expanded={showAiTargets} />}
        aria-expanded={showAiTargets}
        onClick={(e) => {
          e.stopPropagation()
          setShowAiTargets((prev) => !prev)
        }}
      />
      {showAiTargets &&
        AI_TARGETS.map((target) => (
          <MenuItem
            key={target.id}
            className={styles['post__menuItem--nested']}
            icon={<AiTargetLogo target={target} />}
            label={`Open in ${target.label}`}
            description="Ask questions about this post"
            onClick={(e) => openAiTarget(e, target)}
          />
        ))}
    </>
  )
}

const Nav = ({ item, setShowEditModal, setShowReportModal }) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showEmbedModal, setShowEmbedModal] = useState(false)
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
  // A Solana post is owned and deleted by the Solana wallet, an EVM post by the EVM one
  const solanaWallet = useSolanaWallet()
  const isSolanaPost = isSolanaNetworkId(item.network_id)
  const isOwner = sameAddress(isSolanaPost ? solanaWallet.address : address, item.wallet_address)

  const deletePost = async (e, id) => {
    e.stopPropagation()

    if (isDeleting || isPending || isConfirming) return

    if (isSolanaPost) {
      const signer = solanaWallet.getSigner()
      if (!signer) {
        toast('Connect your Solana wallet first', 'error')
        return
      }

      setIsDeleting(true)
      try {
        const networkId = Number(item.network_id)
        // Never sponsored, like un-repost on EVM: deletions are the author's own spend
        await sendHupAction({
          networkId,
          signer,
          sponsor: false,
          instructions: [hupInstruction.delete({ networkId, actor: signer.account.address, id })],
        })
        toast('Post deleted onchain', 'success')
      } catch (err) {
        console.error('Delete failed:', err)
        toast(shortTxError(err, 'Could not delete the post'), 'error')
      } finally {
        setIsDeleting(false)
      }
      return
    }

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

      setIsDeleting(true)

      writeContract(
        {
          abi,
          address: targetChain.hup,
          functionName: 'deleteContent',
          args: [address, id],
        },
        {
          onError: () => setIsDeleting(false),
        }
      )
    } catch (err) {
      console.error('Delete failed:', err)
      setIsDeleting(false)
    }
  }

  const activeChain = getActiveChain()
  return (
    <>
      <NativePopover
        trigger={
          <Tooltip content="More" placement="bottom" size="compact" hoverOnly>
            <button
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={() => router.prefetch(`/networks/${item.network_id}/${item.id}`)}
              className={clsx(styles.post__navTrigger, 'pointer rounded-full')}
              aria-label="Post options"
            >
              <DotsThreeIcon width={20} height={20} />
            </button>
          </Tooltip>
        }
        placement="bottom-end"
      >
        {({ close }) => (
          <div className={clsx(styles.post__menu, 'flex flex-column align-items-center justify-content-start')}>
            <ul>
              <MenuItem
                icon={<EyeIcon size={20} />}
                label="View"
                description="Open the full post"
                onClick={(e) => {
                  e.stopPropagation()
                  setCurrentPost(item)
                  router.push(`/networks/${item.network_id}/${item.id}`)
                }}
              />
              {item.tx_hash && (
                <MenuItem
                  icon={<PackageIcon size={20} />}
                  label="Proof"
                  description="See the onchain receipt"
                  href={txExplorerUrl(item)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="View transaction proof on block explorer"
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              <PostDocumentActions item={item} close={close} />
              {/* Sealed community content would embed as nothing but the lock placeholder */}
              {!item.content?.encrypted && (
                <MenuItem
                  icon={<CodeIcon size={20} />}
                  label="Embed"
                  description="Show this post on your own site"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowEmbedModal(true)
                    close()
                  }}
                />
              )}
              {isOwner && (
                <MenuItem
                  icon={<TagIcon size={20} />}
                  label="Sell"
                  description="List this post for sale"
                  onClick={(e) => {
                    e.stopPropagation()
                    sellPopoverRef.current?.open()
                    close()
                  }}
                />
              )}
              {isOwner && item.is_repost < 1 && (
                <MenuItem
                  icon={<NotePencilIcon size={20} />}
                  label="Edit"
                  description="Change what this post says"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowEditModal(true)
                    close()
                  }}
                />
              )}
              {isOwner && (
                <MenuItem
                  icon={<TrashSimpleIcon size={20} />}
                  label={isDeleting || isPending || isConfirming ? 'Deleting…' : 'Delete'}
                  description="Remove this post onchain"
                  disabled={isDeleting || isPending || isConfirming}
                  onClick={(e) => deletePost(e, item.id)}
                />
              )}
              {!isOwner && (
                <MenuItem
                  icon={<FlagIcon size={20} />}
                  label="Report"
                  description="Flag this post for review"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowReportModal(item)
                    close()
                  }}
                />
              )}
            </ul>
          </div>
        )}
      </NativePopover>
      <SellItemPopover ref={sellPopoverRef} item={item} />
      {showEmbedModal && <EmbedPostDialog item={item} onClose={() => setShowEmbedModal(false)} />}
    </>
  )
}

export function PostCard({ item, actions, chainId, networkName }) {
  const router = useRouter()
  const { setCurrentPost } = usePostStore()
  const { address } = useActiveWallet()

  const shouldFetch = Number(item?.total_comments || 0) > 0

  // Newest reply previewed under the card. Feed rows arrive with it embedded
  // (last_comment, hydrated server-side by the posts route), so the preview
  // paints with the feed instead of popping in below it and pushing the page
  // down — the fetcher only runs for rows from surfaces that don't embed.
  // Same SWR recipe as the repost original above: the cache survives unmounts
  // for restored feeds, revalidateIfStale stays off, and keepPreviousData
  // holds the preview through the anonymous → connected key change.
  const lastCommentKey =
    shouldFetch && item?.id && item?.network_id
      ? `posts/${item.network_id}/${item.id}/${address || 'anonymous'}/last-comment`
      : null
  const { data: lastComment, isLoading } = useSWR(
    lastCommentKey,
    async () => {
      const params = new URLSearchParams({ last: 'true' })
      if (address) params.set('viewer_address', address)
      const res = await fetch(`/api/v1/networks/${item.network_id}/${item.id}/comments?${params.toString()}`)
      const body = await res.json().catch(() => null)
      if (!res.ok || body?.success === false) throw new Error(body?.error || 'Failed to fetch last comment')
      const comment = Array.isArray(body?.data) ? body.data[0] : body?.data
      return comment ?? null
    },
    { fallbackData: item?.last_comment ?? undefined, revalidateIfStale: false, keepPreviousData: true },
  )
  const isLastCommentLoading = isLoading && !lastComment

  const hasCommentBelow = shouldFetch && (isLastCommentLoading || !!lastComment)

  const openLastComment = (e) => {
    e.stopPropagation()
    if (isTextSelectionDrag(e)) return
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
            onPointerDown={rememberCardPointerDown}
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
  const { address } = useActiveWallet()
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
  const { address } = useActiveWallet()
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
      {/* Compact: a quoted article is already two levels deep, and its cover plus excerpt would
          make the quote taller than the post doing the quoting */}
      {quotedPost?.content?.article && (
        <ArticleCard article={quotedPost.content.article} networkId={networkId} postId={quotedPost.id} compact />
      )}
      {quotedPost?.content?.predictMarket && <PredictCard marketRef={quotedPost.content.predictMarket} />}
      {/* A quoted poll is votable in place, like the original — the card resolves the same
          onchain tally either way, so nothing is gained by making the reader open the post */}
      {quotedPost?.content?.poll && <PollCard pollRef={quotedPost.content.poll} />}
      {quotedPost?.content?.tokenLaunch && <LaunchCard launchRef={quotedPost.content.tokenLaunch} />}
      {quotedPost?.content?.nftDrop && (
        // Quoting a drop is a referral channel like reposting: mints made from this
        // quote credit the quote's author with the drop's referral share
        <DropCard drop={quotedPost.content.nftDrop} referral={quotedBy} />
      )}
      {quotedPost?.content?.miniApp && <MiniAppEmbed reference={quotedPost.content.miniApp} contextAddress={quotedPost?.wallet_address} />}
    </div>
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

  // The reader's own choice from Settings → Language, defaulting to their browser language
  const preferredLanguage = usePreferredLanguage()

  // Verify language profile to optimize translation button visibility using external helper
  const canTranslate = useMemo(() => shouldOfferTranslation(sourceText, preferredLanguage), [sourceText, preferredLanguage])

  // Execute external translation pipeline via cached hooks infrastructure. The target
  // language is part of the SWR key, so switching it in Settings re-translates and caches
  // each language separately instead of serving the previous one.
  const { data: translatedText, isValidating: isTranslating } = useSWR(
    showTranslation && sourceText ? [sourceText, preferredLanguage] : null,
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
        // Marks the clamp for anything that has to undo it — a copy of this post as a picture
        // shows all of the words, because a picture has nothing to expand (lib/postCaptureSheet.js)
        data-collapsed={isCollapsible && !isExpanded ? 'true' : undefined}
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
          data-show-more
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded((prev) => !prev)
          }}
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      )}

      {/* Conditionally suppress translation controls if the post already reads in the chosen language */}
      {canTranslate && (
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
