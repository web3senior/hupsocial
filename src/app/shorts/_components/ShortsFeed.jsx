'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useConnection } from 'wagmi'
import { getPosts } from '@/lib/api'
import { ArrowDownIcon, ArrowUpIcon } from '@phosphor-icons/react'
import { useMutedPreference, setMutedPreference } from '@/lib/soundPrefs'
import { ContentSpinner } from '@/components/Loading'
import FeedError from '@/components/ui/FeedError'
import ShortsPlayer from './ShortsPlayer'
import styles from './ShortsFeed.module.scss'

// Must stay consistent across calls: the API's offset is (page - 1) * limit, so mixing page
// sizes shifts the window and re-fetches rows that are already on screen.
const PAGE_SIZE = 10

// How close to the end of the loaded rail the reader has to get before the next page is
// requested. Three slides is enough runway to fetch without the rail ever hitting a dead end.
const PREFETCH_WITHIN = 3

// Where the rail leaves a bookmark for itself. Tapping through to a post's comments is a real
// navigation, so coming back remounts this component with an empty rail — the slide the reader
// was on has to survive somewhere outside React. sessionStorage scopes it to the tab, so the
// bookmark cannot outlive the visit it belongs to.
const LAST_SLIDE_KEY = 'hup:shorts:last-slide'

// The bookmark answers one round trip, not the whole tab. It is written only when the reader
// follows a link out of the rail, spent by the restore that reads it, and ignored once it is
// this old — so opening Shorts deliberately always starts at the newest video, which is where
// anything posted since the reader was last here has landed.
const BOOKMARK_TTL_MS = 30 * 60 * 1000

// How far the restore is allowed to page forward hunting for the saved post. Someone who
// scrolled deeper than this lands at the top rather than waiting out a long silent load.
const RESTORE_MAX_PAGES = 5

/* Storage access is wrapped both ways: a browser in private mode throws on setItem rather than
   returning, and a rail that cannot remember its position is still a working rail. */
const readLastSlide = () => {
  try {
    const raw = sessionStorage.getItem(LAST_SLIDE_KEY)
    if (!raw) return null

    const { key, at } = JSON.parse(raw)
    if (!key || !at || Date.now() - at > BOOKMARK_TTL_MS) return null
    return key
  } catch {
    /* including a payload left by an older build, which parses as garbage rather than a slide */
    return null
  }
}

const writeLastSlide = (key) => {
  try {
    sessionStorage.setItem(LAST_SLIDE_KEY, JSON.stringify({ key, at: Date.now() }))
  } catch {
    /* not being able to remember the slide is not worth breaking playback over */
  }
}

const clearLastSlide = () => {
  try {
    sessionStorage.removeItem(LAST_SLIDE_KEY)
  } catch {
    /* nothing to recover from: a store that cannot be read held no bookmark to clear */
  }
}

/* Media lives at elements[1].data.items[]; the text element is elements[0]. Posts predating a
   given element shape still parse, so both lookups stay defensive. */
const getVideoItem = (post) =>
  post?.content?.elements?.[1]?.data?.items?.find((item) => item?.type === 'video') || null

const getCaption = (post) => post?.content?.elements?.[0]?.data?.text?.trim() || ''

const postKey = (post) => `${post.network_id}:${post.id}`

/**
 * Vertical, one-video-at-a-time rail over every post carrying a video attachment.
 *
 * The feed comes from the same posts endpoint the home feed uses (feed_type=shorts), so
 * visibility rules, reposts, and moderation behave identically here — this component only
 * changes how they are presented.
 */
export default function ShortsFeed() {
  const { address } = useConnection()
  const isMuted = useMutedPreference()

  const [posts, setPosts] = useState([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  /* Held from mount until the restore below has settled on a slide. Without it a restore that
     has to page forward renders the rail as soon as page 1 lands, so slide 0 appears and starts
     playing for as long as the remaining pages take — then jumps. */
  const [isRestoring, setIsRestoring] = useState(true)

  const railRef = useRef(null)
  const slideRefs = useRef([])
  /* The request currently in flight, if any — held rather than a boolean flag so a second
     caller can wait on it instead of being turned away empty-handed. */
  const inFlightRef = useRef(null)

  /* The loaded list and its paging state, mirrored outside React: the restore below runs as one
     async pass and has to see what the call it just awaited produced, which state cannot give it
     until the next render. */
  const postsRef = useRef([])
  const hasMoreRef = useRef(true)

  /* The index the rail owes the reader a scroll to, handed from the async restore to the layout
     effect that can only run once the slides exist. */
  const pendingRestoreRef = useRef(null)

  const toggleMute = useCallback(() => setMutedPreference(!isMuted), [isMuted])

  /* Scrolls the rail rather than calling scrollIntoView on the slide: the slide is inside a
     scroll container AND the page, and scrollIntoView would move both. Snapping then settles
     the exact position, so this only has to land in the right slide. */
  const goToSlide = useCallback(
    (index) => {
      const rail = railRef.current
      if (!rail) return
      rail.scrollTo({ top: index * rail.clientHeight, behavior: 'smooth' })
    },
    []
  )

  /**
   * Loads one page and appends it. Page 1 replaces instead, so a viewer change refreshes the
   * rail without a separate reset pass. Resolves with the merged list, or null if the page
   * could not be loaded — the restore below has to see what it got back.
   */
  const loadPage = useCallback(
    (nextPage) => {
      /* A caller arriving while a fetch is in flight waits on that request rather than dropping
         out with nothing. Turning it away was enough while the observer was the only duplicate
         caller, but the restore below needs the list back — and React's development double-mount
         runs the effect that starts it twice, so the pass that survives is the second one, the
         one that would be handed the refusal. */
      if (inFlightRef.current) return inFlightRef.current

      const request = (async () => {
        try {
          const response = await getPosts(nextPage, PAGE_SIZE, null, null, address, null, 'shorts')
          if (!response.success) throw new Error(response.error || 'Request failed')

          /* A post can match feed_type=shorts (has_video is set at the row level) while its video
             sits in a shape this component can't read — drop those rather than render a slide
             with nothing in it. */
          const playable = response.data.filter(getVideoItem)

          /* Merged against the ref rather than inside a functional update, so the merged list is
             available to this call's caller immediately — a setState updater does not run until
             React renders, which is after the restore needs to read it. */
          const previous = postsRef.current
          const seen = new Set(previous.map(postKey))
          const merged =
            nextPage === 1 ? playable : [...previous, ...playable.filter((post) => !seen.has(postKey(post)))]

          postsRef.current = merged
          hasMoreRef.current = Boolean(response.nextPage)

          setPosts(merged)
          setHasMore(hasMoreRef.current)
          setPage(nextPage)
          setLoadError(false)
          return merged
        } catch (error) {
          console.error('[shorts] could not load feed:', error)
          /* Only a failed first page is worth blanking the rail for — a failed later page leaves
             what is already loaded playable. */
          if (nextPage === 1) setLoadError(true)
          hasMoreRef.current = false
          setHasMore(false)
          return null
        } finally {
          setIsLoading(false)
        }
      })()

      inFlightRef.current = request
      /* Cleared by identity, so a settled request can never clear its successor's slot. The
         inner function swallows its own errors, so this never sees a rejection. */
      request.then(() => {
        if (inFlightRef.current === request) inFlightRef.current = null
      })

      return request
    },
    [address]
  )

  // Loads page 1, then — if the reader left the rail on a slide — keeps paging forward until
  // that post is back on the rail.
  useEffect(() => {
    let cancelled = false

    const initialize = async () => {
      const savedKey = readLastSlide()

      let list = await loadPage(1)
      if (cancelled) return

      let pagesLoaded = 1
      while (
        savedKey &&
        list &&
        !list.some((post) => postKey(post) === savedKey) &&
        hasMoreRef.current &&
        pagesLoaded < RESTORE_MAX_PAGES
      ) {
        pagesLoaded += 1
        list = await loadPage(pagesLoaded)
        if (cancelled) return
      }

      const index = savedKey && list ? list.findIndex((post) => postKey(post) === savedKey) : -1
      if (index > 0) {
        /* Set here rather than left to the observer, so the slide being restored to is the one
           that starts playing — not slide 0 for a frame first. */
        setActiveIndex(index)
        pendingRestoreRef.current = index
      }

      /* Spent here rather than at the read: React's development double-mount runs this pass
         twice and cancels the first one mid-flight, so clearing on read would let the cancelled
         pass swallow the bookmark and land the surviving one at the top. Everything above has
         already cleared its cancellation checks by this point. */
      clearLastSlide()
      setIsRestoring(false)
    }

    initialize()

    return () => {
      cancelled = true
    }
  }, [loadPage])

  /* The scroll can only happen once the slides are on the page, and it has to happen before
     paint — landing on the saved slide should look like the rail was never anywhere else. Every
     slide is exactly one rail height, so there is nothing still to load that could move the
     target afterwards and no need to re-assert it across frames. */
  useLayoutEffect(() => {
    const index = pendingRestoreRef.current
    if (index === null) return

    const rail = railRef.current
    /* Left pending rather than dropped if the slide is not mounted yet — the next render retries */
    if (!rail || !slideRefs.current[index]) return

    pendingRestoreRef.current = null
    /* 'instant' overrides the app's global scroll-behavior: smooth — a plain scrollTo animates
       the restore, which IS the visible crawl down from the top of the rail. */
    rail.scrollTo({ top: index * rail.clientHeight, behavior: 'instant' })
  }, [posts, activeIndex])

  /* Remembers where the reader is at the one moment worth remembering: following a link out of
     the rail — a slide's author, its comments — is the departure they expect to come back from.
     Leaving any other way writes nothing, so the next deliberate visit opens on the newest video
     rather than pinning the reader to a slide they already watched while everything posted since
     sits above it, unseen.

     Capture phase, on the rail rather than per slide: the links belong to ShortsPlayer, and a
     handler there would have to be threaded through Profile and Share as well. */
  useEffect(() => {
    const rail = railRef.current
    const post = posts[activeIndex]
    if (!rail || !post) return

    const rememberOnLeave = (event) => {
      const anchor = event.target?.closest?.('a[href]')
      if (!anchor) return

      /* A share link opening elsewhere is not a departure — this rail is still standing behind
         it, and a bookmark written here would be left for the next real visit to spend. */
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.origin !== window.location.origin) return

      writeLastSlide(postKey(post))
    }

    rail.addEventListener('click', rememberOnLeave, true)
    return () => rail.removeEventListener('click', rememberOnLeave, true)
  }, [activeIndex, posts])

  // One observer for the whole rail: whichever slide is mostly on screen becomes the active one,
  // and it is the only slide allowed to play. Paging happens from here too — the reader reaching
  // the tail of the rail is exactly the signal to fetch more, and a subscription callback is the
  // right place to react to it.
  useEffect(() => {
    if (!posts.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return

          const index = Number(entry.target.dataset.index)
          if (!Number.isInteger(index)) return

          setActiveIndex(index)
          if (hasMore && index >= posts.length - PREFETCH_WITHIN) loadPage(page + 1)
        })
      },
      { root: railRef.current, threshold: 0.6 }
    )

    slideRefs.current.filter(Boolean).forEach((slide) => observer.observe(slide))
    return () => observer.disconnect()
  }, [posts.length, hasMore, page, loadPage])

  if (isRestoring || (isLoading && !posts.length)) return <ContentSpinner />

  if (loadError) return <FeedError onRetry={() => loadPage(1)} />

  if (!posts.length) {
    return (
      <div className={styles.shortsFeed__empty}>
        <h2>No videos yet</h2>
        <p>Posts with a video attached show up here. Add one to a post and it lands in the rail.</p>
      </div>
    )
  }

  return (
    <div className={styles.shortsFeed__stage}>
      <div className={styles.shortsFeed} ref={railRef}>
        {posts.map((post, index) => (
          <div
            key={postKey(post)}
            className={styles.shortsFeed__slide}
            data-index={index}
            ref={(element) => {
              slideRefs.current[index] = element
            }}
          >
            <ShortsPlayer
              post={post}
              video={getVideoItem(post)}
              caption={getCaption(post)}
              isActive={index === activeIndex}
              isMuted={isMuted}
              onToggleMute={toggleMute}
            />
          </div>
        ))}
      </div>

      {/* Scroll-snap alone leaves no affordance on a desktop pointer — a mouse has no flick */}
      <div className={styles.shortsFeed__nav}>
        <button
          type="button"
          className={styles.shortsFeed__navButton}
          onClick={() => goToSlide(activeIndex - 1)}
          disabled={activeIndex === 0}
          aria-label="Previous video"
        >
          <ArrowUpIcon size={22} />
        </button>
        <button
          type="button"
          className={styles.shortsFeed__navButton}
          onClick={() => goToSlide(activeIndex + 1)}
          disabled={activeIndex >= posts.length - 1}
          aria-label="Next video"
        >
          <ArrowDownIcon size={22} />
        </button>
      </div>
    </div>
  )
}
