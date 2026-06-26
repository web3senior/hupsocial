'use client'

import Link from 'next/link'
import { useEffect, useState, lazy, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { updateProfile, subscribeUser, unsubscribeUser, sendNotification, getPosts, recordProfileView } from '@/lib/api'
import { initHupContract, initStatusContract, getStatus, getMaxLength, getPostsByCreator } from '@/lib/communication'
import { toast } from '@/components/NextToast'
import blueCheckMarkIcon from '@/../public/icons/blue-checkmark.svg'
import statusAbi from '@/abi/status.json'
import { useClientMounted } from '@/hooks/useClientMount'
import Post from '@/components/Post'
import Balance from './balance'
import { getActiveChain } from '@/lib/communication'
import { useBalance, useWaitForTransactionReceipt, useConnection, useDisconnect, useWriteContract } from 'wagmi'
import moment from 'moment'
import { InfoIcon, POAPIcon, ThreeDotIcon } from '@/components/Icons'
import AISummary from '@/components/AISummary'
import UPlogo from '@/../public/up.png'
import { is0GHash, isIPFSHash, resolve0GUrl, resolveIPFSUrl } from '@/lib/storageHelper'
import LinksTab from '@/components/tabs/LinksTab'
import UniversalIdentity from '@/components/ui/UniversalIdentity/UniversalIdentity'
import { useProfile } from '@/hooks/useProfile'
import clsx from 'clsx'
import NativePopover from '@/components/ui/NativePopover'
import { ProfileQRCode } from './ProfileQRCode'
import styles from './UserProfile.module.scss'

// import SettingsTab from '@/components/tabs/SettingsTab'
// const SettingsTab = lazy(() => import('@/components/tabs/SettingsTab'))
// todo: this cause to handle loading.jsx again

export default function UserProfile() {
  const [posts, setPosts] = useState({ list: [] })
  const [postsLoaded, setPostsLoaded] = useState(0)
  const [isLoadedPoll, setIsLoadedPoll] = useState(false)
  const [totalPosts, setTotalPosts] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [POAPs, setPOAPs] = useState()
  const [activeTab, setActiveTab] = useState('posts') // New state for active tab
  const params = useParams()
  const router = useRouter()
  const { address, isConnected } = useConnection()
  const { web3, contract } = initHupContract()
  const activeChain = getActiveChain()
  const balance = useBalance({
    address: address,
  })
  const TABS_DATA = [
    { id: 'posts', label: 'Posts', count: totalPosts },
    { id: 'assets', label: 'Assets' },
    { id: 'reposts', label: 'Reposts' },
    { id: 'links', label: 'Links' },
  ]
  const TabContentMap = {
    events: <></>,
    //  jobs: JobsTab,
    apps: <></>,
    // feed: FeedTab,
  }
  const ActiveComponent = TabContentMap[activeTab]
  // Assumes:
  // - totalPosts is the contract's total post count (e.g., 100)
  // - postsLoaded is the current count displayed on the UI (e.g., 0, 10, 20)
  // - getPosts(startIndex, count, address) expects startIndex to be 1-based (e.g., 1, 11, 21)

  const loadMorePosts = async (totalPosts) => {
    // Use a sensible page size (10 is better than 1 for performance)
    const POSTS_PER_PAGE = 30

    // 1. Add a guard clause to prevent re-entry (scroll events firing too quickly)
    if (isLoadedPoll) return

    // 2. Set to true *before* starting the async operation
    setIsLoadedPoll(true)

    // Check if we have loaded everything
    if (postsLoaded >= totalPosts) {
      console.log('All posts loaded (Guard Check).')
      setIsLoadedPoll(false)
      return
    }

    try {
      // The correct 1-based index for the *first* post of the next batch.
      // If 0 posts are loaded, start index is 1. If 10 posts are loaded, start index is 11.
      const startIndex = postsLoaded

      // Calculate the actual number of posts remaining and limit to POSTS_PER_PAGE.
      const remainingPosts = totalPosts - postsLoaded
      const postsToFetch = Math.min(POSTS_PER_PAGE, remainingPosts)

      // Safety check (should be redundant if the initial guard passes)
      if (postsToFetch <= 0) {
        console.log('No posts to fetch after calculation.')
        return
      }

      console.log(`Fetching batch: Start Index ${startIndex}, Count ${postsToFetch}`)

      // 3. Fetch the next batch of posts (the contract handles reverse order internally)
      // Note: startIndex is passed as the 1-based chronological position.
      const newPosts = await getPostsByCreator(params.wallet, startIndex, postsToFetch, address)

      if (Array.isArray(newPosts) && newPosts.length > 0) {
        // Append new posts and update the loaded count
        setPosts((prevPosts) => ({ list: [...prevPosts.list, ...newPosts] }))
        setPostsLoaded((prevLoaded) => prevLoaded + newPosts.length)
      } else if (postsToFetch > 0) {
        // Handle cases where the contract returns an empty array (e.g., all posts in the batch were soft-deleted).
        // To prevent infinite loop, update postsLoaded to totalPosts.
        console.log('Fetched an empty batch; marking all as loaded for safety.')
        setPostsLoaded(totalPosts)
      }
    } catch (error) {
      console.error('Error loading more posts:', error)
    } finally {
      // 4. Crucial: Set to false in finally block
      setIsLoadedPoll(false)
    }
  }

  // Example of how a component fetches data from your new API route
  async function getPoapsForAddress(address) {
    const res = await fetch(`/api/poap-scan/${address}`)

    if (!res.ok) {
      // Handle error on the client side
      throw new Error('Failed to fetch POAPs')
    }

    return res.json()
  }

  // In a component:
  // const data = await getPoapsForAddress('atenyun.eth');

  useEffect(() => {
    recordProfileView(params.wallet, address || null)

    getPoapsForAddress(params.wallet).then((res) => {
      console.log(res)
      setPOAPs(res)
    })

    // getCreatorPostCount(params.wallet).then((count) => {
    //   const totalPosts = web3.utils.toNumber(count)
    //   setTotalPosts(totalPosts)

    // })
    getPosts(1, 40, null, params.wallet).then((res) => {
      setTotalPosts(res.meta.count)
      setPosts({ list: res.data })
      if (postsLoaded === 0 && !isLoadedPoll) {
        loadMorePosts(totalPosts)
      }
    })
  }, [])

  const handlePostClick = (postId, chainId) => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) return

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

            {/* Ensure posts, the list, and POAPs exist before mounting */}
            {posts?.list?.length > 0 && POAPs && <AISummary addr={params.wallet} posts={posts} poaps={POAPs} />}

            <details className="mt-10">
              <summary>View POAPs</summary>
              <div className={`grid grid--fill gap-1 mt-10`} style={{ '--data-width': `64px` }} role="list">
                {POAPs &&
                  POAPs.length > 0 &&
                  POAPs.map((POAP, i) => {
                    return (
                      <figure key={i} className={``}>
                        <img src={POAP.event.image_url} style={{ width: `64px` }} className={`rounded-full`} />
                        <figcaption style={{ color: `black` }}>{POAP.event.name}</figcaption>
                        <small className={`lable lable-dark`}>{POAP.event.year}</small>
                      </figure>
                    )
                  })}
              </div>
            </details>
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
                  {tab.count && (
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
                      }).format(totalPosts)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>

          {activeTab === 'posts' && (
            <div className={`${styles.tabContent} ${styles.postTab} relative`}>
              <div className={`${styles.grid} flex flex-column`}>
                {posts.list.length > 0 &&
                  posts.list.map((item, i) => {
                    return (
                      <section key={i} className={`${styles.post} animate fade`} onClick={() => handlePostClick(item.id, item.network_id)}>
                        <Post item={item} actions={[`like`, `comment`, `repost`, `view`, `share`]} />
                        {i < posts.list.length - 1 && <hr />}
                      </section>
                    )
                  })}
              </div>
            </div>
          )}

          {activeTab === 'assets' && (
            <div className={`${styles.tabContent} ${styles.balance} relative`}>
              <Balance addr={params.wallet} />
            </div>
          )}

          {activeTab === 'activity' && (
            <div className={`${styles.tabContent} ${styles.activity} relative`}>
              <NoData name={`activity`} />
            </div>
          )}

          {activeTab === 'reposts' && (
            <div className={`${styles.tabContent} ${styles.reposts} relative`}>
              <NoData name={`reposts`} />
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

  const params = useParams()
  const { address, isConnected } = useConnection()
  const { disconnect } = useDisconnect()
  const activeChain = getActiveChain()
  const { profile, isLoading, mutate } = useProfile(addr)
  /* Error during submission (e.g., user rejected)  */
  const { data: hash, isPending: isSigning, error: submitError, writeContract } = useWriteContract()
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

  const follow = async () => toast(`Coming soon`, `warning`)

  const handleDisconnect = async () => {
    disconnect()
  }

  const editProfile = () => {
    if (profile.source === `universal_profile`) {
      toast(`Please update your profile through Universal Profile`, `error`)
      return
    }
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

  if (isLoading) return <div className={`shimmer ${styles.shimmer}`} />

  const targetWallet = params?.wallet || addr || ''
  const displayWalletString = targetWallet.length >= 42 ? `${targetWallet.slice(0, 6)}…${targetWallet.slice(-4)}` : targetWallet

  const explorerBaseUrl = activeChain?.[0]?.blockExplorers?.default?.url || 'https://etherscan.io'

  return (
    <>
      {showProfileModal && profile && (
        <ProfileModal getActiveChain={getActiveChain} profile={profile} setShowProfileModal={setShowProfileModal} mutate={mutate} />
      )}

      <section className={`${styles.profile} relative flex flex-column align-items-start justify-content-start gap-1`}>
        <header className="flex flex-row align-items-center justify-content-between gap-050 w-100">
          <div className="flex-1 flex flex-column align-items-start justify-content-center gap-025">
            <div className={styles.profile__header}>
              <b className={styles.profile__name}>{profile.name ? profile.name : 'hup-user'}</b>
              <img className={styles.profile__checkmark} alt="Checkmark" src={blueCheckMarkIcon.src || blueCheckMarkIcon} />

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
                <button className={styles.btnFollowers} type="button">
                  <span>0 followers</span>
                </button>
                {viewCount !== null && (
                  <>
                    <span>·</span>
                    <button className={styles.btnFollowers} type="button">
                      <span>
                        {new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(viewCount)} recent views
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
                <button className={`${styles.profile__btnFollow} w-100`} type="button" onClick={follow}>
                  Follow
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
  const [showModal, setShowModal] = useState(false)
  const [status, setStatus] = useState()
  const [statusContent, setStatusContent] = useState('')
  const [expirationTimestamp, setExpirationTimestamp] = useState(24)
  const [maxLength, setMaxLength] = useState()
  const { web3, contract } = initHupContract()
  const [activeChain, setActiveChain] = useState(getActiveChain())
  const { contract: statusContract } = initStatusContract()
  const statusRef = useRef(``)

  /* Error during submission (e.g., user rejected)  */
  const { data: hash, isPending: isSigning, error: submitError, writeContract } = useWriteContract()
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
    try {
      const result = writeContract({
        abi: statusAbi,
        address: activeChain[1].status,
        functionName: 'clearStatus',
        args: [],
      })
      console.log('Transaction sent:', result)
    } catch (error) {
      console.error('Contract write failed:', error)
    }
  }

  const updateStatus = (e) => {
    writeContract({
      abi: statusAbi,
      address: activeChain[1].status,
      functionName: 'updateStatus',
      args: [statusContent, 'public', '', 24],
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

  useEffect(() => {
    getStatus(addr).then((res) => {
      console.log(res)
      setStatus(res)
    })

    getMaxLength().then((res) => {
      console.log(res)
      setMaxLength(web3.utils.toNumber(res))
    })
  }, [showModal])
  return (
    <>
      {showModal && (
        <div className={`${styles.statusModal} animate fade`} onClick={() => setShowModal(false)}>
          <div className={`${styles.statusModal__card}`} onClick={(e) => e.stopPropagation()}>
            <header className={``}>
              <div className={``} aria-label="Close" onClick={() => setShowModal(false)}>
                <svg class="x1lliihq x1n2onr6 x5n08af" fill="currentColor" height="16" role="img" viewBox="0 0 24 24" width="16">
                  <title>Close</title>
                  <line
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    x1="21"
                    x2="3"
                    y1="3"
                    y2="21"
                  ></line>
                  <line
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    x1="21"
                    x2="3"
                    y1="21"
                    y2="3"
                  ></line>
                </svg>
              </div>
              <div className={`flex-1`}>
                <h3>Set your status</h3>
              </div>
              <div className={`pointer`} onClick={(e) => updateStatus(e)}>
                {isSigning ? `Signing...` : isConfirming ? 'Confirming...' : status && status.content !== '' ? `Update` : `Share`}
              </div>
            </header>

            <main className={`flex flex-column align-items-center gap-1 `}>
              <div className={`${styles.statusModal__pfp} rounded relative`}>
                <figure className={`rounded`}>
                  <img src={`${profile.profileImage}`} />
                </figure>

                <div
                  className={`d-f-c`}
                  title={status && status.content !== '' && moment.unix(web3.utils.toNumber(status.timestamp)).utc().fromNow()}
                >
                  <textarea
                    autoFocus
                    defaultValue={status && status !== '' ? status.content : statusContent}
                    onInput={(e) => setStatusContent(e.target.value)}
                    placeholder={`${getRandomPlaceholder()}`}
                    maxLength={maxLength ? maxLength : 60}
                  />
                </div>
              </div>

              <div className={`${styles.statusModal__expirationTimestamp} relative`}>
                <label htmlFor="">Clear after </label>
                <select name="" id="" onChange={(e) => setexpirationTimestamp(e.target.value)}>
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
          </div>
        </div>
      )}

      <div
        className={`${styles.status} animate pointer`}
        onClick={() => {
          setShowModal(true)
        }}
      >
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
      </div>
    </>
  )
}

/**
 * Profile Modal Component
 * @param {Object} props
 * @param {Object} props.profile - The profile data object.
 * @param {Function} props.setShowProfileModal - State setter to control modal visibility.
 * @param {Function} props.getActiveChain - Helper to get the current active blockchain network.
 * @returns {JSX.Element}
 */
const ProfileModal = ({ profile, setShowProfileModal, getActiveChain, mutate }) => {
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
  const [activeChain, setActiveChain] = useState()
  const { address, isConnected } = useConnection()

  // Refs
  const pfpRef = useRef()
  const tagRef = useRef()
  const linkNameRef = useRef()
  const linkURLRef = useRef()

  // Handlers
  const uploadFileToIPFS = async (file) => {
    try {
      if (!file) {
        console.error('No file selected.')
        return
      }

      const data = new FormData()
      data.set('file', file)

      const uploadRequest = await fetch(`/api/ipfs/file`, {
        method: 'POST',
        body: data,
      })
      const signedUrl = await uploadRequest.json()

      console.log(`cid: ${signedUrl.cid}`)
      return signedUrl.cid
    } catch (e) {
      console.error('Trouble uploading file:', e)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!isConnected) return

    setIsPending(true)
    setError(null)

    const formData = new FormData(e.target)
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
        setError('Failed to upload image to decentralized storage.')
        setIsPending(false)
        return
      }
    }

    // Explicitly overwrite or append the finalized values to the FormData instance
    formData.set('profileImage', profileImageHash)
    formData.set('tags', JSON.stringify(tags.list))
    formData.set('links', JSON.stringify(links.list))

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

    const isRedundant = links.list.some((link) => link.name.toLowerCase() === newLinkName.toLowerCase())
    if (!isRedundant) {
      setLinks({ list: [...links.list, { name: newLinkName, url: newLinkURL }] })
    }
    linkNameRef.current.value = ''
    linkURLRef.current.value = ''
  }

  const removeLink = (e, linkToRemove) => {
    setLinks({ list: links.list.filter((link) => link.name !== linkToRemove.name) })
  }

  // Effects
  useEffect(() => {
    if (typeof getActiveChain === 'function') {
      setActiveChain(getActiveChain())
    }
  }, [getActiveChain])

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
            {/* Avatar */}
            <div className={styles.profileModal__avatarWrap}>
              <label htmlFor="pm-profileImage" className={styles.profileModal__avatarLabel}>
                <figure className={styles.profileModal__avatar}>
                  <img ref={pfpRef} src={profile?.profileImage} alt="Profile preview" />
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
              <input className={styles.profileModal__input} type="text" name="name" defaultValue={profile?.name} placeholder="Your name" />
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
                    <div key={`link-${i}`} className={styles.profileModal__linkItem}>
                      <div className={styles.profileModal__linkInfo}>
                        <span className={styles.profileModal__linkName}>{link.name}</span>
                        <span className={styles.profileModal__linkUrl}>{link.url}</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => removeLink(e, link)}
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
                  Add
                </button>
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
