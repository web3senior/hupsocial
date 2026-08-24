'use client'

import Link from 'next/link'
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
import { useBalance, useWaitForTransactionReceipt, useConnection, useDisconnect, useWriteContract } from 'wagmi'
import followerSystemAbi from '@/abis/LSP26FollowerSystem'
import moment from 'moment'
import { InfoIcon, ThreeDotIcon } from '@/components/Icons'
import ProfileInsights from '@/components/ProfileInsights'
import UPlogo from '@/../public/up.png'
import { is0GHash, isIPFSHash, resolve0GUrl, resolveIPFSUrl } from '@/lib/storageHelper'
import { uploadFileToIPFS } from '@/lib/ipfs'
import { rememberCardPointerDown, isTextSelectionDrag } from '@/lib/cardClick'
import LinksTab from '@/components/tabs/LinksTab'
import AssetsTab from '@/components/tabs/AssetsTab'
import UniversalIdentity from '@/components/ui/UniversalIdentity/UniversalIdentity'
import { useProfile } from '@/hooks/useProfile'
import { handleBrokenAvatar } from '@/lib/utils'
import clsx from 'clsx'
import NativePopover from '@/components/ui/NativePopover'
import { ProfileQRCode } from './ProfileQRCode'
import FollowListDialog from './FollowListDialog'
import BirthdayConfetti from '@/components/ui/BirthdayConfetti'
import { CakeIcon, MapPinIcon } from '@phosphor-icons/react'
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
  const { address, isConnected } = useConnection()
  const { web3, contract } = initHupContract()
  const activeChain = getActiveChain()
  const balance = useBalance({
    address: address,
  })

  const postsFeed = useProfileFeed({ wallet: params.wallet, viewer: address, postType: 'original' })
  const repostsFeed = useProfileFeed({ wallet: params.wallet, viewer: address, postType: 'repost' })

  const TABS_DATA = [
    { id: 'posts', label: 'Posts', count: postsFeed.total },
    { id: 'assets', label: 'Assets' },
    { id: 'reposts', label: 'Reposts', count: repostsFeed.total },
    { id: 'links', label: 'Links' },
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

          {activeTab === 'links' && (
            <div className={`${styles.tabContent} ${styles.links} relative`}>
              <LinksTab />
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
  const [resolved0gUrl, setResolved0gUrl] = useState(null)
  const [viewCount, setViewCount] = useState(null)
  const [birthdayBurstKey, setBirthdayBurstKey] = useState(0) // bumped to replay the confetti burst on tap
  const followListDialogRef = useRef(null)

  const params = useParams()
  const { address, isConnected } = useConnection()
  const { disconnect } = useDisconnect()
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

  // LSP26-compatible follow/unfollow. followerSystem is deployed identically on every chain, so
  // follower count / isFollowing are read from cidex's cross-network aggregate (the `follows`
  // table) rather than a live on-chain read — a direct read would only ever reflect whichever
  // chain the *viewer's* wallet happens to be connected to, not a true cross-chain total.
  // followerSystem itself is still only used for the actual follow()/unfollow() transaction,
  // which always targets whatever chain the wallet is currently on.
  const followerSystemAddress = activeChain?.[1]?.followerSystem

  const [followerCount, setFollowerCount] = useState(0)
  const [isFollowingTarget, setIsFollowingTarget] = useState(false)

  const refetchFollowStats = () => {
    if (!addr) return
    const qs = address ? `?viewer_address=${address}` : ''
    fetch(`/api/v1/users/${addr}/followers${qs}`)
      .then((r) => r.json())
      .then((res) => {
        if (!res.success) return
        setFollowerCount(res.meta.total)
        if (res.isFollowing !== null) setIsFollowingTarget(Boolean(res.isFollowing))
      })
      .catch(() => {})
  }

  useEffect(() => {
    refetchFollowStats()
  }, [addr, address])

  // cidex needs a few seconds to catch the event, so the confirmed-tx refetch below is a
  // reconciliation pass — the follow() handler already updates isFollowingTarget/followerCount
  // optimistically for instant feedback.
  useEffect(() => {
    if (isConfirmed) refetchFollowStats()
  }, [isConfirmed])

  const follow = () => {
    if (!followerSystemAddress) {
      toast(`Follow system isn't deployed on this network yet`, `warning`)
      return
    }
    const wasFollowing = isFollowingTarget
    setIsFollowingTarget(!wasFollowing)
    setFollowerCount((prev) => Math.max(0, prev + (wasFollowing ? -1 : 1)))

    writeContract({
      address: followerSystemAddress,
      abi: followerSystemAbi,
      functionName: wasFollowing ? 'unfollow' : 'follow',
      args: [addr],
    })
  }

  useEffect(() => {
    const error = submitError || receiptError
    if (!error) return
    toast(error.shortMessage || error.message || 'Failed to update follow status', 'error')
    // The optimistic flip in follow() didn't happen — revert it now that the tx actually failed.
    refetchFollowStats()
  }, [submitError, receiptError])

  const handleDisconnect = async () => {
    disconnect()
  }

  // UP-sourced profiles are managed on universaleverything.io, but birthday is a
  // Hup-native field — so the modal still opens for them, in birthday-only mode.
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
  const displayWalletString = targetWallet.length >= 42 ? `${targetWallet.slice(0, 6)}…${targetWallet.slice(-4)}` : targetWallet

  const explorerBaseUrl = activeChain?.[0]?.blockExplorers?.default?.url || 'https://etherscan.io'
  const birthdayLabel = formatBirthday(profile.birthday)
  const isCelebratingBirthday = isBirthdayToday(profile.birthday)

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

        <header className="flex flex-row align-items-center justify-content-between gap-050 w-100">
          <div className="flex-1 flex flex-column align-items-start justify-content-center gap-025">
            <div className={styles.profile__header}>
              <b className={styles.profile__name}>{profile.name ? profile.name : 'hup-user'}</b>

              {/* The worn tag, from the same component every post header uses, so one badge can
                  never look like two things — only its scale changes, so it holds its own beside a
                  display name. Verified server-side on each read — see lib/badge.js. */}
              <CommunityBadge badge={profile.badge} size="lg" />
              {/* <img className={styles.profile__checkmark} alt="Checkmark" src={blueCheckMarkIcon.src || blueCheckMarkIcon} /> */}

              {profile.source === `universal_profile` && (
                <div className={styles.badge} onClick={handleUniversalProfile}>
                  <img alt={`Universal Profile`} src={UPlogo.src} width={14} height={14} />
                </div>
              )}
            </div>

            <code className={styles.profile__wallet}>
              <Link href={`${explorerBaseUrl}/address/${targetWallet}`} target="_blank" rel="noopener noreferrer">
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
                  disabled={isSigning || isConfirming}
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
  return (
    <NativePopover
      placement="center"
      className={styles.statusPopover}
      onToggle={handleToggle}
      trigger={
        <button className={`${styles.status} animate pointer`}>
          {status && (
            <p
              title={`Updated at ${moment.unix(web3.utils.toNumber(status.timestamp)).utc().fromNow()} - Expiration ${moment
                .unix(web3.utils.toNumber(status.expirationTimestamp))
                .utc()
                .fromNow()}`}
            >
              {status.content !== '' ? <>{status.content}</> : <> Status...</>}
            </p>
          )}
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
                <img src={`${profile.profileImage}`} alt="" onError={handleBrokenAvatar} />
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
  // Safe helper to parse structural lists from DB and strip away malformed or empty data structures
  const parseSafeList = (data, isLinkList = false) => {
    try {
      if (!data || data === '[]') return []
      const parsed = typeof data === 'string' ? JSON.parse(data) : data
      if (!Array.isArray(parsed)) return []

      // Clean out corrupt or empty structural entries like [{""}] or empty keys
      return parsed.filter((item) => {
        if (!item) return false
        if (isLinkList) {
          return typeof item === 'object' && item.name && item.name.trim() !== ''
        }
        return typeof item === 'string' && item.trim() !== ''
      })
    } catch (e) {
      // Handles completely malformed JSON syntax safely without crashing
      console.error('Failed to parse list from database profile data:', e)
      return []
    }
  }

  // State
  const [error, setError] = useState(null)
  const [isPending, setIsPending] = useState(false)
  const [tags, setTags] = useState({ list: parseSafeList(profile?.tags, false) })
  const [links, setLinks] = useState({ list: parseSafeList(profile?.links, true) })
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
  const [editingLinkIndex, setEditingLinkIndex] = useState(null)
  const [activeChain, setActiveChain] = useState()
  const { address, isConnected } = useConnection()

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

  // Refs
  const pfpRef = useRef()
  const tagRef = useRef()
  const linkNameRef = useRef()
  const linkURLRef = useRef()

  // Handlers
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!isConnected) return

    setIsPending(true)
    setError(null)

    const formData = new FormData(e.target)

    // UP-sourced profiles only edit Hup-native fields here (birthday); name, bio,
    // image, tags and links stay managed by the Universal Profile itself.
    if (!isUP) {
      const fileInput = formData.get('profileImage')

      // Fallback to existing image name/hash
      let profileImageHash = formData.get('profileImage_hidden')

      // Check if the user actually picked a new file
      if (fileInput && fileInput.size > 0) {
        try {
          toast('Uploading image ...', 'info')
          const rootHash = await uploadFileToIPFS(fileInput)

          if (!rootHash) {
            throw new Error('Failed to upload')
          }

          profileImageHash = rootHash
        } catch (uploadErr) {
          console.error('0G Storage Error:', uploadErr)
          setError(uploadErr.message || 'Failed to upload image to decentralized storage.')
          setIsPending(false)
          return
        }
      }

      // Explicitly overwrite or append the finalized values to the FormData instance
      formData.set('profileImage', profileImageHash)
      formData.set('tags', JSON.stringify(tags.list))
      formData.set('links', JSON.stringify(links.list))
    }

    // Hup-native, like birthday, so it is sent for Universal Profiles too — a UP has no notion of
    // Hup community membership. Omitted entirely when the picker never loaded, which the API
    // reads as "leave the badge alone".
    if (badgesLoaded) {
      formData.set(
        'badge',
        selectedBadge
          ? JSON.stringify({
              networkId: selectedBadge.networkId,
              contractAddress: selectedBadge.contractAddress,
              communityId: selectedBadge.communityId,
            })
          : '',
      )
    }

    try {
      const res = await updateProfile(formData, address)
      if (res.success) {
        toast(`Your profile has been updated.`, 'success')
        mutate()
        setShowProfileModal(false)
      } else {
        setError(res.error || 'Failed to update profile')
      }
    } catch (err) {
      console.error(err)
      setError('An unexpected error occurred')
    } finally {
      setIsPending(false)
    }
  }

  const showPFP = (e) => {
    const preview = pfpRef.current
    const file = e.target.files[0]
    const reader = new FileReader()

    reader.addEventListener('load', () => {
      preview.src = reader.result
    })

    if (file) {
      reader.readAsDataURL(file)
    }
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
          <h3 className={styles.profileModal__title}>{isUP ? 'Edit Birthday' : 'Edit Profile'}</h3>
          <div className={styles.profileModal__headerSpacer} />
        </header>

        <form className={styles.profileModal__form} onSubmit={handleSubmit} encType="multipart/form-data">
          <main className={styles.profileModal__body}>
            {isUP && (
              <p className={styles.profileModal__upHint}>
                Your name, bio, image and links are managed by your{' '}
                <a href={`https://universaleverything.io/${profile?.wallet_address}`} target="_blank" rel="noopener noreferrer">
                  Universal Profile
                </a>
                . Your birthday is stored on Hup.
              </p>
            )}

            {!isUP && (
              <>
                {/* Avatar */}
                <div className={styles.profileModal__avatarWrap}>
                  <label htmlFor="pm-profileImage" className={styles.profileModal__avatarLabel}>
                    <figure className={styles.profileModal__avatar}>
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
                    className={styles.profileModal__input}
                    type="text"
                    name="name"
                    defaultValue={profile?.name}
                    placeholder="Your name"
                  />
                </div>

                {/* Bio */}
                <div className={styles.profileModal__field}>
                  <label className={styles.profileModal__label}>Bio</label>
                  <textarea
                    className={styles.profileModal__textarea}
                    name="description"
                    defaultValue={profile?.description}
                    placeholder="Tell us about yourself..."
                    rows={3}
                  />
                </div>
              </>
            )}

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

            {!isUP && (
              <>
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
              </>
            )}

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
