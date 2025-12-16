'use client'

import { useState, useEffect, lazy, Suspense, useId, useRef, useCallback } from 'react'
import Link from 'next/link'
import moment from 'moment'
import { useRouter } from 'next/navigation'
import {
  useConnectorClient,
  useClient,
  networks,
  useWaitForTransactionReceipt,
  useDisconnect,
  Connector,
  useConnect,
  useWriteContract,
  useReadContract,
  useConnection,
} from 'wagmi'
import {
  initPostContract,
  initPostCommentContract,
  getPosts,
  getHasLikedPost,
  getPollLikeCount,
  getPostCount,
  getVoteCountsForPoll,
  getVoterChoices,
} from '@/lib/communication'
import { getApps, getProfile, getUniversalProfile } from '@/lib/api'
import PollTimer from '@/components/PollTimer'
import Profile from '@/components/Profile'
import { useAuth } from '@/contexts/AuthContext'
import Web3 from 'web3'
import { isPollActive } from '@/lib/utils'
import { useClientMounted } from '@/hooks/useClientMount'
import { config } from '@/config/wagmi'
import abi from '@/abi/post.json'
import { getActiveChain } from '@/lib/communication'
import { toast } from '@/components/NextToast'
import Shimmer from '@/components/ui/Shimmer'
import { CommentIcon, ShareIcon, RepostIcon, TipIcon, InfoIcon, BlueCheckMarkIcon, ThreeDotIcon, ViewIcon } from '@/components/Icons'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import Post from '@/components/Post'
import PageTitle from '@/components/PageTitle'
import NoData from '@/components/NoData'
import styles from './page.module.scss'

const PollsTab = lazy(() => import('@/components/tabs/PollsTab'))
const EventsTab = lazy(() => import('@/components/tabs/EventsTab'))
const AppsTab = lazy(() => import('@/components/tabs/AppsTab'))

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

export default function Page() {
  const [posts, setPosts] = useState({ list: [] })
  const [postsLoaded, setPostsLoaded] = useState(0)
  const [isLoadedPoll, setIsLoadedPoll] = useState(false)
  const [totalPosts, setTotalPosts] = useState(0)
  const [activeTab, setActiveTab] = useState('feed')
  const [apps, setApps] = useState({ list: [] })
  const { web3, contract } = initPostContract()
  const mounted = useClientMounted()
  const activeChain = getActiveChain()
  const { address, isConnected } = useConnection()
  const router = useRouter()
  const TABS_DATA = [
    { id: 'feed', label: 'Feed', count: totalPosts || 0 },
    { id: 'polls', label: 'Polls' },
    { id: 'events', label: 'Events' },
    { id: 'jobs', label: 'Jobs' },
    { id: 'apps', label: 'Apps' },
  ]
  const TabContentMap = {
    polls: PollsTab,
    events: EventsTab,
    //  jobs: JobsTab,
    apps: AppsTab,
    // feed: FeedTab,
  }
  const ActiveComponent = TabContentMap[activeTab]

  const loadMorePosts = async (totalPosts) => {
    // Use a sensible page size (10 is better than 1 for performance)
    const POSTS_PER_PAGE = 10

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
      const startIndex = postsLoaded + 1

      // Calculate the actual number of posts remaining and limit to POSTS_PER_PAGE.
      const remainingPosts = totalPosts - postsLoaded
      const postsToFetch = Math.min(POSTS_PER_PAGE, remainingPosts)

      // Safety check (should be redundant if the initial guard passes)
      if (postsToFetch <= 0) {
        console.log('No posts to fetch after calculation.')
        return
      }

      // console.log(`Fetching batch: Start Index ${startIndex}, Count ${postsToFetch}`)
      // 3. Fetch the next batch of posts (the contract handles reverse order internally)
      // Note: startIndex is passed as the 1-based chronological position.

      const newPosts = await getPosts(startIndex, postsToFetch, address)

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

  /**
   * - scrollContainerRef: A React Ref attached to the scrollable DOM element.
   * - totalPosts: The total number of posts available from the contract.
   * - postsLoaded: The number of posts currently rendered.
   * - isLoadedPoll: The loading lock (set by loadMorePosts).
   * - loadMorePosts: The function to fetch the next batch.
   */
  const handleScroll = () => {
    const scrollElement = document.documentElement

    // 1. Guard against a null reference (element not yet mounted)
    if (!scrollElement) return

    // Destructuring values for clarity
    const {
      scrollTop, // The distance from the top of the element to the top of the viewport
      clientHeight, // The height of the visible part of the container
      scrollHeight, // The total height of the content inside the container
    } = scrollElement

    // Define a threshold (e.g., load posts when 300px from the bottom)
    const SCROLL_THRESHOLD = 200

    // 2. Check if the user is near the bottom
    // scrollTop + clientHeight = how far the bottom of the viewport is from the top of the content
    // scrollHeight - SCROLL_THRESHOLD = the point before the very end of the content
    const isNearBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD

    // 3. Check for available posts and the loading lock
    const hasMorePosts = postsLoaded < totalPosts

    // 4. Trigger load only if all conditions are met
    if (isNearBottom && hasMorePosts && !isLoadedPoll) {
      console.log('Scrolled near bottom. Triggering load.')
      loadMorePosts(totalPosts)
    }
  }

  useEffect(() => {
    getApps(activeChain[0].id).then((res) => {
      console.log(res)
      setApps({ list: res })
    })

    if (mounted) {
      getPostCount().then((count) => {
        const totalPosts = web3.utils.toNumber(count)
        setTotalPosts(totalPosts)

        if (postsLoaded === 0 && !isLoadedPoll) {
          loadMorePosts(totalPosts)
        }
      })
    }

    if (document) {
      document.addEventListener('scroll', handleScroll)
      // Clean up the event listener when the component unmounts or dependencies change
      return () => {
        document.removeEventListener('scroll', handleScroll)
      }
    }
  }, [totalPosts, postsLoaded, isLoadedPoll, address, mounted])

  return (
    <>
      <PageTitle name={`home`} />
      <div className={`__container`} data-width={`medium`}>
        <section className={styles.tab}>
          <div className={`${styles.tab__container} flex align-items-center justify-content-around`}>
            {TABS_DATA.map((tab) => (
              <button key={tab.id} className={activeTab === tab.id ? styles.activeTab : ''} onClick={() => setActiveTab(tab.id)}>
                <span>{tab.label}</span>
                {tab.count && (
                  <span
                    className={`lable lable-pill`}
                    style={{
                      background: `var(--network-color-primary)`,
                      color: `var(--network-color-text)`,
                    }}
                  >
                    {new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(tab.count)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>
      </div>

      <Suspense fallback={<div>Loading Tab Content...</div>}>{ActiveComponent && <ActiveComponent />}</Suspense>

      {activeTab === 'feed' && (
        <div className={`${styles.tabContent} ${styles.feedTab} relative`}>
          <div className={`${styles.page} ms-motion-slideDownIn`}>
            <div className={`__container ${styles.page__container}`} data-width={`medium`}>
              {posts.list.length < 1 && (
                <>
                  <PostShimmer />
                  <PostShimmer />
                  <PostShimmer />
                  <PostShimmer />
                  <PostShimmer />
                </>
              )}

              <div className={`${styles.grid} flex flex-column`}>
                {posts &&
                  posts.list.length > 0 &&
                  posts.list.map((item, i) => {
                    return (
                      <section
                        key={i}
                        className={`${styles.post} animate fade`}
                        onClick={() => {
                          navigator.vibrate(200)
                          router.push(`${activeChain[0].id}/p/${item.postId}`)
                        }}
                      >
                        <Post item={item} actions={[`like`, `comment`, `repost`, `share`]} />
                        {i < posts.list.length - 1 && <hr />}
                      </section>
                    )
                  })}
              </div>
            </div>

            {postsLoaded !== totalPosts && (
              <button className={`${styles.loadMore}`} onClick={() => loadMorePosts(totalPosts)}>
                Load More
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const PostShimmer = () => {
  return (
    <div className={`${styles.pageShimmer} flex flex-column gap-025`}>
      <div className={`flex flex-row gap-050`}>
        <div className={`shimmer rounded`} style={{ width: `36px`, height: `36px` }} />
        <div className={`flex flex-column gap-050`}>
          <div className={`shimmer rounded`} style={{ width: `100px`, height: `12px` }} />
          <div className={`shimmer rounded`} style={{ width: `100px`, height: `10px` }} />
        </div>
      </div>
      <div className={`shimmer rounded`} style={{ marginLeft: `3rem`, width: `80%`, height: `10px` }} />
      <div className={`shimmer rounded`} style={{ marginLeft: `3rem`, width: `60%`, height: `10px` }} />
      <ul className={`flex gap-1 mt-10`} style={{ marginLeft: `3rem` }}>
        <li>
          <div className={`shimmer rounded`} style={{ width: `25px`, height: `25px` }} />
        </li>
        <li>
          <div className={`shimmer rounded`} style={{ width: `25px`, height: `25px` }} />
        </li>
        <li>
          <div className={`shimmer rounded`} style={{ width: `25px`, height: `25px` }} />
        </li>
        <li>
          <div className={`shimmer rounded`} style={{ width: `25px`, height: `25px` }} />
        </li>
      </ul>
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
                isPollActive(item.startTime, item.endTime).status === `endeed` ? styles.poll__options__optionEndeed : styles.poll__options__option
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

const NetworksFallback = () => {
  return (
    <>
      {Array.from({ length: 4 }, (_, i) => (
        <ShimmerCard key={i} />
      ))}
    </>
  )
}

const ShimmerCard = () => {
  return (
    <div className={`${styles.shimmer} flex align-items-center justify-content-between`}>
      <div className={`flex align-items-center justify-content-between gap-050`}>
        <Shimmer style={{ borderRadius: `0`, width: `24px`, height: `24px` }} />
        <Shimmer style={{ borderRadius: `20px`, width: `70px`, height: `12px` }} />
      </div>
      <Shimmer style={{ borderRadius: `20px`, width: `90px`, height: `27px` }} />
    </div>
  )
}
