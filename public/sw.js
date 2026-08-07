// --- Cache configuration ---

// Bump when the strategies below change: activate deletes every cache not listed here.
const CACHE_VERSION = 'v1'
const SHELL_CACHE = `hup-shell-${CACHE_VERSION}`
const ASSET_CACHE = `hup-assets-${CACHE_VERSION}`
// Holds one incoming OS share between the POST and /share reading it. Listed below so
// `activate` treats it as a live cache instead of sweeping it.
const SHARE_CACHE = 'hup-share-v1'
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE, SHARE_CACHE]

const OFFLINE_URL = '/offline'
const APP_SHELL_URL = '/'

// Web Share Target. `SHARE_ACTION_PATH` is what the manifest points at; the last three
// constants are mirrored in src/lib/shareTarget.js, which reads what this file writes.
const SHARE_ACTION_PATH = '/api/share'
const SHARE_LANDING_URL = '/share'
const SHARE_PAYLOAD_KEY = '/__share-payload'
const SHARE_FILE_PREFIX = '/__share-file-'

// `next dev` rebuilds chunks behind stable URLs, so cache-first would hand an HMR session a
// stale bundle. Dev stays network-first everywhere and only reads the cache when the network
// is genuinely gone.
const IS_DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname)

// Non-hashed static files (icons, fonts). Hashed build output is matched by path instead.
const ASSET_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf)$/i

// --- Cache helpers ---

// Redirected responses are excluded deliberately: replaying one for a navigation whose redirect
// mode isn't "follow" makes the browser fail the whole FetchEvent.
const isCacheable = (response) => Boolean(response) && response.status === 200 && response.type === 'basic' && !response.redirected

const putInCache = async (cacheName, request, response) => {
  if (!isCacheable(response)) return
  const cache = await caches.open(cacheName)
  await cache.put(request, response)
}

const networkFirst = async (event, cacheName) => {
  try {
    const response = await fetch(event.request)
    event.waitUntil(putInCache(cacheName, event.request, response.clone()))
    return response
  } catch (error) {
    const cached = await caches.match(event.request)
    if (cached) return cached
    throw error
  }
}

const cacheFirst = async (event, cacheName) => {
  const cached = await caches.match(event.request)
  if (cached) return cached

  const response = await fetch(event.request)
  event.waitUntil(putInCache(cacheName, event.request, response.clone()))
  return response
}

const staleWhileRevalidate = async (event, cacheName) => {
  const cached = await caches.match(event.request)
  const fromNetwork = fetch(event.request).then(async (response) => {
    await putInCache(cacheName, event.request, response.clone())
    return response
  })

  event.waitUntil(fromNetwork.catch(() => {}))
  return cached || fromNetwork
}

/**
 * Navigations are network-first with a cached-document fallback. Offline, the fallback paints
 * the app chrome and whatever skeletons the route renders; the client fetches behind them still
 * fail, and each feed surfaces its own retry card (see components/ui/FeedError.jsx).
 */
const handleNavigation = async (event) => {
  try {
    const response = await fetch(event.request)
    event.waitUntil(putInCache(SHELL_CACHE, event.request, response.clone()))
    return response
  } catch (error) {
    const cached =
      (await caches.match(event.request, { ignoreSearch: true })) ||
      (await caches.match(APP_SHELL_URL)) ||
      (await caches.match(OFFLINE_URL))

    return cached || Response.error()
  }
}

// --- Web Share Target ---

/**
 * The OS share sheet POSTs the shared content here. Shared files cannot ride through the
 * redirect that follows, and pushing them at the server first would burn an upload the
 * author may never publish — so the whole payload is parked in SHARE_CACHE and /share
 * picks it up from there. Nothing leaves the device until the composer uploads it.
 */
const handleShare = async (request) => {
  try {
    const formData = await request.formData()
    const files = formData.getAll('media').filter((entry) => typeof entry === 'object' && entry && entry.size > 0)

    // Dropping the whole cache first clears any share the author abandoned earlier
    await caches.delete(SHARE_CACHE)
    const cache = await caches.open(SHARE_CACHE)

    const entries = files.map((file, index) => ({
      key: `${SHARE_FILE_PREFIX}${index}`,
      name: file.name || `shared-${index}`,
      type: file.type || '',
    }))

    await Promise.all(
      files.map((file, index) =>
        cache.put(entries[index].key, new Response(file, { headers: { 'Content-Type': entries[index].type || 'application/octet-stream' } }))
      )
    )

    await cache.put(
      SHARE_PAYLOAD_KEY,
      new Response(
        JSON.stringify({
          title: formData.get('title') || '',
          text: formData.get('text') || '',
          url: formData.get('url') || '',
          files: entries,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    )

    return Response.redirect(SHARE_LANDING_URL, 303)
  } catch (error) {
    console.error('Failed to receive the share:', error)
    return Response.redirect(`${SHARE_LANDING_URL}?error=1`, 303)
  }
}

// Background Service Worker Listener
self.addEventListener('push', (event) => {
  if (!event.data) return

  try {
    const payload = event.data.json()
    console.log('push payload:', payload)

    const options = {
      body: payload.body || payload.message || 'No message',
      icon: payload.icon || '/icon-192x192.png',
      badge: '/badge-72x72.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: '2',
        actionUrl: payload.actionUrl,
      },
    }

    event.waitUntil(self.registration.showNotification(payload.title, options))
  } catch (err) {
    console.error('Failed to parse push event context:', err)
  }
})

// Handle notification click to open the exact link
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const appOrigin = self.location.origin
  const targetUrl = new URL(event.notification.data?.actionUrl || '/', appOrigin).href

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 1. Check if the PWA is already open
      for (let client of windowClients) {
        const clientOrigin = new URL(client.url).origin
        if (clientOrigin === appOrigin && 'focus' in client) {
          // Navigate the existing PWA window to the target URL
          client.postMessage({ type: 'NAVIGATE', url: targetUrl })
          return client.focus()
        }
      }

      // 2. If no window is open, open a new one (PWA windows are standalone)
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
    })
  )
})

self.addEventListener('install', (event) => {
  // Best-effort only — a failed precache must not block activation, and the runtime caches
  // below fill in on the first online visit anyway. A first-ever visit made offline still has
  // nothing to paint: /offline's own CSS and JS have never been fetched at that point.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key))))
      .then(() => clients.claim())
  )
})

// Serves the offline app shell, and satisfies the Chromium PWA installability criteria.
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Caught ahead of the GET guard below: the share sheet's payload is a POST, and it is the
  // only one this worker answers. Missing it would send the files to /api/share's fallback,
  // which can only keep the text.
  if (request.method === 'POST' && url.pathname === SHARE_ACTION_PATH) {
    event.respondWith(handleShare(request))
    return
  }

  if (request.method !== 'GET') return

  // Never cached. API responses are the feeds' live data — a stale timeline is worse than an
  // honest retry card. RSC payloads belong to Next's router, and one from a previous build
  // desyncs it from the running client.
  if (url.pathname.startsWith('/api/')) return
  if (request.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event))
    return
  }

  // Build output is content-hashed, so in production the cached copy is the correct copy.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(IS_DEV ? networkFirst(event, ASSET_CACHE) : cacheFirst(event, ASSET_CACHE))
    return
  }

  // Post media (/_next/image) is left uncached on purpose: it would grow the cache without
  // bound, and the posts it belongs to can't load offline regardless.
  if (ASSET_EXTENSIONS.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    event.respondWith(staleWhileRevalidate(event, ASSET_CACHE))
  }
})
