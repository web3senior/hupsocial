'use client'

import Link from 'next/link'
import { isEvmAddress, isSolanaAddress, shortAddress } from '@/lib/address'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { useSolanaWalletStore } from '@/stores/useSolanaWalletStore'
import { SOLANA_DEVNET_ID, solanaExplorerUrl } from '@/config/solana'
import { useEffect, useState, useCallback, lazy, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { updateProfile, subscribeUser, unsubscribeUser, sendNotification, getPosts, recordProfileView, getUserBadges, getCountries } from '@/lib/api'
import { ORIGIN_OPTIONS } from '@/config/originOptions'
import { isCountryCode } from '@/lib/origin'
import { initHupContract, initStatusContract, getStatus, getMaxLength } from '@/lib/communication'
import { toast } from '@/components/NextToast'
import blueCheckMarkIcon from '@/../public/icons/blue-checkmark.svg'
import statusAbi from '@/abi/status.json'
import { useClientMounted } from '@/hooks/useClientMount'
import Post from '@/components/Post'
import { getActiveChain } from '@/lib/communication'
import { CommunityBadge } from '@/components/Profile'
import { useBalance, useWaitForTransactionReceipt, useConnection, useDisconnect, usePublicClient, useReadContract, useWriteContract } from 'wagmi'
import { lukso } from 'wagmi/chains'
import followerSystemAbi from '@/abis/LSP26FollowerSystem'
import moment from 'moment'
import { InfoIcon, ThreeDotIcon } from '@/components/Icons'
import ProfileInsights from '@/components/ProfileInsights'
import UPlogo from '@/../public/up.png'
import { uploadFileToIPFS } from '@/lib/ipfs'
import { isUniversalProfile, linksToRows, normalizeIpfsUri, readImageSize, readLsp3Profile } from '@/lib/lsp3'
import { syncProfileToUniversalProfile } from '@/lib/profileUpdateTracking'
import { rememberCardPointerDown, isTextSelectionDrag } from '@/lib/cardClick'
import AssetsTab from '@/components/tabs/AssetsTab'
import UniversalIdentity from '@/components/ui/UniversalIdentity/UniversalIdentity'
import { useProfile } from '@/hooks/useProfile'
import { handleBrokenAvatar } from '@/lib/utils'
import AgentBadge from '@/components/ui/AgentBadge'
import Avatar from '@/components/ui/Avatar'
import clsx from 'clsx'
import NativePopover from '@/components/ui/NativePopover'
import { ProfileQRCode } from './ProfileQRCode'
import FollowListDialog from './FollowListDialog'
import ProfileLinks from './ProfileLinks'
import BirthdayConfetti from '@/components/ui/BirthdayConfetti'
import { CakeIcon, CameraIcon, ImageIcon, MapPinIcon, RobotIcon } from '@phosphor-icons/react'
import styles from './UserProfile.module.scss'

// Compares month/day only — the stored year is irrelevant to "is it their birthday today".
const isBirthdayToday = (birthday) => {
  if (!birthday) return false
  const bday = new Date(birthday)
  if (Number.isNaN(bday.getTime())) return false
  const today = new Date()
  return bday.getUTCMonth() === today.getMonth() && bday.getUTCDate() === today.getDate()
}

const formatBirthday = (birthday) => {
  if (!birthday) return null
  const bday = new Date(birthday)
  if (Number.isNaN(bday.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(bday)
}

// import SettingsTab from '@/components/tabs/SettingsTab'
// const SettingsTab = lazy(() => import('@/components/tabs/SettingsTab'))
// todo: this cause to handle loading.jsx again

// Must stay consistent across all getPosts() calls: the API's offset is (page - 1) * limit,
// so mixing page sizes shifts the offset and re-fetches an already-loaded window.
const POSTS_PAGE_SIZE = 20

/**
 * Posts and Reposts are the same wallet-scoped feed under a different post_type filter,
 * so both tabs ride this hook. Both fetch on mount — their tab badges carry the totals,
 * so deferring one until its tab opens would leave that count blank until first click.
 */
const useProfileFeed = ({ wallet, viewer, postType }) => {
  const [posts, setPosts] = useState({ list: [] })
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  // Refs mirror the pagination state so the scroll handler never acts on a stale closure.
  const isFetchingRef = useRef(false)
  const hasMoreRef = useRef(false)
  const pageRef = useRef(1)

  useEffect(() => {
    isFetchingRef.current = isFetching
    hasMoreRef.current = hasMore
    pageRef.current = page
  }, [isFetching, hasMore, page])

  const loadMore = useCallback(async () => {
    if (isFetchingRef.current || !hasMoreRef.current) return

    setIsFetching(true)
    const nextPage = pageRef.current + 1

    try {
      const response = await getPosts(nextPage, POSTS_PAGE_SIZE, null, wallet, viewer, null, null, false, postType)

      if (response.success && response.data.length > 0) {
        setPosts((prev) => {
          // Posts are keyed per network, so dedupe on the (network_id, id) tuple
          const existingKeys = new Set(prev.list.map((p) => `${p.network_id}:${p.id}`))
          const uniqueNewPosts = response.data.filter((p) => !existingKeys.has(`${p.network_id}:${p.id}`))
          return { list: [...prev.list, ...uniqueNewPosts] }
        })
        setPage(nextPage)
      }
      setHasMore(response?.meta?.hasMore || false)
    } catch (error) {
      console.error('Error loading more posts:', error)
    } finally {
      setIsFetching(false)
    }
  }, [wallet, viewer, postType])

  // Re-runs when the viewer connects so has_liked/has_bookmarked flags reflect their wallet.
  useEffect(() => {
    let cancelled = false

    getPosts(1, POSTS_PAGE_SIZE, null, wallet, viewer, null, null, false, postType)
      .then((res) => {
        if (cancelled) return
        setTotal(res.meta?.total ?? res.meta?.count ?? 0)
        setPosts({ list: res.data || [] })
        setPage(1)
        setHasMore(res.meta?.hasMore || false)
      })
      .catch((error) => {
        console.error('Error loading posts:', error)
      })
      .finally(() => {
        if (!cancelled) setIsLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [wallet, viewer, postType])

  return { posts, total, hasMore, isFetching, isLoaded, loadMore }
}

export default function UserProfile() {
  const [activeTab, setActiveTab] = useState('posts') // New state for active tab
  const params = useParams()
  const router = useRouter()
  const { address: evmAddress } = useConnection()
  // The viewer is the wallet for the active network; the balance card stays EVM
  const { address, isConnected } = useActiveWallet()
  const { web3, contract } = initHupContract()
  const activeChain = getActiveChain()
  const balance = useBalance({
    address: evmAddress,
  })

  const postsFeed = useProfileFeed({ wallet: params.wallet, viewer: address, postType: 'original' })
  const repostsFeed = useProfileFeed({ wallet: params.wallet, viewer: address, postType: 'repost' })

  const TABS_DATA = [
    { id: 'posts', label: 'Posts', count: postsFeed.total },
    { id: 'assets', label: 'Assets' },
    { id: 'reposts', label: 'Reposts', count: repostsFeed.total },
  ]
  const TabContentMap = {
    events: <></>,
    //  jobs: JobsTab,
    apps: <></>,
    // feed: FeedTab,
  }
  const ActiveComponent = TabContentMap[activeTab]

  // Only the two post feeds paginate; the other tabs opt out of the scroll listener entirely.
  const activeFeedLoadMore = activeTab === 'posts' ? postsFeed.loadMore : activeTab === 'reposts' ? repostsFeed.loadMore : null

  // Same infinite-scroll trigger as the home feed: load the next page when the
  // viewport nears the bottom of the document.
  useEffect(() => {
    if (!activeFeedLoadMore) return

    const handleScroll = () => {
      const { scrollTop, clientHeight, scrollHeight } = document.documentElement
      const SCROLL_THRESHOLD = 300

      if (scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD) {
        activeFeedLoadMore()
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [activeFeedLoadMore])

  useEffect(() => {
    recordProfileView(params.wallet, address || null)
  }, [params.wallet])

  const handlePostPrefetch = (postId, chainId) => {
    router.prefetch(`/networks/${chainId}/${postId}`)
  }

  const handlePostClick = (postId, chainId) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(200)
    }

    router.push(`networks/${chainId}/${postId}`)
  }

  return (
    <>
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width={`small`}>
          <div className={`${styles.profileWrapper}`}>
            <Profile addr={params.wallet} />

            {/* Ensure posts and the list exist before mounting */}
            {postsFeed.posts?.list?.length > 0 && <ProfileInsights addr={params.wallet} posts={postsFeed.posts} />}
          </div>

          <section className={`${styles.tab} flex flex-row align-items-center justify-content-center w-100`}>
            <div className={`${styles.tab__container} flex align-items-center justify-content-around`}>
              {TABS_DATA.map((tab) => (
                <button
                  key={tab.id}
                  className={`${activeTab === tab.id ? styles.activeTab : ''} flex gap-1`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span
                      className={`lable lable-pill`}
                      style={{
                        background: `var(--network-color-primary)`,
                        color: `var(--network-color-text)`,
                      }}
                    >
                      {new Intl.NumberFormat('en', {
                        notation: 'compact',
                        maximumFractionDigits: 1,
                      }).format(tab.count)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>

          {activeTab === 'posts' && (
            <div className={`${styles.tabContent} ${styles.postTab} relative`}>
              <PostFeed feed={postsFeed} emptyLabel={`posts`} onPostClick={handlePostClick} onPostPrefetch={handlePostPrefetch} />
            </div>
          )}

          {activeTab === 'assets' && (
            <div className={`${styles.tabContent} ${styles.assets} relative`}>
              <AssetsTab />
            </div>
          )}

          {activeTab === 'activity' && (
            <div className={`${styles.tabContent} ${styles.activity} relative`}>
              <NoData name={`activity`} />
            </div>
          )}

          {activeTab === 'reposts' && (
            <div className={`${styles.tabContent} ${styles.postTab} ${styles.reposts} relative`}>
              <PostFeed feed={repostsFeed} emptyLabel={`reposts`} onPostClick={handlePostClick} onPostPrefetch={handlePostPrefetch} />
            </div>
          )}

        </div>
      </div>
    </>
  )
}

/**
 * Paginated post list shared by the Posts and Reposts tabs — a repost row renders
 * through the same <Post>, which resolves it to the original it points at.
 * @param {*} param0
 * @returns
 */
const PostFeed = ({ feed, emptyLabel, onPostClick, onPostPrefetch }) => {
  // Stay blank until the first page settles so the empty state can't flash mid-fetch.
  if (feed.posts.list.length === 0) return feed.isLoaded ? <NoData name={emptyLabel} /> : null

  return (
    <>
      <div className={`${styles.grid} flex flex-column`}>
        {feed.posts.list.map((item, i) => {
          return (
            <section
              key={`${item.network_id}:${item.id}`}
              className={`${styles.post} animate fade`}
              onPointerDown={rememberCardPointerDown}
              onClick={(e) => {
                if (isTextSelectionDrag(e)) return
                onPostClick(item.id, item.network_id)
              }}
              onMouseEnter={() => onPostPrefetch(item.id, item.network_id)}
              onTouchStart={() => onPostPrefetch(item.id, item.network_id)}
            >
              <Post item={item} actions={[`like`, `comment`, `repost`, `tip`, `view`, `share`, `bookmark`]} />
              {i < feed.posts.list.length - 1 && <hr />}
            </section>
          )
        })}
      </div>

      {feed.hasMore && (
        <div className="flex justify-content-center p-100">
          <button className={styles.loadMore} onClick={feed.loadMore} disabled={feed.isFetching}>
            {feed.isFetching ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </>
  )
}

/**
 * No data in tab content
 * @param {*} param0
 * @returns
 */
const NoData = ({ name }) => {
  return (
    <div className={`${styles.tabContent} ${styles.posts} d-f-c`}>
      <p style={{ color: `var(--gray-400)` }}>No {name} yet.</p>
    </div>
  )
}

const Nav = ({ item }) => {
  const [showPostDropdown, setShowPostDropdown] = useState()

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
              <Link href={`p/${item.postId}`}>View post</Link>
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}
/**
 * Loading state for the profile block. It mirrors the real markup below — same
 * containers, same avatar sizing — so the block occupies its final footprint and
 * the page doesn't jump when the profile resolves. Bars use the global `shimmer`
 * treatment, matching the post skeleton.
 */
const ProfileSkeleton = () => (
  <section
    className={clsx(styles.profile, styles.profileSkeleton, 'relative flex flex-column align-items-start justify-content-start gap-1')}
    aria-hidden="true"
  >
    <header className="flex flex-row align-items-center justify-content-between gap-050 w-100">
      <div className="flex-1 flex flex-column align-items-start justify-content-center gap-025">
        <div className={clsx('shimmer rounded', styles.profileSkeleton__name)} />
        <div className={clsx('shimmer rounded', styles.profileSkeleton__wallet)} />

        <div className={clsx(styles.profileSkeleton__bio, 'flex flex-column gap-025')}>
          <div className={clsx('shimmer rounded', styles.profileSkeleton__bioLine)} />
          <div className={clsx('shimmer rounded', styles.profileSkeleton__bioLine, styles['profileSkeleton__bioLine--short'])} />
        </div>

        <div className={clsx(styles.profileSkeleton__tags, 'flex flex-row align-items-center flex-wrap gap-050')}>
          <span className={clsx('shimmer rounded', styles.profileSkeleton__tag)} />
          <span className={clsx('shimmer rounded', styles.profileSkeleton__tag)} />
          <span className={clsx('shimmer rounded', styles.profileSkeleton__tag)} />
        </div>
      </div>

      <div className={clsx(styles.profile__pfp, 'rounded relative')}>
        <div className={clsx('shimmer', styles.profileSkeleton__pfp)} />
      </div>
    </header>

    <footer className="w-100 flex flex-column gap-1">
      <div className={clsx(styles.profileSkeleton__row, styles['profileSkeleton__row--stats'])}>
        <div className={clsx('shimmer rounded', styles.profileSkeleton__stats)} />
      </div>
      <div className={clsx(styles.profileSkeleton__row, styles['profileSkeleton__row--link'])}>
        <div className={clsx('shimmer rounded', styles.profileSkeleton__link)} />
      </div>
    </footer>
  </section>
)

/**
 * Detailed Profile View Layer
 * Handles data mapping for local profiles and native LUKSO Universal Profiles.
 */
const Profile = ({ addr }) => {
  const [data, setData] = useState(null)
  const [selfView, setSelfView] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [isItUp, setIsItUp] = useState(false)
  const [viewCount, setViewCount] = useState(null)
  const [birthdayBurstKey, setBirthdayBurstKey] = useState(0) // bumped to replay the confetti burst on tap
  // A cover whose bytes have died counts as no cover: the strip collapses rather than showing a
  // broken image where the profile's own header should be.
  const [coverFailed, setCoverFailed] = useState(false)
  const followListDialogRef = useRef(null)

  const params = useParams()
  // Self-view and disconnect follow the active network's wallet
  const { address, isConnected, kind: walletKind } = useActiveWallet()
  const { disconnect: disconnectEvm } = useDisconnect()
  const disconnectSolana = useSolanaWalletStore((state) => state.disconnect)
  const activeChain = getActiveChain()
  const { profile, isLoading, mutate } = useProfile(addr)
  /* Error during submission (e.g., user rejected)  */
  const { data: hash, isPending: isSigning, error: submitError, mutate: writeContract } = useWriteContract()
  /* Error after mining (e.g., transaction reverted) */
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash,
  })

  useEffect(() => {
    fetch(`/api/v1/users/${addr}/view`)
      .then((r) => r.json())
      .then((res) => res.success && setViewCount(res.total))
      .catch(() => {})
  }, [addr])

  // A new cover deserves its own chance to load — without this, one dead picture would hide
  // every replacement the user saved after it.
  useEffect(() => setCoverFailed(false), [profile?.profileHeader])

  // The connected chain decides follow vs unfollow — that is where the tx lands, and the
  // cross-network aggregate can disagree with it (indexer lag, or a follow made on another chain).
  const followerSystemAddress = activeChain?.[1]?.followerSystem
  const activeChainId = activeChain?.[0]?.id
  const canReadFollowState = Boolean(followerSystemAddress && walletKind !== 'solana' && isEvmAddress(address) && isEvmAddress(addr))

  const {
    data: onchainFollowing,
    isLoading: isFollowStateLoading,
    refetch: refetchOnchainFollowing,
  } = useReadContract({
    address: followerSystemAddress,
    abi: followerSystemAbi,
    functionName: 'isFollowing',
    args: [address, addr],
    chainId: activeChainId,
    query: { enabled: canReadFollowState },
  })

  // The count stays the cross-network aggregate from cidex; only the button is per-chain
  const [followerCount, setFollowerCount] = useState(0)
  // Set on click, cleared once the chain has been re-read after the tx settles or fails
  const [optimisticFollowing, setOptimisticFollowing] = useState(null)
  const isFollowingTarget = optimisticFollowing ?? Boolean(onchainFollowing)

  const refetchFollowerCount = () => {
    if (!addr) return
    fetch(`/api/v1/users/${addr}/followers`)
      .then((r) => r.json())
      .then((res) => res.success && setFollowerCount(res.meta.total))
      .catch(() => {})
  }

  useEffect(() => {
    refetchFollowerCount()
  }, [addr])

  useEffect(() => {
    if (!isConfirmed) return
    refetchOnchainFollowing().finally(() => setOptimisticFollowing(null))
  }, [isConfirmed])

  const follow = () => {
    if (!followerSystemAddress) {
      toast(`Follow system isn't deployed on this network yet`, `warning`)
      return
    }
    const wasFollowing = isFollowingTarget
    setOptimisticFollowing(!wasFollowing)
    setFollowerCount((prev) => Math.max(0, prev + (wasFollowing ? -1 : 1)))

    writeContract({
      address: followerSystemAddress,
      abi: followerSystemAbi,
      functionName: wasFollowing ? 'unfollow' : 'follow',
      args: [addr],
      chainId: activeChainId,
    })
  }

  useEffect(() => {
    const error = submitError || receiptError
    if (!error) return
    toast(error.shortMessage || error.message || 'Failed to update follow status', 'error')
    // Nothing changed onchain — drop the optimistic flip and put the count back
    setOptimisticFollowing(null)
    refetchFollowerCount()
  }, [submitError, receiptError])

  const handleDisconnect = async () => {
    if (walletKind === 'solana') await disconnectSolana()
    else disconnectEvm()
  }

  const editProfile = () => {
    setShowProfileModal(true)
  }

  const handleUniversalProfile = (e) => {
    const url = `https://universaleverything.io/${addr}`

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  // Isolated sub-rendering wrapper to manage variable text arrays cleanly
  const TagsElement = ({ rawTags }) => {
    let listItems = []
    try {
      if (rawTags) {
        const parsed = typeof rawTags === 'string' ? JSON.parse(rawTags) : rawTags
        if (Array.isArray(parsed)) {
          listItems = parsed
        }
      }
    } catch (err) {
      console.error('Failed parsing tag list matrix string:', err)
    }

    if (listItems.length === 0) {
      return (
        <>
          <small>#profile</small>
          <small>#hup</small>
          <small>#social</small>
        </>
      )
    }

    return (
      <>
        {listItems.map((tag, idx) => (
          <small key={`profile-tag-${idx}`}>#{tag}</small>
        ))}
      </>
    )
  }

  if (isLoading) return <ProfileSkeleton />

  const targetWallet = params?.wallet || addr || ''
  const displayWalletString = shortAddress(targetWallet)

  const explorerBaseUrl = activeChain?.[0]?.blockExplorers?.default?.url || 'https://etherscan.io'
  // A base58 wallet lives on Solana whatever chain the viewer is on; devnet until mainnet ships
  const walletExplorerUrl = isSolanaAddress(targetWallet)
    ? solanaExplorerUrl(SOLANA_DEVNET_ID, 'address', targetWallet)
    : `${explorerBaseUrl}/address/${targetWallet}`
  const birthdayLabel = formatBirthday(profile.birthday)
  const isCelebratingBirthday = isBirthdayToday(profile.birthday)
  const cover = coverFailed ? null : profile.profileHeader

  return (
    <>
      {showProfileModal && profile && (
        <ProfileModal
          getActiveChain={getActiveChain}
          profile={profile}
          isUP={profile.source === 'universal_profile'}
          setShowProfileModal={setShowProfileModal}
          mutate={mutate}
        />
      )}

      <FollowListDialog ref={followListDialogRef} addr={addr} />

      <section className={`${styles.profile} relative flex flex-column align-items-start justify-content-start gap-1`}>
        {isCelebratingBirthday && <BirthdayConfetti burst={birthdayBurstKey} />}

        {/* The cover — a Universal Profile's LSP3 backgroundImage, or the one set here. It runs
            the full width of the card, so it escapes the wrapper's own padding rather than
            sitting inside it; only a profile that has one gets the strip at all. */}
        {cover && (
          <div className={styles.profile__cover}>
            <img src={cover} alt="" onError={() => setCoverFailed(true)} />
          </div>
        )}

        <header className="flex flex-row align-items-center justify-content-between gap-050 w-100">
          <div className="flex-1 flex flex-column align-items-start justify-content-center gap-025">
            <div className={styles.profile__header}>
              <b className={styles.profile__name}>{profile.name ? profile.name : 'hup-user'}</b>

              {/* The worn tag, from the same component every post header uses, so one badge can
                  never look like two things — only its scale changes, so it holds its own beside a
                  display name. Verified server-side on each read — see lib/badge.js. */}
              <CommunityBadge badge={profile.badge} size="lg" />

              {/* Where the feed shows the glyph alone, the profile page has room for the word — the
                  one place a visitor is deciding whether to follow the account is the one place it
                  should not have to be inferred from an icon. */}
              <AgentBadge agent={profile.agent} size="lg" />
              {/* <img className={styles.profile__checkmark} alt="Checkmark" src={blueCheckMarkIcon.src || blueCheckMarkIcon} /> */}

              {profile.source === `universal_profile` && (
                <div className={styles.badge} onClick={handleUniversalProfile}>
                  <img alt={`Universal Profile`} src={UPlogo.src} width={14} height={14} />
                </div>
              )}
            </div>

            <code className={styles.profile__wallet}>
              <Link href={walletExplorerUrl} target="_blank" rel="noopener noreferrer">
                {displayWalletString}
              </Link>
            </code>

            {birthdayLabel &&
              (isCelebratingBirthday ? (
                <button
                  type="button"
                  className={clsx(styles.profile__birthday, styles['profile__birthday--today'])}
                  onClick={() => setBirthdayBurstKey((k) => k + 1)}
                  aria-label="Replay birthday celebration"
                >
                  <CakeIcon size={14} weight="fill" />
                  {`Birthday today · ${birthdayLabel}`}
                </button>
              ) : (
                <span className={styles.profile__birthday}>
                  <CakeIcon size={14} />
                  {birthdayLabel}
                </span>
              ))}

            {/* Where this wallet says it is from — a real country, or an onchain one. Resolved
                server-side into { emoji, label } so the chip never has to know which kind it got.
                A country arrives without one — Windows has no flag glyphs, so the flag emoji drew
                itself as the ISO letters beside the name — and the pin alone marks those. */}
            {profile.origin && (
              <span className={styles.profile__origin}>
                <MapPinIcon size={14} />
                {profile.origin.emoji && <span aria-hidden="true">{profile.origin.emoji}</span>}
                {profile.origin.label}
              </span>
            )}

            <p className={`${styles.profile__description} mt-20`}>{profile.description || 'This user has not set up a bio yet.'}</p>

            {/* Where the links used to sit behind a tab: one line under the bio, the rest in a modal */}
            <ProfileLinks links={profile.links} />

            <div className={`${styles.profile__tags} flex flex-row align-items-center flex-wrap gap-050`}>
              <TagsElement rawTags={profile.tags} />
            </div>
          </div>

          <div className={`${styles.profile__pfp} rounded relative`}>
            <UniversalIdentity
              displayName={profile.name}
              profileImageUrl={profile.profileImage}
              smartContractAddress={addr}
              profile={profile}
              selfView={selfView}
            />

            <Status addr={addr} profile={profile} selfView={selfView} />
          </div>
        </header>

        <footer className="w-100">
          <ul className="flex flex-column align-items-center justify-content-between gap-1 padding-left-0">
            <li className="flex flex-row align-items-center justify-content-between gap-025 w-100">
             
              <div className={clsx(styles.profile__stats, 'flex flex-row align-items-center justify-content-start gap-025')}>
                <button className={styles.btnFollowers} type="button" onClick={() => followListDialogRef.current?.open('followers')}>
                  <span>
                    {new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(followerCount)} followers
                  </span>
                </button>
                {viewCount !== null && (
                  <>
                    <span>·</span>
                    <button className={styles.btnFollowers} type="button">
                      <span>
                        {new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(viewCount + 1)} recent views
                      </span>
                    </button>
                  </>
                )}
              </div>

              <div className={clsx(`flex gap-025`)}>
                {profile.source === `universal_profile` && (
                  <div
                    className={clsx(styles.universalProfileBadge, 'flex align-items-center justify-content-center rounded-full gap-025')}
                    onClick={handleUniversalProfile}
                  >
                    <img alt={`Universal Profile`} src={UPlogo.src} width={14} height={14} />
                  </div>
                )}

                <ProfileQRCode profileUrl={`https://hup.social/${addr}`} styles={styles} />

                <a
                  className={styles.profile__llmsLink}
                  href={`/${addr}/llms.txt`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="This profile as plain text for AI agents"
                  aria-label="llms.txt"
                >
                  <RobotIcon size={14} />
                </a>
              </div>
            </li>

            <li className="w-100">
              <ProfileLink targetWallet={targetWallet} displayWalletString={displayWalletString} />
            </li>

            {isConnected && (
              <li className="w-100 grid grid--fit gap-1" style={{ '--data-width': '200px' }}>
                {address.toString().toLowerCase() === targetWallet.toString().toLowerCase() && (
                  <div className="flex gap-1 w-100">
                    <button className={`${styles.profile__btnFollow} flex-1`} type="button" onClick={editProfile}>
                      Edit profile
                    </button>
                    <button className={`${styles.profile__btnDisconnect} flex-1`} type="button" onClick={handleDisconnect}>
                      Disconnect
                    </button>
                  </div>
                )}
              </li>
            )}

            {isConnected && address.toString().toLowerCase() !== targetWallet.toString().toLowerCase() && (
              <li className="w-100 grid grid--fit gap-1" style={{ '--data-width': '200px' }}>
                <button
                  className={`${styles.profile__btnFollow} w-100`}
                  type="button"
                  onClick={follow}
                  disabled={isSigning || isConfirming || isFollowStateLoading}
                >
                  {isSigning ? 'Confirm Wallet...' : isConfirming ? 'Confirming...' : isFollowingTarget ? 'Unfollow' : 'Follow'}
                </button>
              </li>
            )}
          </ul>
        </footer>
      </section>
    </>
  )
}

const ProfileLink = ({ targetWallet, displayWalletString }) => {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast(`Profile link copied to clipboard.`, `success`)

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      timeoutRef.current = setTimeout(() => {
        setCopied(false)
      }, 2000)
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }

  return (
    <div className={styles.profileLink}>
      <span className={styles.profileLink__text}>hup.social/{displayWalletString}</span>

      <button
        type="button"
        className={styles.profileLink__copyButton}
        onClick={() => copyToClipboard(`https://hup.social/${targetWallet}`)}
        aria-label="Copy profile link to clipboard"
        title="Copy to clipboard"
      >
        {copied ? (
          <span className={styles.profileLink__status}>Copied!</span>
        ) : (
          <svg
            className={styles.profileLink__icon}
            viewBox="0 0 24 24"
            width="14"
            height="14"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </div>
  )
}
/**
 * Status
 * @param {*} param0
 * @returns
 */
const Status = ({ addr, profile, selfView }) => {
  const placeholders = [
    'Share a short status',
    "What's on your mind?",
    'Working on a new idea...',
    'The best thing I saw today was...',
    "What's the next big thing in Web3?",
    'Launching something new soon!',
    'Share one emoji that describes your day.',
    'I just learned something new about...',
    'How are you feeling in 3 emojis?',
    'A random memory that popped up today...',
    'What book/podcast should everyone check out?',
    'Best DAO right now?',
    'Next trend?',
    'Your biggest gain today?',
    'Share a mini dapp',
    'Bull or bear today?',
    'My last trade was...',
    'Watching [Coin Ticker]...',
    'Favorite yield farm?',
    'Best dating advice received?',
    'Tell us about your crush...',
    'What makes a perfect date?',
  ]
  const [panelOpened, setPanelOpened] = useState(false)
  const [status, setStatus] = useState()
  const [statusContent, setStatusContent] = useState('')
  // Duration in hours, matching HupStatus.updateStatus(_periodHours); 0 = permanent
  const [expirationTimestamp, setExpirationTimestamp] = useState(24)
  const [maxLength, setMaxLength] = useState()
  const { web3, contract } = initHupContract()
  const { chain: walletChain, isConnected } = useConnection()
  const [activeChain, setActiveChain] = useState(getActiveChain())
  const { contract: statusContract } = initStatusContract()
  const statusRef = useRef(``)
  const activeChainId = activeChain?.[0]?.id
  const statusAddress = activeChain?.[1]?.status

  // getActiveChain() resolves to the wallet's chain (or the stored selection when
  // disconnected), and NetworkSelect switches chains without remounting the profile —
  // so this must be re-read on every switch, otherwise the write below keeps targeting
  // the status contract of whichever chain was active when the profile first mounted.
  useEffect(() => {
    setActiveChain(getActiveChain())
  }, [walletChain?.id, isConnected, panelOpened])

  /* Error during submission (e.g., user rejected)  */
  const { data: hash, isPending: isSigning, error: submitError, mutate: writeContract } = useWriteContract()
  /* Error after mining (e.g., transaction reverted) */
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash,
  })

  /**
   * Selects a random placeholder phrase from the list.
   * @returns {string} The randomly selected placeholder text.
   */
  function getRandomPlaceholder() {
    // 1. Math.random() generates a floating point number between 0 (inclusive) and 1 (exclusive).
    // 2. We multiply it by the array's length to get a number between 0 and array.length.
    // 3. Math.floor() rounds this number down to the nearest whole integer, giving us a valid array index.
    const randomIndex = Math.floor(Math.random() * placeholders.length)
    return placeholders[randomIndex]
  }

  const clearStatus = () => {
    if (!statusAddress) {
      toast(`Status isn't available on ${activeChain?.[0]?.name ?? 'this network'}`, 'error')
      return
    }

    try {
      // chainId pins the tx to the chain the address belongs to — without it wagmi signs on
      // whatever chain the wallet happens to be on, against another chain's contract address.
      const result = writeContract({
        abi: statusAbi,
        address: statusAddress,
        chainId: activeChainId,
        functionName: 'clearStatus',
        args: [],
      })
      console.log('Transaction sent:', result)
    } catch (error) {
      console.error('Contract write failed:', error)
    }
  }

  const updateStatus = (e) => {
    if (!statusAddress) {
      toast(`Status isn't available on ${activeChain?.[0]?.name ?? 'this network'}`, 'error')
      return
    }

    if (!statusContent.trim()) {
      toast(`Write a status first`, 'error')
      return
    }

    writeContract({
      abi: statusAbi,
      address: statusAddress,
      chainId: activeChainId,
      functionName: 'updateStatus',
      args: [statusContent, 'public', '', Number(expirationTimestamp)],
    })
  }

  // const getStatus = async () => {
  //   // const result = await readContract(config, {
  //   //   statusAbi,
  //   //   address: process.env.NEXT_PUBLIC_CONTRACT_STATUS,
  //   //   functionName: 'notes',
  //   //   args: [`${addr}`],
  //   // })

  //   // return result

  //   statusContract
  // }

  // Both reads hit the status contract of the active chain, so they re-run on every switch
  // and once a write confirms.
  useEffect(() => {
    // Status lives on the EVM contracts; a Solana profile has none to read
    if (!isEvmAddress(addr)) return
    getStatus(addr).then((res) => {
      if (res?.error) {
        console.error('Failed to fetch status:', res.error)
        return
      }
      setStatus(res)
      // Only seed the editor from the profile being viewed when it is the viewer's own —
      // otherwise Update would copy someone else's status onto the viewer's.
      if (selfView) setStatusContent(res?.content ?? '')
    })

    getMaxLength().then((res) => {
      if (res?.error) {
        console.error('Failed to fetch max length:', res.error)
        return
      }
      setMaxLength(web3.utils.toNumber(res))
    })
  }, [addr, selfView, panelOpened, activeChainId, isConfirmed])

  useEffect(() => {
    const error = submitError || receiptError
    if (error) toast(error.shortMessage || error.message || 'Failed to update status', 'error')
  }, [submitError, receiptError])

  const handleToggle = useCallback((e) => setPanelOpened(e.newState === 'open'), [])

  const hasStatus = Boolean(status && status.content !== '')

  // Nothing to read and nothing to write: the editor behind this bubble always sets the
  // viewer own status, so on another profile an empty pill is a dead end. Status also only
  // lives on the EVM contracts, so a Solana profile never has one to show.
  if (!isEvmAddress(addr) || (!hasStatus && !selfView)) return null

  const expiresAt = hasStatus ? web3.utils.toNumber(status.expirationTimestamp) : 0
  const statusTitle = hasStatus
    ? `Updated ${moment.unix(web3.utils.toNumber(status.timestamp)).utc().fromNow()}${
        expiresAt > 0 ? ` - clears ${moment.unix(expiresAt).utc().fromNow()}` : ' - no expiry'
      }`
    : 'Share a short status'

  return (
    <NativePopover
      placement="center"
      className={styles.statusPopover}
      onToggle={handleToggle}
      trigger={
        <button className={clsx(styles.status, !hasStatus && styles['status--empty'], 'animate pointer')} title={statusTitle}>
          <p>{hasStatus ? status.content : 'Share a status'}</p>
        </button>
      }
    >
      {({ close }) => (
        <>
          <header className={styles.statusPopover__header}>
            <button type="button" aria-label="Close" onClick={close}>
              <svg fill="currentColor" height="16" role="img" viewBox="0 0 24 24" width="16">
                <title>Close</title>
                <line fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" x1="21" x2="3" y1="3" y2="21"></line>
                <line fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" x1="21" x2="3" y1="21" y2="3"></line>
              </svg>
            </button>
            <div className={`flex-1`}>
              <h3>Set your status</h3>
            </div>
            <div className={`pointer`} onClick={(e) => updateStatus(e)}>
              {isSigning ? `Signing...` : isConfirming ? 'Confirming...' : status && status.content !== '' ? `Update` : `Share`}
            </div>
          </header>

          <main className={`flex flex-column align-items-center gap-1 `}>
            <div className={`${styles.statusPopover__pfp} rounded relative`}>
              <figure className={`rounded`}>
                <Avatar src={profile.profileImage} size={64} />
              </figure>

              <div
                className={`d-f-c`}
                title={status && status.content !== '' && moment.unix(web3.utils.toNumber(status.timestamp)).utc().fromNow()}
              >
                <textarea
                  autoFocus
                  value={statusContent}
                  onChange={(e) => setStatusContent(e.target.value)}
                  placeholder={`${getRandomPlaceholder()}`}
                  maxLength={maxLength ? maxLength : 60}
                />
              </div>
            </div>

            <div className={`${styles.statusPopover__expirationTimestamp} relative`}>
              <label htmlFor="">Clear after </label>
              <select name="" id="" onChange={(e) => setExpirationTimestamp(e.target.value)}>
                <option value={24}>24h</option>
                <option value={8}>8h</option>
                <option value={6}>6h</option>
                <option value={4}>4h</option>
                <option value={1}>1h</option>
                <option value={0}>∞</option>
              </select>
            </div>

            {isConfirmed && <p className="text-center badge badge-success">Done</p>}

            <div title={`Expire: ${status && moment.unix(web3.utils.toNumber(status.expirationTimestamp)).utc().fromNow()}`}>
              {status && status.content !== '' && selfView && <button onClick={(e) => clearStatus(e)}>Delete status</button>}
            </div>

            <div className={`flex flex-row align-items-center gap-025`}>
              <InfoIcon />
              <small>Your status is viewable by all users.</small>
            </div>
          </main>
        </>
      )}
    </NativePopover>
  )
}

// Identity of a wearable badge: its deployment plus its id. Used for the React key and for
/* What a profile picture may weigh.
 *
 * Animated GIFs are the only avatars that come anywhere near it — the biggest one in our own
 * users table is 13.6MB — and they are the reason there is a ceiling at all rather than a
 * smaller one. Past 32MB the media cache stops holding an original, so every rung of the avatar
 * ladder re-downloads the whole picture on every cold instance; this sits above the real GIFs
 * and well below that cliff. */
const PLACEHOLDER_NAMES = new Set(['new-user', 'hup-user'])

const MAX_AVATAR_MB = 16
const MAX_AVATAR_BYTES = MAX_AVATAR_MB * 1024 * 1024

/* A cover is served at one width and never animated in a 26px circle, so the ceiling above buys
   it nothing — this is simply the largest photograph anyone sensibly uploads for a 1200px strip. */
const MAX_COVER_MB = 8
const MAX_COVER_BYTES = MAX_COVER_MB * 1024 * 1024

// "is this the selected one" — community ids are only unique within one deployment.
const badgeKey = (badge) => (badge ? `${badge.networkId}:${badge.contractAddress}:${badge.communityId}` : '')

/**
 * Profile Modal Component
 * @param {Object} props
 * @param {Object} props.profile - The profile data object.
 * @param {Function} props.setShowProfileModal - State setter to control modal visibility.
 * @param {Function} props.getActiveChain - Helper to get the current active blockchain network.
 * @returns {JSX.Element}
 */
const ProfileModal = ({ profile, setShowProfileModal, getActiveChain, mutate, isUP = false }) => {
  // Safe helper to parse the tag list from DB and strip away malformed or empty entries. Links
  // go through linksToRows instead: they arrive titled two different ways depending on whether
  // the profile came from our own row or from the LUKSO indexer.
  const parseSafeList = (data) => {
    try {
      if (!data || data === '[]') return []
      const parsed = typeof data === 'string' ? JSON.parse(data) : data
      if (!Array.isArray(parsed)) return []

      return parsed.filter((item) => typeof item === 'string' && item.trim() !== '')
    } catch (e) {
      // Handles completely malformed JSON syntax safely without crashing
      console.error('Failed to parse list from database profile data:', e)
      return []
    }
  }

  // State
  const [error, setError] = useState(null)
  const [isPending, setIsPending] = useState(false)
  const [tags, setTags] = useState({ list: parseSafeList(profile?.tags) })
  const [links, setLinks] = useState({ list: linksToRows(profile?.links) })
  // The community tag worn beside the name. `badgesLoaded` is not cosmetic: without it a failed
  // fetch would submit an empty picker as an explicit "wear nothing" and quietly strip a badge
  // the user never touched.
  const [badges, setBadges] = useState([])
  const [badgesLoaded, setBadgesLoaded] = useState(false)
  const [selectedBadge, setSelectedBadge] = useState(profile?.badge ?? null)
  // The country half of the origin picker, from the same table the save validates against. The
  // onchain half ships with the build, so the picker is usable the instant the modal opens and
  // this only fills in the rest.
  const [countries, setCountries] = useState([])
  /* The cover is state rather than a ref-poked <img> like the avatar beside it, because it has an
     empty state to render and a Remove button that has to change what is on screen. `coverCleared`
     is separate from `coverPreview` being null: only the former is an instruction to erase what is
     stored, and a profile that simply never had a cover must not send one. */
  const [coverPreview, setCoverPreview] = useState(profile?.profileHeader || null)
  const [coverCleared, setCoverCleared] = useState(false)
  /* A stored cover whose bytes have died draws the empty state, but it is still a cover as far as
     the save is concerned — a picture nobody can load is not the user asking for it to go. */
  const [coverBroken, setCoverBroken] = useState(false)
  const [editingLinkIndex, setEditingLinkIndex] = useState(null)
  const [activeChain, setActiveChain] = useState()
  const { address, isConnected } = useConnection()
  const luksoClient = usePublicClient({ chainId: lukso.id })
  /* `isUP` says only that the LUKSO indexer answered for this wallet, and it answers for nobody
     when it is unreachable or rate limiting us. The chain is asked separately, and it is the one
     that decides whether saving here also writes LSP3Profile. */
  const [isOnchainUP, setIsOnchainUP] = useState(false)
  const syncsOnchain = isUP || isOnchainUP

  // This modal only exists while it is open, so mounting is the right moment to ask. The list is
  // memberships that can actually become a badge — see api/v1/users/[address]/badges.
  useEffect(() => {
    if (!address) return
    let cancelled = false

    getUserBadges(address).then((list) => {
      if (cancelled) return
      setBadges(list)
      setBadgesLoaded(true)
    })

    return () => {
      cancelled = true
    }
  }, [address])

  // Countries change roughly never and the helper memoises the request, so reopening the editor
  // costs nothing. A failed load is survivable here in a way the badge picker's is not: the
  // select keeps an option for whatever origin is already set (see currentOrigin below), so
  // submitting an unloaded picker cannot silently erase it.
  useEffect(() => {
    let cancelled = false

    getCountries().then((list) => {
      if (!cancelled) setCountries(list)
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!address || !luksoClient) return
    let cancelled = false

    isUniversalProfile(luksoClient, address).then((confirmed) => {
      if (!cancelled) setIsOnchainUP(confirmed)
    })

    return () => {
      cancelled = true
    }
  }, [address, luksoClient])

  // Refs
  const pfpRef = useRef()
  const previewUrlRef = useRef(null)
  const coverInputRef = useRef(null)
  const coverUrlRef = useRef(null)
  const nameRef = useRef(null)
  const descriptionRef = useRef(null)
  const tagRef = useRef()
  const linkNameRef = useRef()
  const linkURLRef = useRef()

  /* Object URLs outlive the elements pointing at them, and a picked GIF avatar is the heaviest
     thing this modal ever holds — the blob stays in memory until it is handed back. */
  useEffect(
    () => () => {
      for (const held of [previewUrlRef, coverUrlRef]) {
        if (held.current) URL.revokeObjectURL(held.current)
      }
    },
    [],
  )

  /* Hup's row can be thinner than the profile onchain — one created while the LUKSO indexer was
     unreachable holds no name at all — and a form seeded from that alone would push blanks over a
     real name, tags and links the moment it was saved. So the onchain document fills whatever
     the row does not hold, and only that: anything already here is left alone, including a list
     the user has just emptied on purpose. */
  useEffect(() => {
    if (!syncsOnchain || !address || !luksoClient) return
    let cancelled = false

    readLsp3Profile(luksoClient, address).then((doc) => {
      if (cancelled || !doc) return

      setTags((current) => (current.list.length === 0 && Array.isArray(doc.tags) && doc.tags.length > 0 ? { list: doc.tags } : current))
      setLinks((current) => (current.list.length === 0 && linksToRows(doc.links).length > 0 ? { list: linksToRows(doc.links) } : current))

      for (const [ref, value] of [
        [nameRef, doc.name],
        [descriptionRef, doc.description],
      ]) {
        const input = ref.current
        if (!input || !value) continue

        const held = input.value.trim()
        if (held === '' || PLACEHOLDER_NAMES.has(held)) input.value = value
      }
    })

    return () => {
      cancelled = true
    }
  }, [syncsOnchain, address, luksoClient])

  // Handlers
  // The badge field as the API expects it; null when the picker never loaded, which it reads as
  // "leave the badge alone".
  const badgeField = () => {
    if (!badgesLoaded) return null

    return selectedBadge
      ? JSON.stringify({
          networkId: selectedBadge.networkId,
          contractAddress: selectedBadge.contractAddress,
          communityId: selectedBadge.communityId,
        })
      : ''
  }

  /* Pushes what Hup already holds out to the Universal Profile. Reachable when an earlier save
     stored the profile here but never made it onchain — a declined signature, a wallet on the
     wrong network, LUKSO unreachable at the time. */
  const syncOnchain = () => {
    setShowProfileModal(false)
    syncProfileToUniversalProfile({
      address,
      fields: {
        name: String(profile?.name ?? '').trim(),
        description: String(profile?.description ?? '').trim(),
        tags: parseSafeList(profile?.tags),
        links: linksToRows(profile?.links),
        imageUri: profile?.profileImageRef ?? null,
        /* A cover removed here but never pushed onchain — the one case where having nothing to
           send IS the thing to send. */
        backgroundUri: profile?.profileHeaderRef ?? null,
        removeBackground: Boolean(profile?.coverRemoved),
      },
      mutate,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!isConnected) return

    setIsPending(true)
    setError(null)

    const formData = new FormData(e.target)
    const file = formData.get('profileImage')
    const hasNewImage = file instanceof File && file.size > 0

    /* Pinned before the save rather than after it, because both halves need the same reference:
       the row stores it, and the onchain document has to carry it too. */
    let imageUri = null
    let imageSize = null
    if (hasNewImage) {
      if (file.size > MAX_AVATAR_BYTES) {
        setError(`That picture is too large. Profile pictures have to be ${MAX_AVATAR_MB}MB or smaller.`)
        setIsPending(false)
        return
      }

      try {
        toast('Uploading image ...', 'info')
        // Dimensions are read from the file itself; the LSP3 image entry has to declare them
        const [uploaded, size] = await Promise.all([uploadFileToIPFS(file), readImageSize(file)])

        if (!uploaded) {
          throw new Error('Failed to upload')
        }

        imageUri = normalizeIpfsUri(uploaded)
        imageSize = size
      } catch (uploadErr) {
        console.error('Profile image upload error:', uploadErr)
        setError(uploadErr.message || 'Failed to upload image to decentralized storage.')
        setIsPending(false)
        return
      }
    }

    // The cover, pinned on the same terms and for the same two readers as the picture above
    const coverFile = formData.get('profileHeader')
    const hasNewCover = coverFile instanceof File && coverFile.size > 0

    let coverUri = null
    let coverSize = null
    if (hasNewCover) {
      if (coverFile.size > MAX_COVER_BYTES) {
        setError(`That cover is too large. Cover images have to be ${MAX_COVER_MB}MB or smaller.`)
        setIsPending(false)
        return
      }

      try {
        toast('Uploading cover ...', 'info')
        const [uploaded, size] = await Promise.all([uploadFileToIPFS(coverFile), readImageSize(coverFile)])

        if (!uploaded) {
          throw new Error('Failed to upload')
        }

        coverUri = normalizeIpfsUri(uploaded)
        coverSize = size
      } catch (uploadErr) {
        console.error('Profile cover upload error:', uploadErr)
        setError(uploadErr.message || 'Failed to upload the cover to decentralized storage.')
        setIsPending(false)
        return
      }
    }

    /* An untouched file input still sends an empty File, which must never overwrite the stored
       picture — the API keeps what it has when this arrives empty. */
    formData.set('profileImage', imageUri ?? formData.get('profileImage_hidden') ?? '')
    /* Same rule for the cover, which is why removing one has to be said in a field of its own
       rather than by sending nothing. */
    formData.set('profileHeader', coverUri ?? '')
    const removesCover = !coverUri && coverCleared
    formData.set('removeProfileHeader', removesCover ? '1' : '')
    formData.set('tags', JSON.stringify(tags.list))
    formData.set('links', JSON.stringify(links.list))

    const badge = badgeField()
    if (badge !== null) formData.set('badge', badge)

    /* Awaited rather than read off state, so a save made moments after the modal opened still
       syncs. The check is memoised, so it costs nothing once it has answered. */
    const writesOnchain = syncsOnchain || (await isUniversalProfile(luksoClient, address))

    /* Hup is where every save lands first, a Universal Profile's included. The stamp records the
       indexer state this row now overtakes, so the profile reads back as what was just typed
       instead of what LUKSO still says — see cidex/scripts/add-profile-sync-stamp.sql. */
    if (writesOnchain) formData.set('syncStamp', String(profile?.lastMetadataUpdate ?? ''))

    let saved
    try {
      saved = await updateProfile(formData, address)
    } catch (err) {
      console.error(err)
      setError('An unexpected error occurred')
      setIsPending(false)
      return
    }

    if (!saved.success) {
      setError(saved.error || 'Failed to update profile')
      setIsPending(false)
      return
    }

    mutate()
    setShowProfileModal(false)

    if (writesOnchain) {
      /* Owns its own toast from here: pinning the document, the signature and the receipt all
         outlive this modal, and the save above stands whatever the chain decides. */
      syncProfileToUniversalProfile({
        address,
        fields: {
          name: String(formData.get('name') ?? '').trim(),
          description: String(formData.get('description') ?? '').trim(),
          tags: tags.list,
          links: links.list,
          imageUri,
          imageSize,
          backgroundUri: coverUri,
          backgroundSize: coverSize,
          removeBackground: removesCover,
        },
        mutate,
      })
      return
    }

    toast(`Your profile has been updated.`, 'success')
  }

  const showPFP = (e) => {
    const file = e.target.files[0]
    if (!file) return

    /* Caught here as well as on submit, so a picture that cannot be used is refused while the
       file picker is still the thing the user is thinking about. */
    if (file.size > MAX_AVATAR_BYTES) {
      setError(`That picture is too large. Profile pictures have to be ${MAX_AVATAR_MB}MB or smaller.`)
      e.target.value = ''
      return
    }

    setError(null)

    /* An object URL rather than a FileReader data URL. Animated GIFs are the heaviest avatars
       anyone uploads, and base64 puts a third more than the file's own weight into the DOM as a
       string — on a 13MB GIF that is an 18MB attribute for a 96px circle. This also plays: a
       data URL animates too, but only after the whole thing has been read and re-encoded. */
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = URL.createObjectURL(file)
    pfpRef.current.src = previewUrlRef.current
  }

  const showCover = (e) => {
    const file = e.target.files[0]
    if (!file) return

    if (file.size > MAX_COVER_BYTES) {
      setError(`That cover is too large. Cover images have to be ${MAX_COVER_MB}MB or smaller.`)
      e.target.value = ''
      return
    }

    setError(null)

    if (coverUrlRef.current) URL.revokeObjectURL(coverUrlRef.current)
    coverUrlRef.current = URL.createObjectURL(file)
    setCoverPreview(coverUrlRef.current)
    // Picking a replacement is not a removal, however the empty state was reached
    setCoverCleared(false)
    setCoverBroken(false)
  }

  /* Emptying the file input is what makes this a removal rather than a re-upload of whatever was
     picked a moment ago — the submit reads the input, not the preview. */
  const removeCover = () => {
    if (coverUrlRef.current) {
      URL.revokeObjectURL(coverUrlRef.current)
      coverUrlRef.current = null
    }
    if (coverInputRef.current) coverInputRef.current.value = ''
    setCoverPreview(null)
    setCoverCleared(true)
    setCoverBroken(false)
  }

  const addTag = (e) => {
    const newTag = tagRef.current.value.trim()
    if (newTag === '') return

    const isRedundant = tags.list.some((tag) => tag.toLowerCase() === newTag.toLowerCase())
    if (!isRedundant) {
      setTags({ list: [...tags.list, newTag] })
    }
    tagRef.current.value = ''
  }

  const removeTag = (e, tagToRemove) => {
    setTags({ list: tags.list.filter((tag) => tag !== tagToRemove) })
  }

  const addLink = (e) => {
    const newLinkName = linkNameRef.current.value.trim()
    const newLinkURL = linkURLRef.current.value.trim()
    if (newLinkName === '' || newLinkURL === '') return

    // The row currently under edit is exempt from the duplicate-name check
    const isRedundant = links.list.some((link, i) => i !== editingLinkIndex && link.name.toLowerCase() === newLinkName.toLowerCase())
    if (!isRedundant) {
      if (editingLinkIndex !== null) {
        setLinks({
          list: links.list.map((link, i) => (i === editingLinkIndex ? { name: newLinkName, url: newLinkURL } : link)),
        })
      } else {
        setLinks({ list: [...links.list, { name: newLinkName, url: newLinkURL }] })
      }
    }
    setEditingLinkIndex(null)
    linkNameRef.current.value = ''
    linkURLRef.current.value = ''
  }

  const startEditLink = (e, index) => {
    const link = links.list[index]
    linkNameRef.current.value = link.name
    linkURLRef.current.value = link.url
    setEditingLinkIndex(index)
    linkNameRef.current.focus()
  }

  const cancelEditLink = () => {
    setEditingLinkIndex(null)
    linkNameRef.current.value = ''
    linkURLRef.current.value = ''
  }

  const removeLink = (e, indexToRemove) => {
    setLinks({ list: links.list.filter((_, i) => i !== indexToRemove) })
    if (editingLinkIndex !== null) {
      if (indexToRemove === editingLinkIndex) {
        cancelEditLink()
      } else if (indexToRemove < editingLinkIndex) {
        setEditingLinkIndex(editingLinkIndex - 1)
      }
    }
  }

  // Effects
  // The preview URL is only alive while this modal is
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    },
    [],
  )

  useEffect(() => {
    if (typeof getActiveChain === 'function') {
      setActiveChain(getActiveChain())
    }
  }, [getActiveChain])

  // A <select> can only submit a value it holds an option for. Until the country list lands — or
  // if the request failed outright — the saved country has no option, the select falls back to
  // its first one, and saving anything else on the form would quietly wipe it. Carrying the saved
  // country as its own option closes that door; onchain origins ship with the build and are
  // always present already.
  const coverArt = Boolean(coverPreview) && !coverBroken

  const savedOrigin = profile?.origin ?? null
  const savedCountryMissing =
    Boolean(savedOrigin) && isCountryCode(savedOrigin.code) && !countries.some((country) => country.iso_code === savedOrigin.code)

  return (
    <div className={`${styles.profileModal} animate fade`} onMouseDown={() => setShowProfileModal(false)}>
      <div className={styles.profileModal__card} onMouseDown={(e) => e.stopPropagation()}>
        <header className={styles.profileModal__header}>
          <button type="button" className={styles.profileModal__closeBtn} aria-label="Close" onClick={() => setShowProfileModal(false)}>
            <svg
              fill="none"
              height="16"
              width="16"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <h3 className={styles.profileModal__title}>Edit Profile</h3>
          <div className={styles.profileModal__headerSpacer} />
        </header>

        <form className={styles.profileModal__form} onSubmit={handleSubmit} encType="multipart/form-data">
          <main className={styles.profileModal__body}>
            {syncsOnchain && (
              <p className={styles.profileModal__upHint}>
                Changes save to Hup straight away, then sync to your{' '}
                <a href={`https://universaleverything.io/${profile?.wallet_address}`} target="_blank" rel="noopener noreferrer">
                  Universal Profile
                </a>{' '}
                onchain — your wallet asks you to sign that part. Birthday and origin stay on Hup.
              </p>
            )}

            {/* An earlier save that never reached the chain: the profile here is right, the
                Universal Profile behind it is still the old one. */}
            {profile?.syncPending && (
              <div className={styles.profileModal__syncNotice}>
                <span>Saved on Hup, not yet on your Universal Profile.</span>
                <button type="button" className={styles.profileModal__syncBtn} onClick={syncOnchain}>
                  Sync
                </button>
              </div>
            )}

            {/* Cover — first here because it is first on the profile. A Universal Profile's is
                the LSP3 backgroundImage; everyone else's is Hup's own. */}
            <div className={styles.profileModal__coverWrap}>
              <label htmlFor="pm-profileHeader" className={styles.profileModal__coverLabel}>
                <figure className={clsx(styles.profileModal__cover, !coverArt && styles['profileModal__cover--empty'])}>
                  {coverArt ? (
                    <img src={coverPreview} alt="Cover preview" onError={() => setCoverBroken(true)} />
                  ) : (
                    <span className={styles.profileModal__coverEmpty}>
                      <ImageIcon size={20} />
                      Add a cover
                    </span>
                  )}
                  <div className={styles.profileModal__coverOverlay}>
                    <CameraIcon size={20} />
                  </div>
                </figure>
              </label>
              <input
                ref={coverInputRef}
                id="pm-profileHeader"
                type="file"
                name="profileHeader"
                accept="image/*"
                onChange={showCover}
                className={styles.profileModal__fileInput}
              />
              <div className={styles.profileModal__coverActions}>
                <small className={styles.profileModal__avatarHint}>Runs across the top of your profile</small>
                {coverPreview && (
                  <button type="button" className={styles.profileModal__coverRemove} onClick={removeCover}>
                    Remove
                  </button>
                )}
              </div>
            </div>

            {/* Avatar */}
            <div className={styles.profileModal__avatarWrap}>
              <label htmlFor="pm-profileImage" className={styles.profileModal__avatarLabel}>
                <figure className={styles.profileModal__avatar}>
                  {/* Stays a bare img rather than an Avatar: showPFP points this node straight at an
                      object URL for the picked file, and a controlled component would put the
                      saved picture back on its next render */}
                  <img ref={pfpRef} src={profile?.profileImage} alt="Profile preview" onError={handleBrokenAvatar} />
                  <div className={styles.profileModal__avatarOverlay}>
                    <svg fill="none" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </div>
                </figure>
              </label>
              <input
                id="pm-profileImage"
                type="file"
                name="profileImage"
                accept="image/*"
                onChange={showPFP}
                className={styles.profileModal__fileInput}
              />
              <input type="hidden" name="profileImage_hidden" defaultValue={profile?.profileImageName} />
              <small className={styles.profileModal__avatarHint}>Tap to change photo</small>
            </div>

            {/* Name */}
            <div className={styles.profileModal__field}>
              <label className={styles.profileModal__label}>Name</label>
              <input
                ref={nameRef}
                className={styles.profileModal__input}
                type="text"
                name="name"
                defaultValue={PLACEHOLDER_NAMES.has(profile?.name) ? '' : profile?.name}
                placeholder="Your name"
              />
            </div>

            {/* Bio */}
            <div className={styles.profileModal__field}>
              <label className={styles.profileModal__label}>Bio</label>
              <textarea
                ref={descriptionRef}
                className={styles.profileModal__textarea}
                name="description"
                defaultValue={profile?.description}
                placeholder="Tell us about yourself..."
                rows={3}
              />
            </div>

            {/* Birthday */}
            <div className={styles.profileModal__field}>
              <label className={styles.profileModal__label}>Birthday</label>
              <input
                className={styles.profileModal__input}
                type="date"
                name="birthday"
                defaultValue={profile?.birthday || ''}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>

            {/* From — Hup-native like the birthday above it, so a Universal Profile sets it here
                too. Country-level and no finer: a post is permanent, and this is the one thing on
                a profile that could tie a pseudonym to a place, so it stays coarse, opt-in and
                erasable. The onchain origins sit on top for everyone whose honest answer is a
                chain rather than a country. */}
            <div className={styles.profileModal__field}>
              <label className={styles.profileModal__label} htmlFor="pm-origin">
                From
              </label>
              <select id="pm-origin" name="origin" className={styles.profileModal__select} defaultValue={savedOrigin?.code || ''}>
                <option value="">Not shown</option>
                <optgroup label="Onchain">
                  {ORIGIN_OPTIONS.map((option) => (
                    <option key={option.slug} value={option.slug}>
                      {`${option.emoji} ${option.label}`}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Countries">
                  {savedCountryMissing && (
                    <option value={savedOrigin.code}>{savedOrigin.label}</option>
                  )}
                  {countries.map((country) => (
                    <option key={country.iso_code} value={country.iso_code}>
                      {country.name}
                    </option>
                  ))}
                </optgroup>
              </select>
              <small className={styles.profileModal__badgeHint}>Shown next to your name on your profile. Leave it unset to keep it to yourself.</small>
            </div>

            {/* Community tag — only offered when the wallet actually belongs somewhere that grants one */}
            {badges.length > 0 && (
              <div className={styles.profileModal__field}>
                <label className={styles.profileModal__label}>Community tag</label>
                <div className={styles.profileModal__chips}>
                  <button
                    type="button"
                    className={clsx(styles.profileModal__badge, !selectedBadge && styles['profileModal__badge--selected'])}
                    onClick={() => setSelectedBadge(null)}
                  >
                    None
                  </button>
                  {badges.map((badge) => (
                    <button
                      key={badgeKey(badge)}
                      type="button"
                      className={clsx(
                        styles.profileModal__badge,
                        badgeKey(selectedBadge) === badgeKey(badge) && styles['profileModal__badge--selected'],
                      )}
                      onClick={() => setSelectedBadge(badge)}
                      title={`Member of ${badge.communityName}`}
                    >
                      {badge.logoUrl && <img src={badge.logoUrl} alt="" width={12} height={12} />}
                      {badge.tag}
                    </button>
                  ))}
                </div>
                <small className={styles.profileModal__badgeHint}>
                  Worn next to your name. It comes off by itself if you leave the community.
                </small>
              </div>
            )}

            {/* Tags */}
            <div className={styles.profileModal__field}>
              <label className={styles.profileModal__label}>Tags</label>
              {tags.list.length > 0 && (
                <div className={styles.profileModal__chips}>
                  {tags.list.map((tag, i) => (
                    <span key={`tag-${i}`} className={styles.profileModal__chip}>
                      #{tag}
                      <button type="button" onClick={(e) => removeTag(e, tag)} aria-label={`Remove ${tag}`}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className={styles.profileModal__addRow}>
                <input
                  ref={tagRef}
                  type="text"
                  placeholder="Add a tag…"
                  className={styles.profileModal__input}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addTag()
                    }
                  }}
                />
                <button type="button" onClick={addTag} className={styles.profileModal__addBtn}>
                  Add
                </button>
              </div>
            </div>

            {/* Links */}
            <div className={styles.profileModal__field}>
              <label className={styles.profileModal__label}>Links</label>
              {links.list.length > 0 && (
                <div className={styles.profileModal__linkList}>
                  {links.list.map((link, i) => (
                    <div
                      key={`link-${i}`}
                      className={clsx(styles.profileModal__linkItem, i === editingLinkIndex && styles['profileModal__linkItem--editing'])}
                    >
                      <div className={styles.profileModal__linkInfo}>
                        <span className={styles.profileModal__linkName}>{link.name}</span>
                        <span className={styles.profileModal__linkUrl}>{link.url}</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => startEditLink(e, i)}
                        aria-label={`Edit ${link.name}`}
                        className={styles.profileModal__linkEdit}
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => removeLink(e, i)}
                        aria-label={`Remove ${link.name}`}
                        className={styles.profileModal__linkRemove}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className={styles.profileModal__addRow}>
                <input ref={linkNameRef} type="text" placeholder="Label" className={styles.profileModal__input} />
                <input ref={linkURLRef} type="text" placeholder="https://…" className={styles.profileModal__input} />
                <button type="button" onClick={addLink} className={styles.profileModal__addBtn}>
                  {editingLinkIndex !== null ? 'Update' : 'Add'}
                </button>
                {editingLinkIndex !== null && (
                  <button
                    type="button"
                    onClick={cancelEditLink}
                    className={clsx(styles.profileModal__addBtn, styles['profileModal__addBtn--ghost'])}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {error && <p className={styles.profileModal__error}>{error}</p>}
          </main>

          <footer className={styles.profileModal__footer}>
            <button type="submit" className={styles.profileModal__submitBtn} disabled={isPending}>
              {isPending ? 'Saving…' : 'Save changes'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
