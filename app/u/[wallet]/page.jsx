'use client'

import Link from 'next/link'
import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getUniversalProfile, getProfile, updateProfile, subscribeUser, unsubscribeUser, sendNotification } from '@/lib/api'
import { initPostContract, initStatusContract, getStatus, getCreatorPostCount, getMaxLength, getPostsByCreator } from '@/lib/communication'
import { toast } from '@/components/NextToast'
import Web3 from 'web3'
import abi from '@/abi/post.json'
import blueCheckMarkIcon from '@/public/icons/blue-checkmark.svg'
import statusAbi from '@/abi/status.json'
import { useClientMounted } from '@/hooks/useClientMount'
import Post from '@/components/Post'
import Balance from './_components/balance'
import { getActiveChain } from '@/lib/communication'
import { useBalance, useWaitForTransactionReceipt, useConnection, useDisconnect, useWriteContract } from 'wagmi'
import moment from 'moment'
import { InfoIcon, POAPIcon, ThreeDotIcon } from '@/components/Icons'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'
import GlobalLoader, { ContentSpinner } from '@/components/Loading'

export default function Page() {
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
  const { web3, contract } = initPostContract()
  const activeChain = getActiveChain()
  const balance = useBalance({
    address: address,
  })
  const TABS_DATA = [
    { id: 'posts', label: 'Posts', count: totalPosts },
    { id: 'assets', label: 'Assets' },
    { id: 'reposts', label: 'Reposts' },
    { id: 'links', label: 'Links' },
    { id: 'settings', label: 'Settings' },
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
    getPoapsForAddress(params.wallet).then((res) => {
      console.log(res)
      setPOAPs(res)
    })
    getCreatorPostCount(params.wallet).then((count) => {
      const totalPosts = web3.utils.toNumber(count)
      setTotalPosts(totalPosts)

      if (postsLoaded === 0 && !isLoadedPoll) {
        loadMorePosts(totalPosts)
      }
    })
  }, [])

  return (
    <>
      <PageTitle name={`profile`} />

      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width={`medium`}>
          <div className={`${styles.profileWrapper}`}>
            <Profile addr={params.wallet} />

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
                <button key={tab.id} className={`${activeTab === tab.id ? styles.activeTab : ''} flex gap-1`} onClick={() => setActiveTab(tab.id)}>
                  <span>{tab.label}</span>
                  {tab.count && (
                    <span
                      className={`lable lable-pill`}
                      style={{
                        background: `var(--network-color-primary)`,
                        color: `var(--network-color-text)`,
                      }}
                    >
                      {new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(totalPosts)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>

          {activeTab === 'posts' && (
            <div className={`${styles.tabContent} ${styles.postTab} relative`}>
              <PostForm addr={params.wallet} />

              <div className={`${styles.grid} flex flex-column`}>
                {posts &&
                  posts.list.length > 0 &&
                  posts.list.map((item, i) => {
                    return (
                      <section
                        key={i}
                        className={`${styles.post} animate fade`}
                        onClick={() => router.push(`/${activeChain[0].id}/p/${item.postId}`)}
                      >
                        <Post item={item} actions={[`like`, `comment`, `repost`, `tip`, `view`, `share`]} />
                        {i < posts.list.length - 1 && <hr />}
                      </section>
                    )
                  })}
              </div>
            </div>
          )}

 {activeTab === 'assets' && (
            <div className={`${styles.tabContent} ${styles.activity} relative`}>
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
              <Links />
            </div>
          )}

          {activeTab === 'settings' && (
            <div className={`${styles.tabContent} ${styles.settings} relative`} style={{ display: `none` }}>
              <Settings />
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
 * Profile
 * @param {String} addr
 * @returns
 */
const Profile = ({ addr }) => {
  const [data, setData] = useState()
  const [selfView, setSelfView] = useState()
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [isItUp, setIsItUp] = useState(false)
  const params = useParams()
  const { address, isConnected } = useConnection()
  const { disconnect } = useDisconnect()
  const activeChain = getActiveChain()

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

  const follow = async () => toast(`Coming soon `, `warning`)

  const handleDisconnect = async () => {
    disconnect()

    // setTimeout(() => {
    //   window.location.reload()
    // }, 2000)
  }

  const Tags = ({ tags }) => {
    tags = JSON.parse(tags)
    if (tags === null) {
      return (
        <>
          <small>#profile</small>
          <small>#hup</small>
          <small>#social</small>
        </>
      )
    }

    let tagList = []
    tags.forEach((element) => {
      tagList.push(<small>#{element}</small>)
    })

    return <>{...tagList}</>
  }

  const editProfile = () => {
    console.log(isItUp)
    if (isItUp) {
      toast(`Please update your profile through Universal Profile`, `error`)
      return
    }
    setShowProfileModal(true)
  }

  useEffect(() => {
    getUniversalProfile(addr).then((res) => {
      console.log(res)
      if (res.data && Array.isArray(res.data.Profile) && res.data.Profile.length > 0 && res.data.Profile[0].isContract) {
        setIsItUp(true)
        setData({
          wallet: res.data.Profile[0].id,
          name: res.data.Profile[0].name,
          description: res.data.Profile[0].description,
          profileImage: res.data.Profile[0].profileImages.length > 0 ? res.data.Profile[0].profileImages[0].src : '',
          profileHeader: '',
          tags: JSON.stringify(res.data.Profile[0].tags),
          links: JSON.stringify(res.data.Profile[0].links_),
          lastUpdate: '',
        })
        setSelfView(addr.toString().toLowerCase() === res.data.Profile[0].id.toLowerCase())
      } else {
        getProfile(addr).then((res) => {
          console.log(res, `==`)
          if (res.wallet) {
            res.profileImageName = res.profileImage
            const profileImage = `${process.env.NEXT_PUBLIC_UPLOAD_URL}${res.profileImage}`
            res.profileImage = profileImage
            setData(res)
            setSelfView(addr.toString().toLowerCase() === res.wallet.toLowerCase())
          }
        })
      }
    })
  }, [])

  if (!data) return <div className={`shimmer ${styles.shimmer}`} />

  return (
    <>
      {showProfileModal && data && <ProfileModal profile={data} setShowProfileModal={setShowProfileModal} />}

      <section className={`${styles.profile} relative flex flex-column align-items-start justify-content-start gap-1`}>
        <header className={`flex flex-row align-items-center justify-content-between gap-050`}>
          <div className={`flex-1 flex flex-column align-items-start justify-content-center gap-025`}>
            <div className={`flex align-items-center gap-025`}>
              <b className={`${styles.profile__name}`}>{data.name !== '' ? data.name : `hup-user`}</b>
              <img className={`${styles.profile__checkmark}`} alt={`Checkmark`} src={blueCheckMarkIcon.src} />
            </div>

            <code className={`${styles.profile__wallet}`}>
              <Link href={`${activeChain[0].blockExplorers.default.url}/address/${data.wallet}`} target={`_blank`}>
                {`${data.wallet.slice(0, 4)}…${data.wallet.slice(38)}`}
              </Link>
            </code>

            <p className={`${styles.profile__description} mt-20`}>{data.description || `This user has not set up a bio yet.`}</p>

            <div className={`${styles.profile__tags} flex flex-row align-items-center flex-wrap gap-050`}>
              <Tags tags={data.tags} />
            </div>
          </div>

          <div className={`${styles.profile__pfp} rounded relative`}>
            <figure className={``}>
              <img alt={`PFP`} src={`${data.profileImage}`} />
            </figure>

            <Status addr={addr} profile={data} selfView={selfView} />
          </div>
        </header>

        <footer className={`w-100`}>
          <ul className={`flex flex-column align-items-center justify-content-between gap-1`}>
            <li className={`flex flex-row align-items-start justify-content-start gap-025 w-100`}>
              <div className={`flex flex-row align-items-start justify-content-start gap-025 w-100`}>
                <button className={`${styles.btnFollowers}`}>
                  <span className={`mt-20 text-secondary`}>{100} followers</span>
                </button>
                <span>•</span>
                <Link className={`${styles.link}`} target={`_blank`} href={`https://hup.social/u/${addr}`}>
                  hup.social/u/{`${addr.slice(0, 4)}…${addr.slice(38)}`}
                </Link>
              </div>

              <div role="list">
                <POAPIcon />
              </div>
            </li>

            {isConnected && selfView && (
              <li className={`w-100 grid grid--fit gap-1`} style={{ '--data-width': `200px` }}>
                {address.toString().toLowerCase() === params.wallet.toString().toLowerCase() && (
                  <>
                    <button className={`${styles.profile__btnFollow}`} onClick={() => editProfile()}>
                      Edit profile
                    </button>
                    <button className={`${styles.profile__btnDisconnect}`} onClick={() => handleDisconnect()}>
                      Disconnect
                    </button>
                  </>
                )}
              </li>
            )}

            {!selfView && (
              <li className={`w-100 grid grid--fit gap-1`} style={{ '--data-width': `200px` }}>
                <button className={`${styles.profile__btnFollow}`} onClick={() => follow()}>
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
/**
 * Profile
 * @param {String} addr
 * @returns
 */
const Links = () => {
  const [data, setData] = useState()
  const [isItUp, setIsItUp] = useState()
  const params = useParams()

  useEffect(() => {
    getUniversalProfile(params.wallet).then((res) => {
      console.log(res)
      if (res.data && Array.isArray(res.data.Profile) && res.data.Profile.length > 0 && res.data.Profile[0].isContract) {
        setIsItUp(true)
        setData({
          wallet: res.data.Profile[0].id,
          name: res.data.Profile[0].name,
          description: res.data.Profile[0].description,
          profileImage: res.data.Profile[0].profileImages.length > 0 ? res.data.Profile[0].profileImages[0].src : '',
          profileHeader: '',
          tags: JSON.stringify(res.data.Profile[0].tags),
          links: JSON.stringify(res.data.Profile[0].links),
          lastUpdate: '',
        })
      } else {
        getProfile(params.wallet).then((res) => {
          console.log(res, `==`)
          if (res.wallet) {
            res.profileImageName = res.profileImage
            const profileImage = `${process.env.NEXT_PUBLIC_UPLOAD_URL}${res.profileImage}`
            res.profileImage = profileImage
            setData(res)
          }
        })
      }
    })
  }, [])

  if (!data)
    return (
      <div className={`flex flex-column gap-1`}>
        <div className={`shimmer ${styles.linkShimmer}`} />
        <div className={`shimmer ${styles.linkShimmer}`} />
        <div className={`shimmer ${styles.linkShimmer}`} />
      </div>
    )

  if (JSON.parse(data.links).length < 1) return <NoData name={`links`} />

  return (
    <div className={`${styles.links}`}>
      {JSON.parse(data.links).length > 0 &&
        JSON.parse(data.links).map((link, i) => {
          return (
            <a
              key={i}
              href={`${!link.url.includes(`http`) ? `//${link.url}` : link.url}`}
              target={`_blank`}
              rel="noopener noreferrer"
              className={`flex flex-row align-items-center justify-content-between`}
            >
              <div className={`flex flex-column`}>
                <p>{link.title || link.name}</p>
                <code>{link.url}</code>
              </div>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4.16531 14.625L3.375 13.8347L11.9597 5.25H6.75V4.125H13.875V11.25H12.75V6.04031L4.16531 14.625Z" fill="#424242" />
              </svg>
            </a>
          )
        })}
    </div>
  )
}
/**
 * Profile
 * @param {String} addr
 * @returns
 */
const Settings = () => {
  const handleSubscribe = async () => {
    const sw = await navigator.serviceWorker.ready
    const push = await sw.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: '',
    })
    console.log(JSON.stringify(push))
    return push
  }

  const readUserNotificationPermition = async () => {
    try {
      Notification.requestPermission().then((result) => {
        console.log(result)
        if (result === 'granted') {
          handleSubscribe().then((res) => {
            subscription(res, params.id).then((res) => {
              console.log(res)
              toast(`Notification has been enabled.`)
            })
          })
        }
      })
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <div className={`${styles.settings}`}>
      <div>
        <PushNotificationManager />
        <hr />
        <InstallPrompt />
      </div>
    </div>
  )
}

function PushNotificationManager() {
  const [isSupported, setIsSupported] = useState(false)
  const [subscription, setSubscription] = useState(null)
  const [message, setMessage] = useState('')
  const { address, isConnected } = useConnection()

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/\\-/g, '+').replace(/_/g, '/')

    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
  }

  async function registerServiceWorker() {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })
    const sub = await registration.pushManager.getSubscription()
    setSubscription(sub)
  }

  async function subscribeToPush() {
    const registration = await navigator.serviceWorker.ready
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    })
    setSubscription(sub)
    await subscribeUser(sub, address)
  }

  async function unsubscribeFromPush() {
    await subscription?.unsubscribe()
    setSubscription(null)
    await unsubscribeUser()
  }

  async function sendTestNotification() {
    if (subscription) {
      await sendNotification(message, address)
      setMessage('')
    }
  }

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true)
      registerServiceWorker()
    }
  }, [])

  if (!isSupported) {
    return <p>Push notifications are not supported in this browser.</p>
  }

  return (
    <div>
      <h3>Push Notifications</h3>
      {subscription ? (
        <>
          <p>You are subscribed to push notifications.</p>
          <button onClick={unsubscribeFromPush}>Unsubscribe</button>
          <input type="text" placeholder="Enter notification message" value={message} onChange={(e) => setMessage(e.target.value)} />
          <button onClick={sendTestNotification}>Send Test</button>
        </>
      ) : (
        <>
          <p>You are not subscribed to push notifications.</p>
          <button onClick={subscribeToPush}>Subscribe</button>
        </>
      )}
    </div>
  )
}

function InstallPrompt() {
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream)

    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches)
  }, [])

  if (isStandalone) {
    return null // Don't show install button if already installed
  }

  return (
    <div>
      <h3>Install App</h3>
      <button>Add to Home Screen</button>
      {isIOS && (
        <p>
          To install this app on your iOS device, tap the share button
          <span role="img" aria-label="share icon">
            {' '}
            ⎋{' '}
          </span>
          and then "Add to Home Screen"
          <span role="img" aria-label="plus icon">
            {' '}
            ➕{' '}
          </span>
          .
        </p>
      )}
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
  const { web3, contract } = initPostContract()
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
 * Profile Modal
 * @param {*} param0
 * @returns
 */
const ProfileModal = ({ profile, setShowProfileModal }) => {
  const [error, setError] = useState(null)
  const [isPending, setIsPending] = useState(false)
  const [tags, setTags] = useState({ list: JSON.parse(profile.tags) || [] })
  const [links, setLinks] = useState({ list: JSON.parse(profile.links) || [] })
  const [activeChain, setActiveChain] = useState()
  const { address, isConnected } = useConnection()

  // Refs
  const pfpRef = useRef()
  const tagRef = useRef()
  const linkNameRef = useRef()
  const linkURLRef = useRef()

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

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!isConnected) return

    setIsPending(true)

    const formData = new FormData(e.target)
    const name = formData.get('name')
    const description = formData.get('description')
    formData.set('tags', JSON.stringify(tags.list))
    formData.set('links', JSON.stringify(links.list))
    const errors = {}

    updateProfile(formData, address).then((res) => {
      if (res.success) {
        setIsPending(false)
        toast(`Your profile has been updated.`, 'success')
      }
    })
  }

  const showPFP = (e) => {
    const preview = pfpRef.current

    const file = e.target.files[0]
    const reader = new FileReader()

    reader.addEventListener('load', () => {
      // convert image file to base64 string
      preview.src = reader.result
    })

    if (file) {
      reader.readAsDataURL(file)
    }
  }

  const addTag = (e) => {
    const newTag = tagRef.current.value
    if (newTag === '') return

    const isReduntant = tags.list.filter((filterItem) => filterItem === newTag)
    if (isReduntant.length === 0) setTags({ list: tags.list.concat(newTag) })
    tagRef.current.value = null
  }

  const removeTag = (e, tag) => {
    setTags({ list: tags.list.filter((filterItem) => filterItem !== tag) })
  }

  const addLink = (e) => {
    const newLinkName = linkNameRef.current.value
    const newLinkURL = linkURLRef.current.value
    if (newLinkName === '' || newLinkURL === '') return

    const isReduntant = links.list.filter((filterItem) => filterItem.name === newLinkName)
    if (isReduntant.length === 0) setLinks({ list: links.list.concat({ name: newLinkName, url: newLinkURL }) })
    linkNameRef.current.value = null
    linkURLRef.current.value = null
  }

  const removeLink = (e, link) => {
    setLinks({ list: links.list.filter((filterItem) => filterItem !== link) })
  }

  useEffect(() => {
    setActiveChain(getActiveChain())
    // getStatus(addr).then((res) => {
    //   console.log(res)
    //   setStatus(res)
    // })
  }, [])
  return (
    <>
      <div className={`${styles.profileModal} animate fade`} onMouseDown={() => setShowProfileModal(false)}>
        <div className={`${styles.profileModal__card}`} onMouseDown={(e) => e.stopPropagation()}>
          <header className={``}>
            <div className={``} aria-label="Close" onClick={() => setShowProfileModal(false)}>
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
              <h3>Update profile</h3>
            </div>
            <div className={`pointer`}></div>
          </header>

          <main className={`flex flex-column align-items-center gap-1 `}>
            {isConfirmed && <p className="text-center badge badge-success">Done</p>}
            <form className={`form`} action="" onSubmit={(e) => handleSubmit(e)} encType={`multipart/form-data`}>
              <div className={`form-group`}>
                <figure className={`rounded`}>
                  <img ref={pfpRef} src={`${profile.profileImage}`} />
                </figure>
              </div>
              <div className={`form-group`}>
                <label htmlFor="">Profile picture</label>
                <input type="file" name="profileImage" id="" onChange={(e) => showPFP(e)} />
                <input type="hidden" name="profileImage_hidden" defaultValue={profile.profileImageName} />
              </div>
              <div className={`form-group`}>
                <label htmlFor="">Name</label>
                <input type="text" name="name" id="" defaultValue={profile.name} placeholder={`Name`} />
              </div>
              <div className={`form-group`}>
                <label htmlFor="">Bio</label>
                <textarea name="description" id="" defaultValue={profile.description} placeholder="Profile bio"></textarea>
              </div>

              <details open>
                <summary>Advanced</summary>
                <div>
                  <div>
                    <div className={`flex flex-wrap`}>
                      {tags.list.length > 0 &&
                        tags.list.map((tag, i) => (
                          <>
                            <span key={i} className={`${styles['form-tag']}`}>
                              {tag}
                              <button type="button" onClick={(e) => removeTag(e, tag)}>
                                X
                              </button>
                            </span>
                          </>
                        ))}
                    </div>

                    <div className={`form-group flex`}>
                      <input ref={tagRef} type="text" name="tags" id="" placeholder={`Tag`} />
                      <button type="button" onClick={(e) => addTag(e)}>
                        Add
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className={`flex flex-wrap`}>
                      {links.list.length > 0 &&
                        links.list.map((link, i) => (
                          <>
                            <span key={i} className={`${styles['form-link']}`}>
                              {link.name}
                              <button type="button" onClick={(e) => removeLink(e, link)}>
                                X
                              </button>
                            </span>
                          </>
                        ))}
                    </div>

                    <div className={`form-group flex`}>
                      <input ref={linkNameRef} type="text" name="links" id="" placeholder={`Link Name`} />
                      <input ref={linkURLRef} type="text" name="links" id="" placeholder={`Link URL`} />
                      <button type="button" onClick={(e) => addLink(e)}>
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              </details>

              <div className={`form-group`}>
                <button type="submit" className="btn" disabled={isPending}>
                  Update
                </button>
                {error && <p>{error}</p>}
              </div>
            </form>
          </main>
        </div>
      </div>
    </>
  )
}

const PostForm = ({ addr }) => {
  const [isUploading, setIsUploading] = useState(false)
  const [content, setContent] = useState('Question?')
  const [showForm, setShowForm] = useState(`post`)
  const [votingLimit, setVotingLimit] = useState(1)
  const [postContent, setPostContent] = useState({
    version: '1.1',
    elements: [
      { type: 'text', data: { text: '' } },
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

  const [showWhitelist, setShowWhitelist] = useState(false)
  const [whitelist, setWhitelist] = useState({ list: [] })
  const [filteredProfiles, setFilteredProfiles] = useState()
  const [options, setOptions] = useState({ list: [``, ``] })
  const activeChain = getActiveChain()
  const mounted = useClientMounted()
  const createFormRef = useRef()
  const fileInputRef = useRef()
  const whitelistInputRef = useRef()
  const { address, isConnected } = useConnection()
  const { web3, contract } = initPostContract()
  const [selectedMediaType, setSelectedMediaType] = useState(null) // Tracks if we're expecting image or video

  /* Error during submission (e.g., user rejected)  */
  const { data: hash, isPending: isSigning, error: submitError, writeContract } = useWriteContract()

  const handleSuccess = (receipt) => {
    console.log('🎉 Transaction Confirmed! Receipt:', receipt)
    alert('Transaction Successful!')

    // --- 🎯 TanStack Query Step: Invalidate/Refetch Data ---
    // If this transaction changed some on-chain state (e.g., token balance, list of NFTs),
    // you must invalidate the relevant queries to refetch the latest data.
    queryClient.invalidateQueries({ queryKey: ['balanceOf', 'your-address'] })
    queryClient.invalidateQueries({ queryKey: ['totalSupply'] })
    // --------------------------------------------------------

    // Optional: Reset the write contract state to allow a new transaction
    // resetWriteContract();
  }

  const handleError = (error) => {
    console.error('🔥 Transaction Reverted/Failed:', error)
    alert(`Transaction Failed: ${error.shortMessage || error.message}`)

    // Optional: Reset the write contract state
    // resetWriteContract();
  }

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError /* Error after mining (e.g., transaction reverted) */,
  } = useWaitForTransactionReceipt({
    hash,
    query: {
      enabled: !!hash, // Only run the query once we have a transaction hash
      onSuccess: handleSuccess, // Call our success function
      onError: handleError, // Call our error function
    },
  })

  const handleCreatePoll = async (e) => {
    e.preventDefault()

    // upload metadata
    // const choices = document.querySelectorAll(`[name="choice"]`)
    // console.log(choices)
    // let choiceValues = []
    // choices.forEach((element) => {
    //   choiceValues.push(element.value)
    // })

    // const upload = await pinata.upload.json({
    //   q: document.querySelector(`[name="q"]`).value,
    //   choices: choiceValues,
    //   creator: profile.id,
    // })
    // console.log(`IPFS`, upload)
    // console.log(process.env.NEXT_PUBLIC_CONTRACT_POST)
    // const web3 = new Web3(window.lukso)
    // const contract = new web3.eth.Contract(ABI, process.env.NEXT_PUBLIC_CONTRACT_POST)
    // const t = toast(`Waiting for transaction's confirmation`)
    const formData = new FormData(e.target)

    // try {
    //   const t = toast.loading(`Uploading to IPFS`)
    //   const upload = await pinata.upload.file(formData.get(`file`))
    //   console.log(upload)
    //   toast.dismiss(t)
    //   image = upload.IpfsHash
    // } catch (error) {
    //   console.log(error)
    // }

    // const upload = await pinata.upload.json({
    //   image: image,
    //   creator: profile.id,
    // })
    let whitelist_accounts = []
    if (whitelist.list.length > 0) {
      whitelist.list.map((profile, i) => {
        whitelist_accounts.push(profile.id)
      })
    }
    console.log(whitelist_accounts)

    writeContract({
      abi,
      address: process.env.NEXT_PUBLIC_CONTRACT_POST,
      functionName: 'createPoll',
      args: [
        '',
        content,
        options.list,
        moment(formData.get(`startTime`)).utc().unix().toString(),
        moment(formData.get(`endTime`)).utc().unix().toString(),
        whitelist_accounts,
        formData.get(`votesPerAccount`),
        formData.get(`pollType`),
        formData.get(`token`),
        web3.utils.toWei(formData.get(`holderAmount`), `ether`),
        formData.get(`allowComments`) === 'true' ? true : false,
      ],
    })
  }

  const uploadFileToIPFS = async (file) => {
    setIsUploading(true)

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
      setIsUploading(false)
      return signedUrl
    } catch (e) {
      setIsUploading(false)
      console.log(e)
      console.error('Trouble uploading file')
    }
  }

  const uploadObjectToIPFS = async (json) => {
    setIsUploading(true)
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
      setIsUploading(false)
      return responseData
    } catch (e) {
      setIsUploading(false)
      console.error('Trouble uploading file/object:', e)
      // Re-throw the error or return null/undefined depending on your error handling preference
      throw e
    }
  }

  const handleCreatePost = async (e) => {
    e.preventDefault()

    const formData = new FormData(e.target)

    const resultIPFS = await uploadObjectToIPFS(postContent)
    if (!resultIPFS.cid) {
      console.error(`CID not found`)
    }
    const metadata = resultIPFS.cid
    const content = `─`

    writeContract({
      abi,
      address: activeChain[1].post,
      functionName: 'createPost',
      args: [metadata, content, formData.get(`allowComments`) === 'true' ? true : false],
    })
  }

  const handleTextContentChange = (newText) => {
    setPostContent((prevContent) => {
      // 1. Copy the elements array
      const newElements = [...prevContent.elements]

      // 2. Deep copy the specific element being modified (Element 0: text)
      const newTextElement = {
        ...newElements[0],
        data: {
          ...newElements[0].data,
          text: newText, // Set the new text value
        },
      }

      // 3. Update the elements array with the new element copy
      newElements[0] = newTextElement

      // 4. Return the new top-level state object copy
      return {
        ...prevContent,
        elements: newElements,
      }
    })
  }

  /**
   * Triggers the hidden file input with the correct acceptance mime types.
   */
  const triggerFileInput = (e, type) => {
    if (postContent.elements[1].data.items.length >= 4) {
      console.error('Maximum 4 media items reached.')
      return
    }

    setSelectedMediaType(type)

    fileInputRef.current.accept = type === 'image' ? 'image/*' : 'video/*'
    fileInputRef.current.click()
  }

  /**
   * Handles file selection from the hidden input.
   * Simulates IPFS upload and CID generation.
   */
  const handleFileSelect = async (event) => {
    const file = event.target.files[0]
    if (!file || postContent.elements[1].data.items.length >= 4) return

    // Size of the file
    const sizeInBytes = file.size
    const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2)

    if (sizeInMB > 5) {
      toast(`File size error. Maximum size is 5MB`)
      return
    }

    // console.log(`File Name: ${file.name}`);
    // console.log(`File Type: ${file.type}`);
    // console.log(`File Size: ${sizeInBytes} bytes`);
    // console.log(`File Size (MB): ${sizeInMB} MB`);

    // 1. Determine media type based on MIME type and the button clicked
    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    let type

    if ((isImage && selectedMediaType === 'image') || (isVideo && selectedMediaType === 'video')) {
      type = selectedMediaType
    } else {
      // Handle type mismatch (e.g., user selects video but clicked 'Add Image')
      console.error(`File type mismatch. Expected ${selectedMediaType}, got ${file.type}`)
      return
    }

    // Upload to IPFS
    const resultIPFS = await uploadFileToIPFS(file, `file`)

    if (!resultIPFS.url || !resultIPFS.cid) return

    // 2. Create a temporary local URL for immediate preview
    const localUrl = URL.createObjectURL(file)

    // 3. Create a placeholder item with an 'isUploading' flag
    const newItem = {
      type: type,
      cid: resultIPFS.cid, // Placeholder CID
      alt: `Hup asset ${type}`,
      mimeType: file.type,
      localUrl: localUrl, // Use this as a temporary unique ID
      isUploading: true,
      duration: type === 'video' ? 0 : undefined,
    }

    // 4. Add the placeholder item to the state immediately
    setPostContent((prevContent) => {
      const currentContent = prevContent || INITIAL_POST_CONTENT
      const newElements = [...currentContent.elements]
      const mediaElement = newElements[1]
      const newMediaItems = [...mediaElement.data.items, newItem]

      const newMediaElement = {
        ...mediaElement,
        data: { ...mediaElement.data, items: newMediaItems },
      }

      newElements[1] = newMediaElement
      return { ...currentContent, elements: newElements }
    })

    // 5. --- Simulate IPFS Upload (Asynchronous Task) ---
    console.log(`Done. file selected`)

    // Reset the file input value so the same file can be selected again
    event.target.value = null
  }

  const handleRemoveMedia = (itemIndex) => {
    setPostContent((prevContent) => {
      // 1. Get a copy of the elements array
      const newElements = [...prevContent.elements]
      const mediaElement = newElements[1]

      // 2. Filter the items array immutably
      const newMediaItems = mediaElement.data.items.filter((_, idx) => idx !== itemIndex)

      // 3. Create a deep copy of the media element with the new items array
      const newMediaElement = {
        ...mediaElement,
        data: {
          ...mediaElement.data,
          items: newMediaItems,
        },
      }

      // 4. Update the elements array
      newElements[1] = newMediaElement

      // 5. Return the new top-level state
      return {
        ...prevContent,
        elements: newElements,
      }
    })
  }

  const addOption = () => {
    let optionList = options.list
    if (optionList.length === 8) return
    optionList.push(``)
    setOptions({ list: optionList })
  }

  const updateOption = (e, index) => {
    options.list[index] = e.target.value
    setOptions(options)
  }

  const delOption = (e, index) => {
    if (options.list.length === 2) return
    let optionList = []
    options.list.map((item, i) => {
      if (i !== index) optionList.push(``)
    })
    setOptions({ list: optionList })
  }

  const handleSearchProfile = async (e) => {
    const q = e.target.value

    if (q === '') {
      setFilteredProfiles()
      return
    }

    let filtered_wallets = []
    whitelist.list.map((profile) => filtered_wallets.push(profile.id))

    var myHeaders = new Headers()
    myHeaders.append('Content-Type', `application/json`)
    myHeaders.append('Accept', `application/json`)

    var requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: JSON.stringify({
        query: `query MyQuery {
  search_profiles(
    args: {search: "${q}"}
    limit: 5
    where: {id: {_nin: ${JSON.stringify(filtered_wallets)}}}
  ) {
    fullName
    id
    profileImages {
      src
    }
  }
}`,
      }),
    }
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_ENDPOINT}`, requestOptions)
    if (!response.ok) {
      throw new Response('Failed to ', { status: 500 })
    }
    const data = await response.json()
    console.log(data)
    setFilteredProfiles(data)
  }

  const handleAddWhitelist = async (e, profile, profileCardElement) => {
    console.log(whitelist.list)
    console.log(profile)
    // Check if the wallet address isn't repetitive
    if (whitelist.list.length > 0 && whitelist.list.find((item) => item.id === profile.id) !== undefined) return

    let newVal = whitelist.list
    newVal.push(profile)
    console.log(newVal)
    setWhitelist({ list: newVal })
    e.target.innerText = `Added`
    e.target.style.backgroundColor = `gray`

    // Close whitelist modal
    setFilteredProfiles()
    whitelistInputRef.current.value = ''
  }

  const handleRemoveWhitelist = (e, index) => {
    let newWhitelist = []
    whitelist.list.map((profile, i) => {
      if (i !== index) newWhitelist.push(profile)
    })
    console.log(newWhitelist)
    setWhitelist({ list: newWhitelist })
  }

  /**
   * Function to get the text currently selected by the cursor in a textarea.
   * @param {HTMLTextAreaElement} textarea - The textarea element to check.
   * @returns {string} The selected text.
   */
  function getSelectedText() {
    const textarea = document.querySelector(`[name="q"]`)
    const value = textarea.value
    // 1. Get the starting index of the selection
    const start = textarea.selectionStart

    // 2. Get the ending index of the selection
    const end = textarea.selectionEnd

    // 3. Use the 'substring' method on the textarea's whole value,
    //    passing the start and end indices.
    const selectedText = value.substring(start, end)

    return { start, end, selectedText, value, textarea }
  }

  /**
   * Inserts a string into another string at a specified index.
   * @param {string} originalString - The string to insert into.
   * @param {string} stringToInsert - The string to be added.
   * @param {number} index - The index where the insertion should occur.
   * @returns {string} The new combined string.
   */
  function insertStringAtIndex(originalString, stringToInsert, index) {
    // Ensure the index is within bounds
    const safeIndex = Math.max(0, Math.min(index, originalString.length))

    // 1. Get the part of the string BEFORE the insertion point (up to the index)
    const firstPart = originalString.slice(0, safeIndex)

    // 2. Get the part of the string AFTER the insertion point (starting from the index)
    const secondPart = originalString.slice(safeIndex)

    // 3. Concatenate the three parts: first part + new string + second part
    return firstPart + stringToInsert + secondPart
  }

  const makeBold = () => {
    const { start, end, selectedText, value, textarea } = getSelectedText()
    if (selectedText === '') return

    const startString = insertStringAtIndex(value, `**`, start)
    const endString = insertStringAtIndex(startString, `**`, end + 2)

    handleTextContentChange(endString)
    textarea.value = endString
  }

  const makeItalic = () => {
    const { start, end, selectedText, value, textarea } = getSelectedText()
    if (selectedText === '') return

    const startString = insertStringAtIndex(value, `*`, start)
    const endString = insertStringAtIndex(startString, `*`, end + 2)

    handleTextContentChange(endString)
    textarea.value = endString
  }

  // const mainTextIndex = postContent.elements.findIndex((el) => el.type === 'text')
  // const mediaBlockIndex = postContent.elements.findIndex((el) => el.type === 'media')
  // const initialText = 0 !== -1 ? postContent.elements[0].data.text : ''
  // const mediaItems = 1 !== -1 ? postContent.elements[1].data.items : []

  useEffect(() => {
    if (isConfirmed) {
      localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}post-content`, '')
      toast(`Post sent.`, `success`)
    }
  }, [isConfirmed])

  return (
    <div className={`${styles.postForm} flex flex-row align-items-start justify-content-between gap-1`}>
      <div className={`flex-1`}>
        {showForm === `poll` && (
          <form ref={createFormRef} className={`form flex flex-column gap-050`} onSubmit={(e) => handleCreatePoll(e)}>
            <div>
              <textarea
                type="text"
                name="q"
                placeholder={`What's up!`}
                defaultValue={content}
                onChange={(e) => setContent(e.target.value)}
                rows={10}
              />
              <small className={`text-secondary`}>Only the first 280 characters will be visible on the timeline.</small>
            </div>
            <div>
              Options:
              {options &&
                options.list.map((item, i) => {
                  return (
                    <div key={i} className={`flex mt-10 gap-1`}>
                      <input type="text" name={`option`} onChange={(e) => updateOption(e, i)} defaultValue={``} placeholder={`Option ${i + 1}`} />

                      <button type={`button`} className="btn" onClick={(e) => delOption(e, i)}>
                        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#fff">
                          <path d="M304.62-160q-27.62 0-46.12-18.5Q240-197 240-224.62V-720h-40v-40h160v-30.77h240V-760h160v40h-40v495.38q0 27.62-18.5 46.12Q683-160 655.38-160H304.62Zm87.69-120h40v-360h-40v360Zm135.38 0h40v-360h-40v360Z" />
                        </svg>
                      </button>
                    </div>
                  )
                })}
              {options.list.length < 8 && (
                <>
                  <div className={`mt-10`}>
                    <button className={`${styles.btnAddOption}`} type="button" onClick={(e) => addOption(e)}>
                      Add option
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className={`grid grid--fill grid--gap-1`} style={{ '--data-width': `200px` }}>
              <div>
                <label htmlFor={`startTime`}>Start time</label>
                <input type={`datetime-local`} name={`startTime`} required />
                <small>Start time must be at least a minute from now.</small>
              </div>

              <div>
                <label htmlFor={`endTime`}>End time</label>
                <input type={`datetime-local`} name={`endTime`} required />
              </div>
            </div>

            <div className={`flex flex-column`}>
              <label htmlFor={``}>Voting Limit</label>
              <input type={`number`} name={`votesPerAccount`} list={`sign-limit`} defaultValue={1} onChange={(e) => setVotingLimit(e.target.value)} />
              <small>Each account is limited to {votingLimit} votes for this poll.</small>
            </div>
            <div>
              <label htmlFor={`pollType`}>Poll Type</label>
              <select
                name={`pollType`}
                id=""
                onClick={(e) => {
                  const selectedOption = e.target.value
                  if (selectedOption === `1`) setShowWhitelist(true)
                  else setShowWhitelist(false)
                }}
              >
                <option value={0}>Public</option>
                <option value={1}>Private (Whitelisted)</option>
                <option value={2}>Only native token holders (LYX)</option>
                <option value={3}>Only tokens holder (LSP7)</option>
                <option value={4}>Only NFT holders (LSP8)</option>
              </select>
            </div>
            {showWhitelist && (
              <div className={`${styles['whitelist-container']} relative form-group`}>
                <label htmlFor={`whitelist`}>Whitelist</label>

                {whitelist && whitelist.list.length > 0 && (
                  <div className={`${styles['selected-whitelist']} grid grid--fill grid--gap-1`} style={{ '--data-width': `200px` }}>
                    {whitelist.list.map((profile, i) => {
                      return (
                        <div key={i} className={`d-flex grid--gap-050 ms-motion-slideDownIn`}>
                          <figure>
                            <img
                              src={`${
                                profile.profileImages.length > 0
                                  ? profile.profileImages[0].src
                                  : `https://ipfs.io/ipfs/bafkreic63gdzkdiye7vlcvbchillkszl6wbf2t3ysxcmr3ovpah3rf4h7i`
                              }`}
                              alt={`${profile.fullName}`}
                            />
                          </figure>
                          <div className={`w-100 d-flex flex-row align-items-center justify-content-between`}>
                            <div className={`d-flex flex-column`}>
                              <small className={`ms-fontWeight-bold`}>{profile.fullName}</small>
                              <span>{`${profile.id.slice(0, 4)}...${profile.id.slice(38)}`}</span>
                            </div>

                            <button
                              className={`rounded d-f-c`}
                              type={`button`}
                              title={`Clear ${profile.fullName}`}
                              onClick={(e) => handleRemoveWhitelist(e, i)}
                            >
                              close
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                <input
                  ref={whitelistInputRef}
                  type={`text`}
                  name={`whitelist`}
                  autoComplete={`off`}
                  placeholder={`Search profile by name or address`}
                  onChange={(e) => handleSearchProfile(e)}
                />

                {filteredProfiles && filteredProfiles?.data && (
                  <div className={`${styles['filter-profile']} ms-depth-8`}>
                    {filteredProfiles.data.search_profiles.map((profile, i) => {
                      return (
                        <div key={i} id={`profileCard${i}`} className={`d-flex grid--gap-050`}>
                          <figure>
                            <img
                              src={`${
                                profile.profileImages.length > 0
                                  ? profile.profileImages[0].src
                                  : `https://ipfs.io/ipfs/bafkreic63gdzkdiye7vlcvbchillkszl6wbf2t3ysxcmr3ovpah3rf4h7i`
                              }`}
                              alt={`${profile.fullName}`}
                            />
                          </figure>
                          <div className={`w-100 d-flex flex-row align-items-center justify-content-between`}>
                            <div className={`d-flex flex-column`}>
                              <b>{profile.fullName}</b>
                              <span>{`${profile.id.slice(0, 4)}…${profile.id.slice(38)}`}</span>
                            </div>
                            <button className={`btn`} type={`button`} onClick={(e) => handleAddWhitelist(e, profile, `profileCard${i}`)}>
                              Add profile
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            <div>
              <label htmlFor={`token`}>Token</label>
              <select name="token" id="">
                <option value={`0x0000000000000000000000000000000000000000`}>$LYX</option>
                <option value={`0x59a070edc7d5c621a845ddbdfafbbde9f25dbc70`}>$ARATTA</option>
                <option value={`0x00ecc3275aeb551ec553bfcb966cd0813ecf2935`}>$FISH</option>
              </select>
            </div>

            <div>
              <label htmlFor={`holderAmount`}>Amount</label>
              <input type={`number`} name={`holderAmount`} defaultValue={0} />
            </div>

            <div>
              <label htmlFor={`allowComments`}>Allow comments</label>
              <select name={`allowComments`} id="">
                <option value={true}>Yes</option>
                <option value={false}>No</option>
              </select>
            </div>

            <div className={`mt-10`}>
              <button className={`btn`} type="submit">
                {status.pending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        )}

        {/* {showForm === `post` && ( */}
        <form ref={createFormRef} className={`form flex flex-column gap-050 ${styles.postForm}`} onSubmit={(e) => handleCreatePost(e)}>
          <div className={`form-group ${styles.postForm__postContent}`}>
            <ul className={`flex gap-025`}>
              <li>
                <button type="button" style={{ width: `20px` }} onClick={() => makeBold()}>
                  B
                </button>
              </li>
              <li>
                <button type="button" style={{ width: `20px` }} onClick={() => makeItalic()}>
                  <i>I</i>
                </button>
              </li>
            </ul>

            {/* HIDDEN FILE INPUT */}
            <input type="file" ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }} multiple={false} />

            {/* --- Text Editor --- */}
            <div className="mb-6">
              <textarea
                className="w-full p-4 border border-gray-300 rounded-lg focus:ring-4 focus:ring-indigo-200 focus:border-indigo-500 transition duration-150 resize-none text-gray-800"
                name="q"
                placeholder="What's happening?"
                value={postContent && postContent.elements[0].data.text}
                onChange={(e) => handleTextContentChange(e.target.value)}
                rows={5}
              />
            </div>

            <small className={`text-secondary`}>Only the first 280 characters will be visible on the timeline.</small>
          </div>

          <div>
            <label htmlFor={`allowComments`}>Allow comments</label>
            <select name={`allowComments`} id="">
              <option value={true}>Yes</option>
              <option value={false}>No</option>
            </select>
          </div>

          <>
            <h3 className="text-lg font-medium text-gray-700 mb-3 flex items-center">
              {/* <Image className="w-5 h-5 mr-2 text-indigo-500" /> */}
              Media Gallery ({postContent && postContent.elements[1].data.items.length})
            </h3>

            <div className="flex flex-wrap gap-4 mb-4">
              {isUploading && <ContentSpinner />}
              {postContent &&
                postContent.elements[1].data.items.map((item, index) => (
                  <div key={index} className="">
                    <div className="" style={{ width: `100px`, height: `100px`, backgroundColor: item.type === 'image' ? '#3B82F6' : '#DC2626' }}>
                      {item.type === 'image' ? (
                        <>
                          <figure>
                            <img src={item.localUrl} alt="" style={{ aspectRatio: `1/1` }} />
                          </figure>
                        </>
                      ) : (
                        <video src={item.localUrl} controls style={{ aspectRatio: `1/1` }} />
                      )}
                    </div>

                    <button type={`button`} onClick={() => handleRemoveMedia(index)} aria-label={`Remove ${item.type}`}>
                      remove
                    </button>
                  </div>
                ))}
            </div>
          </>

          <div className={`mt-10 flex gap-1`}>
            <button className={`btn`} type="submit" disabled={isSigning}>
              {isConfirming ? `Posting...` : isSigning ? `Signing...` : 'Post'}
            </button>

            <button
              className="btn"
              style={{ background: `var(--orange-500)` }}
              type={`button`}
              onClick={(e) => triggerFileInput(e, `image`)}
              disabled={postContent.elements[1].data.items.length === 4 || isUploading}
            >
              Add image
            </button>
            <button
              className="btn"
              style={{ background: `var(--orange-500)` }}
              type={`button`}
              onClick={(e) => triggerFileInput(e, `video`)}
              disabled={postContent.elements[1].data.items.length === 4 || isUploading}
            >
              Add video
            </button>
          </div>
        </form>

        {!mounted && isConnected && (
          <ul className={`flex ${styles.post__actions}`}>
            <li title={`Write post`} onClick={() => setShowForm(`post`)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M5 19H6.098L16.7962 8.302L15.698 7.20375L5 17.902V19ZM4 20V17.4807L17.1807 4.2865C17.2832 4.19517 17.3963 4.12458 17.52 4.07475C17.6438 4.02492 17.7729 4 17.9072 4C18.0416 4 18.1717 4.02117 18.2977 4.0635C18.4236 4.10583 18.5397 4.18208 18.6462 4.29225L19.7135 5.3655C19.8237 5.47183 19.899 5.5885 19.9395 5.7155C19.9798 5.84267 20 5.96975 20 6.09675C20 6.23225 19.9772 6.36192 19.9315 6.48575C19.8858 6.60942 19.8132 6.7225 19.7135 6.825L6.51925 20H4ZM16.2375 7.7625L15.698 7.20375L16.7962 8.302L16.2375 7.7625Z"
                  fill="#1F1F1F"
                />
              </svg>
            </li>
            <li title={`Attach media`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5.6155 20C5.15517 20 4.77083 19.8458 4.4625 19.5375C4.15417 19.2292 4 18.8448 4 18.3845V5.6155C4 5.15517 4.15417 4.77083 4.4625 4.4625C4.77083 4.15417 5.15517 4 5.6155 4H18.3845C18.8448 4 19.2292 4.15417 19.5375 4.4625C19.8458 4.77083 20 5.15517 20 5.6155V18.3845C20 18.8448 19.8458 19.2292 19.5375 19.5375C19.2292 19.8458 18.8448 20 18.3845 20H5.6155ZM5.6155 19H18.3845C18.5385 19 18.6796 18.9359 18.8077 18.8077C18.9359 18.6796 19 18.5385 19 18.3845V5.6155C19 5.4615 18.9359 5.32042 18.8077 5.19225C18.6796 5.06408 18.5385 5 18.3845 5H5.6155C5.4615 5 5.32042 5.06408 5.19225 5.19225C5.06408 5.32042 5 5.4615 5 5.6155V18.3845C5 18.5385 5.06408 18.6796 5.19225 18.8077C5.32042 18.9359 5.4615 19 5.6155 19ZM7.5 16.5H16.6538L13.827 12.7308L11.2115 16.0385L9.4615 13.923L7.5 16.5Z" />
              </svg>
            </li>
            <li title={`Add a gif`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5.6155 20C5.15517 20 4.77083 19.8458 4.4625 19.5375C4.15417 19.2292 4 18.8448 4 18.3845V5.6155C4 5.15517 4.15417 4.77083 4.4625 4.4625C4.77083 4.15417 5.15517 4 5.6155 4H18.3845C18.8448 4 19.2292 4.15417 19.5375 4.4625C19.8458 4.77083 20 5.15517 20 5.6155V18.3845C20 18.8448 19.8458 19.2292 19.5375 19.5375C19.2292 19.8458 18.8448 20 18.3845 20H5.6155ZM5.6155 19H18.3845C18.5385 19 18.6796 18.9359 18.8077 18.8077C18.9359 18.6796 19 18.5385 19 18.3845V5.6155C19 5.4615 18.9359 5.32042 18.8077 5.19225C18.6796 5.06408 18.5385 5 18.3845 5H5.6155C5.4615 5 5.32042 5.06408 5.19225 5.19225C5.06408 5.32042 5 5.4615 5 5.6155V18.3845C5 18.5385 5.06408 18.6796 5.19225 18.8077C5.32042 18.9359 5.4615 19 5.6155 19Z" />
                <path d="M11.3333 14V10H12.3333V14H11.3333ZM7.66667 14C7.46667 14 7.30556 13.9306 7.18333 13.7917C7.06111 13.6528 7 13.5 7 13.3333V10.6667C7 10.5 7.06111 10.3472 7.18333 10.2083C7.30556 10.0694 7.46667 10 7.66667 10H9.66667C9.86667 10 10.0278 10.0694 10.15 10.2083C10.2722 10.3472 10.3333 10.5 10.3333 10.6667V11H8V13H9.33333V12H10.3333V13.3333C10.3333 13.5 10.2722 13.6528 10.15 13.7917C10.0278 13.9306 9.86667 14 9.66667 14H7.66667ZM13.3333 14V10H16.3333V11H14.3333V11.6667H15.6667V12.6667H14.3333V14H13.3333Z" />
              </svg>
            </li>
            <li title={`Add a poll`} onClick={() => setShowForm(`poll`)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 10H16.6155V9H12V10ZM12 15H16.6155V14H12V15ZM9 10.7307C9.34483 10.7307 9.63617 10.6118 9.874 10.374C10.1118 10.1362 10.2308 9.84483 10.2308 9.5C10.2308 9.15517 10.1118 8.86383 9.874 8.626C9.63617 8.38817 9.34483 8.26925 9 8.26925C8.65517 8.26925 8.36383 8.38817 8.126 8.626C7.88817 8.86383 7.76925 9.15517 7.76925 9.5C7.76925 9.84483 7.88817 10.1362 8.126 10.374C8.36383 10.6118 8.65517 10.7307 9 10.7307ZM9 15.7308C9.34483 15.7308 9.63617 15.6118 9.874 15.374C10.1118 15.1362 10.2308 14.8448 10.2308 14.5C10.2308 14.1552 10.1118 13.8638 9.874 13.626C9.63617 13.3882 9.34483 13.2692 9 13.2692C8.65517 13.2692 8.36383 13.3882 8.126 13.626C7.88817 13.8638 7.76925 14.1552 7.76925 14.5C7.76925 14.8448 7.88817 15.1362 8.126 15.374C8.36383 15.6118 8.65517 15.7308 9 15.7308ZM5.6155 20C5.15517 20 4.77083 19.8458 4.4625 19.5375C4.15417 19.2292 4 18.8448 4 18.3845V5.6155C4 5.15517 4.15417 4.77083 4.4625 4.4625C4.77083 4.15417 5.15517 4 5.6155 4H18.3845C18.8448 4 19.2292 4.15417 19.5375 4.4625C19.8458 4.77083 20 5.15517 20 5.6155V18.3845C20 18.8448 19.8458 19.2292 19.5375 19.5375C19.2292 19.8458 18.8448 20 18.3845 20H5.6155ZM5.6155 19H18.3845C18.5385 19 18.6796 18.9359 18.8077 18.8077C18.9359 18.6796 19 18.5385 19 18.3845V5.6155C19 5.4615 18.9359 5.32042 18.8077 5.19225C18.6796 5.06408 18.5385 5 18.3845 5H5.6155C5.4615 5 5.32042 5.06408 5.19225 5.19225C5.06408 5.32042 5 5.4615 5 5.6155V18.3845C5 18.5385 5.06408 18.6796 5.19225 18.8077C5.32042 18.9359 5.4615 19 5.6155 19Z" />
              </svg>
            </li>
          </ul>
        )}
      </div>
    </div>
  )
}

const CommentModal = ({ item, setShowCommentModal }) => {
  const [hasLiked, setHasLiked] = useState(false)
  const [loading, setLoading] = useState(true)
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
    <div className={`${styles.commentModal} animate fade`} onClick={() => setShowCommentModal()}>
      <div className={`${styles.commentModal__container}`} onClick={(e) => e.stopPropagation()}>
        <header className={`${styles.commentModal__container__header}`}>
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

        <main className={`${styles.commentModal__container__main}`}>
          <article className={`${styles.commentModal__post}`}>
            <section className={`flex flex-column align-items-start justify-content-between`}>
              <header className={`${styles.commentModal__post__header}`}>
                <Profile creator={item.creator} createdAt={item.createdAt} />
              </header>
              <main className={`${styles.commentModal__post__main} w-100 flex flex-column grid--gap-050`}>
                <div
                  className={`${styles.post__content} `}
                  // onClick={(e) => e.stopPropagation()}
                  id={`post${item.postId}`}
                >
                  {item.content}
                </div>
              </main>
            </section>
          </article>
        </main>

        <footer className={`${styles.commentModal__footer}  flex flex-column align-items-start`}>
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
  const { address, isConnected } = useConnection()
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
    <button onClick={(e) => (hasLiked ? unlikePost(e, id) : likePost(e, id))}>
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
