'use client'

import { useState, useEffect, useLayoutEffect, useId, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { isArticle } from '@/lib/article'
import Link from 'next/link'
import { usePostStore } from '@/stores/usePostStore'
import { useWaitForTransactionReceipt, useConnection, useSignTypedData, useWriteContract, usePublicClient } from 'wagmi'
import { getPublicClient } from 'wagmi/actions'
import { initHupContract } from '@/lib/communication'
import { getPostById, recordPostView } from '@/lib/api'
import { useClientMounted } from '@/hooks/useClientMount'
import { useProfile, profileFallbackFromRow } from '@/hooks/useProfile'
import { profilePath } from '@/lib/username'
import abi from '@/abi/post.json'
import { getActiveChain } from '@/lib/communication'
import { toast } from '@/components/NextToast'
import Profile from '@/components/Profile'
import { CommentIcon, ShareIcon } from '@/components/Icons'
import { openConnect } from '@/lib/connectDialog'
import MediaGallery from './Gallery'
import {
  CaretDownIcon,
  ChartLineDownIcon,
  ClipboardTextIcon,
  CodeIcon,
  CoinsIcon,
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
} from '@phosphor-icons/react'
import { CONTRACTS, config } from '@/config/wagmi'
import { isSessionActive } from '@/lib/burnerSession'
import { gaslessCooldown, isGaslessEnabled, relayHupAction } from '@/lib/relayGasless'
import { renderMarkdown } from '@/lib/markdown'
import { routeInternalLinkClick } from '@/lib/internalLinks'
import { rememberCardPointerDown, isTextSelectionDrag } from '@/lib/cardClick'
import { postToMarkdown, getPostMarkdownUrl } from '@/lib/postMarkdown'
import { AI_TARGETS, buildPostAiUrl } from '@/lib/aiTargets'
import useSWR, { useSWRConfig } from 'swr'
import { getPostStatsKey, usePostStats } from '@/hooks/usePostStats'
import NativePopover from './ui/NativePopover'
import Tooltip from './ui/Tooltip'
import SellItemPopover from './SellItemPopover'
import EmbedPostDialog from './EmbedPostDialog'
import DeletePostDialog from './DeletePostDialog'
import TipModal from './TipModal'
import BuyButton from './BuyButton'
import TradeCard from './TradeCard'
import ArticleCard from './ArticleCard'
import DropCard from './DropCard'
import PredictCard from './PredictCard'
import PollCard from './PollCard'
import ProposalEmbed from './ProposalEmbed'
import FundCard from './FundCard'
import TaskCard from './TaskCard'
import SealedSubmission from './SealedSubmission'
import { arcoLaunchHref } from '@/lib/arco'
import MiniAppEmbed from './MiniAppEmbed'
import CashtagStrip from './CashtagStrip'
import TokenTradeCard from './TokenTradeCard'
import LinkPreview from './LinkPreview'
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
import { PostSkeleton } from './ui/PostSkeleton'
import { isVeiledByReports } from '@/lib/reports'
import clsx from 'clsx'
import { useBlockedUsers } from '@/hooks/useBlockedUsers'
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

// `authorFallback`: paint the byline from the row's own name and picture before the profile
// fetch answers. Only the post page's own post opts in — its row is read with the handle, so the
// name line will not change when the profile lands; feed rows are not, and would flip.
export default function Post({ item, showContent, actions, chainId, hasCommentBelow = false, authorFallback = false, threadAuthor = null }) {
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
  const isActioned = isVeiledByReports(item.actioned_reports) || Number(item.moderation_flagged || 0) === 1
  const [isRevealed, setIsRevealed] = useState(false)
  const isVeiled = isActioned && !isRevealed
  const repostedPostId = isRepost ? Number(item.is_repost) : null
  const [showEditModal, setShowEditModal] = useState(false)
  const [showReportModal, setShowReportModal] = useState(null)
  // Set as soon as the owner confirms a delete, cleared again if the delete fails
  const [isRemoved, setIsRemoved] = useState(false)
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
    { fallbackData: item.repost_original ?? undefined, revalidateIfStale: false, keepPreviousData: true }
  )

  const baseDisplayItem = isRepost ? repostedPost : item
  const { isBlocked } = useBlockedUsers()
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
  if (isBlocked(baseDisplayItem?.wallet_address) || isBlocked(item.wallet_address)) return null

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
        data-removed={isRemoved}
      >
        {isRepost && <RepostLabel walletAddress={item.wallet_address} />}
        <header className={`${styles.post__header} flex align-items-start justify-content-between w-100`}>
          <Profile
            size={38}
            creator={displayItem?.wallet_address}
            createdAt={displayItem?.created_at}
            networkId={displayItem?.network_id}
            fallback={authorFallback ? profileFallbackFromRow(displayItem) : undefined}
            // A reply from whoever started the thread says so, as Threads marks it
            tag={threadAuthor && sameAddress(displayItem?.wallet_address, threadAuthor) ? 'Author' : null}
            // "name › community" in the byline, where Threads names the community a post went to
            community={
              displayItem?.community_name
                ? { name: displayItem.community_name, href: `/communities/${displayItem.network_id}/${displayItem.community_id}` }
                : null
            }
          />

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

            <Nav
              item={item}
              setShowEditModal={setShowEditModal}
              setShowReportModal={setShowReportModal}
              tipPost={displayItem || item}
              onTip={actionsSet.has('tip') ? setShowTipModal : undefined}
              onRemovedChange={setIsRemoved}
            />
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

              <ThreadMarker item={displayItem} showThreadLink={!showContent} />

              {/* The first link's own content — an X post with its media, a YouTube player or an
                  Open Graph card — resolved live from the text. Hidden when the post carries its
                  own gallery, the way X does, so a row never stacks two sets of pictures. */}
              <LinkPreview text={sourceText} hasMedia={displayItem?.content?.elements?.[1]?.data?.items?.length > 0} />

              {displayItem?.content?.quoteOf && (
                <QuotedPost
                  networkId={displayItem.network_id}
                  quoteId={displayItem.content.quoteOf}
                  quotedBy={displayItem.wallet_address}
                />
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
              {displayItem?.content?.proposal && <ProposalEmbed proposalRef={displayItem.content.proposal} />}
              {displayItem?.content?.hupFund && <FundCard fundRef={displayItem.content.hupFund} />}
              {displayItem?.content?.hupTask && (
                <TaskCard
                  taskRef={displayItem.content.hupTask}
                  networkId={displayItem.network_id}
                  postId={displayItem.id}
                  author={displayItem.wallet_address}
                  onSubmit={() => setShowCommentModal(displayItem)}
                />
              )}
              {displayItem?.content?.taskSubmission && (
                <SealedSubmission
                  envelope={displayItem.content.taskSubmission}
                  networkId={displayItem.network_id}
                  parentId={displayItem.is_comment ?? displayItem.parent_id}
                  replyId={displayItem.id}
                />
              )}

              {displayItem?.content?.tokenLaunch && (
                <a href={arcoLaunchHref(displayItem.content.tokenLaunch)} target="_blank" rel="noopener noreferrer">
                  View this launch on Arco
                </a>
              )}

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
              {displayItem?.content?.miniApp && (
                <MiniAppEmbed reference={displayItem.content.miniApp} contextAddress={displayItem?.wallet_address} />
              )}

              {/* The creator fee is paid to the row's signed author, never to anything the
                  content JSON names — a post is editable, and its own payload is not authority
                  over where money goes */}
              {displayItem?.content?.tokenTrade && (
                <TokenTradeCard trade={displayItem.content.tokenTrade} author={displayItem?.wallet_address} />
              )}

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
          {showContent && <PostMeta item={item} createdAt={displayItem?.created_at} />}
          <div
            onClick={(e) => {
              // Only real controls (and open popover panels) keep their clicks — blank
              // action-bar space still opens the details view like the rest of the card
              if (e.target.closest('button, a, [popover]')) e.stopPropagation()
            }}
            className={`${styles.post__actions} flex flex-row align-items-center justify-content-between`}
          >
            <div className={clsx(styles.post__actions__group, styles['post__actions__group--primary'], 'flex flex-row align-items-center')}>
              {actionsSet.has('like') && <Like post={displayItem || item} />}

              {actionsSet.has('comment') && <CommentAction post={commentTarget} onComment={setShowCommentModal} />}

              {actionsSet.has('repost') && <Repost post={displayItem || item} onQuote={() => setShowQuoteModal(displayItem || item)} />}

              {actionsSet.has('tip') && <Tip post={displayItem || item} onTip={setShowTipModal} />}

              {actionsSet.has('view') && <View post={item} />}
            </div>
            <div className={clsx(styles.post__actions__group, 'flex align-items-center')}>
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

const metaTimeFormatter = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' })
const metaDateFormatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
const metaViewsFormatter = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/**
 * "6:22 PM · Oct 28, 2026 · 13.4K Views" under the open post, as X stamps its post page. The
 * views come from the same live stats as the View action, so the two never disagree.
 * @param {Object} props
 * @param {Object} props.item The row whose views are counted (a repost counts its own).
 * @param {string} props.createdAt
 */
const PostMeta = ({ item, createdAt }) => {
  const { stats } = usePostStats(item)
  const date = createdAt ? new Date(createdAt) : null
  const hasDate = date && !Number.isNaN(date.getTime())
  const views = Number(stats?.total_views ?? item?.total_views) || 0

  if (!hasDate && views === 0) return null

  return (
    <div className={styles.post__meta}>
      {hasDate && (
        // Local time differs between the server render and the reader's browser
        <time dateTime={date.toISOString()} title={date.toLocaleString()} suppressHydrationWarning>
          {metaTimeFormatter.format(date)} · {metaDateFormatter.format(date)}
        </time>
      )}
      {hasDate && views > 0 && <span aria-hidden="true">·</span>}
      {views > 0 && (
        <span>
          <strong className={styles.post__meta__count}>{metaViewsFormatter.format(views)}</strong> {views === 1 ? 'View' : 'Views'}
        </span>
      )}
    </div>
  )
}

const RepostLabel = ({ walletAddress }) => {
  const { profile } = useProfile(walletAddress)
  const truncatedAddress = walletAddress ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}` : ''
  const displayName = profile?.name || truncatedAddress

  return (
    <Link href={profilePath(walletAddress, profile?.username)} className={styles.post__repostLabel} onClick={(e) => e.stopPropagation()}>
      <RepeatIcon width={16} height={16} />
      <span className={styles.post__repostLabel__name}>{displayName}</span>
      {` Reposted`}
    </Link>
  )
}

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

const Nav = ({ item, setShowEditModal, setShowReportModal, tipPost, onTip, onRemovedChange }) => {
  const { address: blockViewer, isBlocked, toggleBlock } = useBlockedUsers()
  const postIsArticle = (() => {
    try {
      const content = typeof item?.content === 'string' ? JSON.parse(item.content) : item?.content
      return isArticle(content)
    } catch {
      return false
    }
  })()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showEmbedModal, setShowEmbedModal] = useState(false)
  const isMounted = useClientMounted()
  const router = useRouter()
  const { setCurrentPost } = usePostStore()
  const { address, isConnected } = useConnection()
  const { data: hash, isPending, mutate: writeContract } = useWriteContract()
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash,
  })
  const publicClient = usePublicClient()
  const { signTypedDataAsync } = useSignTypedData()
  const sellPopoverRef = useRef(null)
  const deleteDialogRef = useRef(null)
  // One loading toast follows the delete from confirm to receipt, then morphs into the outcome
  const deleteToastRef = useRef(null)
  // Buyers who have paid and are still waiting for their key. Named in the menu because the escrow
  // is reclaimable after 24h, so "Sell" alone gives the seller no reason to open the dialog in time.
  const [pendingGrants, setPendingGrants] = useState(0)
  // A Solana post is owned and deleted by the Solana wallet, an EVM post by the EVM one
  const solanaWallet = useSolanaWallet()
  const isSolanaPost = isSolanaNetworkId(item.network_id)
  const isOwner = sameAddress(isSolanaPost ? solanaWallet.address : address, item.wallet_address)

  /**
   * Relays the delete through the forwarder so removing your own post costs nothing. The
   * contract refuses anything the resolved actor did not write, and refuses an id twice, so
   * the relayer can only ever pay to remove this post once. Returns false when the relay is
   * unavailable — cooldown included — leaving the tap on the wallet path, where the prompt is
   * the consent to pay.
   * @param {string|number} id The content id to remove.
   * @returns {Promise<boolean>} Whether the delete went out sponsored.
   */
  const tryGaslessDelete = async (id) => {
    const chainId = Number(item.network_id)
    if (!isGaslessEnabled(chainId)) return false
    if (gaslessCooldown('deleteContent', chainId, address) > 0) return false

    const chainDefinition = config.chains.find((chain) => chain.id === chainId)
    if (!chainDefinition) return false

    // Pinned to the post's own chain: the relay reads nonce and forwarder trust there,
    // regardless of which network the wallet is connected to
    const targetPublicClient = getPublicClient(config, { chainId }) ?? publicClient

    try {
      const session = await isSessionActive({ userAddress: address, publicClient: targetPublicClient })

      await relayHupAction({
        chain: chainDefinition,
        publicClient: targetPublicClient,
        owner: address,
        functionName: 'deleteContent',
        args: [address, BigInt(id)],
        signTypedDataAsync,
        useSessionKey: session.active,
      })

      return true
    } catch (err) {
      if (err.code === 'RELAY_COOLDOWN') {
        toast('Free-delete allowance is used up for now — using your wallet instead.', 'info')
      } else {
        console.warn('Gasless delete unavailable:', err.message)
      }
      return false
    }
  }

  /**
   * Hides the post and opens the loading toast the rest of the delete resolves.
   */
  const startOptimisticDelete = () => {
    onRemovedChange?.(true)
    deleteToastRef.current = toast('Deleting post…', 'loading')
  }

  /**
   * Resolves the delete toast — falling back to a fresh one if the user closed it — and puts the
   * post back when the delete did not go through.
   * @param {string} message What to tell the user.
   * @param {'success'|'error'} type The outcome.
   */
  const finishDelete = (message, type) => {
    if (type !== 'success') onRemovedChange?.(false)
    if (!deleteToastRef.current?.update(message, type)) toast(message, type)
    deleteToastRef.current = null
    setIsDeleting(false)
  }

  useEffect(() => {
    if (!deleteToastRef.current || (!isConfirmed && !receiptError)) return
    // Mirrors wagmi's receipt state into the toast and the parent's hidden flag
    finishDelete(...(isConfirmed ? ['Post deleted onchain', 'success'] : [shortTxError(receiptError, 'Could not delete the post'), 'error']))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed, receiptError])

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
      startOptimisticDelete()
      try {
        const networkId = Number(item.network_id)
        await sendHupAction({
          networkId,
          signer,
          instructions: [hupInstruction.delete({ networkId, actor: signer.account.address, id })],
        })
        finishDelete('Post deleted onchain', 'success')
      } catch (err) {
        console.error('Delete failed:', err)
        finishDelete(shortTxError(err, 'Could not delete the post'), 'error')
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
      setIsDeleting(true)
      startOptimisticDelete()

      if (await tryGaslessDelete(id)) {
        finishDelete('Post deleted onchain', 'success')
        return
      }

      deleteToastRef.current?.update('Confirm the delete in your wallet…', 'loading')
      // The receipt effect above resolves the toast once the transaction lands
      writeContract(
        {
          abi,
          address: targetChain.hup,
          functionName: 'deleteContent',
          args: [address, id],
        },
        {
          onSuccess: () => deleteToastRef.current?.update('Deleting post…', 'loading'),
          onError: (err) => finishDelete(shortTxError(err, 'Could not delete the post'), 'error'),
        }
      )
    } catch (err) {
      console.error('Delete failed:', err)
      finishDelete(shortTxError(err, 'Could not delete the post'), 'error')
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
              {onTip && (
                <MenuItem
                  icon={<CoinsIcon size={20} />}
                  label="Tip creator"
                  description="Send a tip to support this creator"
                  onClick={(event) => {
                    event.stopPropagation()
                    close()
                    if (!isConnected) {
                      if (!openConnect()) toast('Please connect wallet', 'error')
                      return
                    }
                    onTip(tipPost)
                  }}
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
                  label={pendingGrants > 0 ? `Sell · ${pendingGrants} waiting` : 'Sell'}
                  description={
                    pendingGrants > 0
                      ? `${pendingGrants} buyer${pendingGrants === 1 ? '' : 's'} paid and ${pendingGrants === 1 ? 'is' : 'are'} waiting for a key`
                      : 'List this post for sale'
                  }
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
                  description={postIsArticle ? 'Open this article in the editor' : 'Change what this post says'}
                  onClick={(e) => {
                    e.stopPropagation()
                    /* An article's body lives at its own CID and its fields have their own editor.
                       Sending it to the post composer would drop the reference and turn it back
                       into a plain post. */
                    if (postIsArticle) {
                      router.push(`/compose/article?network=${item.network_id}&post=${item.id}`)
                    } else {
                      setShowEditModal(true)
                    }
                    close()
                  }}
                />
              )}
              {isOwner && (
                <MenuItem
                  className={styles['post__menuItem--danger']}
                  icon={<TrashSimpleIcon size={20} />}
                  label={isDeleting || isPending || isConfirming ? 'Deleting…' : 'Delete'}
                  description="Remove this post onchain"
                  disabled={isDeleting || isPending || isConfirming}
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteDialogRef.current?.open()
                    close()
                  }}
                />
              )}
              {blockViewer && !sameAddress(blockViewer, item.wallet_address) && (
                <MenuItem
                  icon={<FlagIcon size={20} />}
                  label={isBlocked(item.wallet_address) ? 'Unblock user' : 'Block user'}
                  description="Hide this user's posts in feeds on this browser"
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleBlock(item.wallet_address)
                    close()
                  }}
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
      <SellItemPopover ref={sellPopoverRef} item={item} onPendingCount={setPendingGrants} />
      {isOwner && <DeletePostDialog ref={deleteDialogRef} onConfirm={(e) => deletePost(e, item.id)} />}
      {showEmbedModal && <EmbedPostDialog item={item} onClose={() => setShowEmbedModal(false)} />}
    </>
  )
}

/**
 * "2/3" on a part of a thread its author published in one go, as Threads counts them. On the
 * first part, wherever it stands alone (a feed), it also offers the rest — the post page draws
 * every part under the first one.
 */
function ThreadMarker({ item, showThreadLink }) {
  const router = useRouter()
  const { setCurrentPost } = usePostStore()
  const part = Number(item?.content?.thread?.part)
  const of = Number(item?.content?.thread?.of)
  if (!part || !(of > 1)) return null

  return (
    <div className={styles.post__thread}>
      <span className={styles.post__threadCount}>
        {part}/{of}
      </span>
      {showThreadLink && part === 1 && (
        <button
          type="button"
          className={styles.post__threadLink}
          // A copy as image carries the parts themselves, so the way to them stays off it
          data-capture-ignore
          onClick={(e) => {
            e.stopPropagation()
            setCurrentPost(item)
            router.push(`/networks/${item.network_id}/${item.id}`)
          }}
        >
          Show thread
        </button>
      )}
    </div>
  )
}

export function PostCard({ item, actions, chainId, networkName, threadAuthor = null }) {
  const { isBlocked } = useBlockedUsers()
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
    shouldFetch && item?.id && item?.network_id ? `posts/${item.network_id}/${item.id}/${address || 'anonymous'}/last-comment` : null
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
    { fallbackData: item?.last_comment ?? undefined, revalidateIfStale: false, keepPreviousData: true }
  )
  const isLastCommentLoading = isLoading && !lastComment

  const visibleLastComment = isBlocked(lastComment?.wallet_address) ? null : lastComment
  const hasCommentBelow = shouldFetch && (isLastCommentLoading || !!visibleLastComment)

  const openLastComment = (e) => {
    e.stopPropagation()
    if (isTextSelectionDrag(e)) return
    setCurrentPost(lastComment)
    router.push(`/networks/${lastComment.network_id}/${lastComment.id}`)
  }

  return (
    <div className={styles.postCard}>
      <Post item={item} actions={actions} chainId={chainId} networkName={networkName} hasCommentBelow={hasCommentBelow} threadAuthor={threadAuthor} />
      {shouldFetch &&
        (isLastCommentLoading ? (
          <LastCommentShimmer />
        ) : visibleLastComment ? (
          <div
            className={styles.post__commentLink}
            onPointerDown={rememberCardPointerDown}
            onClick={openLastComment}
            onMouseEnter={() => router.prefetch(`/networks/${lastComment.network_id}/${lastComment.id}`)}
          >
            <Post
              item={lastComment}
              actions={['like', 'comment', 'share', 'repost', 'tip', 'view', 'quote', 'bookmark']}
              chainId={chainId}
              threadAuthor={threadAuthor}
            />
          </div>
        ) : null)}
    </div>
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

  // Same SWR recipe as the repost original in Post: the cache survives unmounts, so a feed
  // restored from useFeedCacheStore repaints the quote card in its first frame instead of
  // collapsing it while it refetches — which left a blank gap inside the card's reserved height.
  const quotedKey = getPostStatsKey({ id: quoteId, network_id: networkId }, address)
  const { data: fetchedQuotedPost, isLoading } = useSWR(
    quotedKey,
    async () => {
      const res = await getPostById(networkId, quoteId, address)
      const post = Array.isArray(res?.data) ? res.data[0] : res?.data
      return post ?? null
    },
    { revalidateIfStale: false, keepPreviousData: true }
  )

  // Same in-place decryption the main card gets — a quoted encrypted post renders readable for
  // members instead of the locked placeholder. Called before the early returns (hook rules).
  const quotedPost = useDecryptedCommunityItem(fetchedQuotedPost ?? null)
  const { isBlocked } = useBlockedUsers()

  if (isLoading && !fetchedQuotedPost) return null

  if (isBlocked(quotedPost?.wallet_address)) return null

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
          onClick={(e) => handleBodyLinkClick(e, router)}
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
      {quotedPost?.content?.proposal && <ProposalEmbed proposalRef={quotedPost.content.proposal} />}
      {quotedPost?.content?.hupFund && <FundCard fundRef={quotedPost.content.hupFund} />}
      {quotedPost?.content?.hupTask && (
        <TaskCard taskRef={quotedPost.content.hupTask} networkId={networkId} postId={quotedPost.id} author={quotedPost.wallet_address} />
      )}
      {quotedPost?.content?.tokenLaunch && (
        <a href={arcoLaunchHref(quotedPost.content.tokenLaunch)} target="_blank" rel="noopener noreferrer">
          View this launch on Arco
        </a>
      )}
      {quotedPost?.content?.nftDrop && (
        // Quoting a drop is a referral channel like reposting: mints made from this
        // quote credit the quote's author with the drop's referral share
        <DropCard drop={quotedPost.content.nftDrop} referral={quotedBy} />
      )}
      {quotedPost?.content?.miniApp && <MiniAppEmbed reference={quotedPost.content.miniApp} contextAddress={quotedPost?.wallet_address} />}
      {/* A quoted widget trades in place, like a quoted poll votes in place — and the fee
          still follows the original author, not whoever quoted them */}
      {quotedPost?.content?.tokenTrade && <TokenTradeCard trade={quotedPost.content.tokenTrade} author={quotedPost?.wallet_address} />}
    </div>
  )
}

// ■■■ Translation Core Infrastructure ■■■

// Google's endpoint sends no CORS header and answers browsers with a redirect, so the
// call has to leave from our own origin
const translationFetcher = async ([text, targetLang, address]) => {
  if (!text) return ''

  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The wallet lifts the free daily allowance for a premium reader; the route verifies it
    body: JSON.stringify({ text, target: targetLang, address: address ?? null }),
  })

  if (!res.ok) {
    // The daily-allowance refusal carries a sentence worth showing, unlike a provider failure
    const body = await res.json().catch(() => null)
    const error = new Error(body?.premiumRequired ? body.error : 'Translation pipeline network response failed')
    error.premiumRequired = Boolean(body?.premiumRequired)
    throw error
  }

  const data = await res.json()
  return data?.text || ''
}

// ■■■ Sub-Component Definition ■■■

// Mentions and internal links are injected HTML with no Link behind them, so a plain click is
// routed by hand to skip a full page load; modified clicks keep the browser's new-tab behavior.
// Propagation stops here (the card would open post details), so the global router never sees it.
function handleBodyLinkClick(event, router) {
  const anchor = event.target.closest('a')
  if (!anchor) return
  event.stopPropagation()
  routeInternalLinkClick(event, router)
}

export function PostText({ sourceText, postId, styles, renderMarkdown, isCollapsible = false, baseClassName }) {
  const router = useRouter()
  const { address: readerAddress } = useActiveWallet()
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
  const {
    data: translatedText,
    error: translationError,
    isValidating: isTranslating,
    mutate: retryTranslation,
  } = useSWR(showTranslation && sourceText ? [sourceText, preferredLanguage, readerAddress ?? null] : null, translationFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 600000,
    errorRetryCount: 2,
  })

  // Before paint, or the button lands a frame late and pushes the feed below it down
  useLayoutEffect(() => {
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
    // A failed translation leaves the original on screen, so the same button retries
    if (showTranslation && translationError) {
      // Retrying a spent daily allowance just spends another request on the same refusal
      if (translationError.premiumRequired) {
        toast(translationError.message, 'info')
        return
      }
      retryTranslation()
      return
    }
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
        // Links inside dangerouslySetInnerHTML have no React handler; keep their clicks from opening post details
        onClick={(e) => handleBodyLinkClick(e, router)}
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
            {isTranslating
              ? 'Translating...'
              : showTranslation && translationError
                ? // The allowance refusal is a different thing from a provider failing, and retrying it is pointless
                  translationError.premiumRequired
                  ? 'Daily limit reached'
                  : 'Translation unavailable — retry'
                : showTranslation && translatedText
                  ? 'See original'
                  : 'Translate'}
          </button>
        </div>
      )}
    </div>
  )
}
