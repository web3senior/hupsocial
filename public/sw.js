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

  const targetUrl = event.notification.data?.actionUrl || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 1. Check if the PWA is already open
      for (let client of windowClients) {
        // Look for your PWA's URL pattern
        if (client.url.includes(process.env.NEXT_PUBLIC_DOMAIN) && 'focus' in client) {
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
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})

// Intercept network requests to satisfy the Chromium PWA installability criteria
// You can expand this later to implement caching strategies like Cache-First or Network-First
self.addEventListener('fetch', (event) => {
  // A minimal pass-through listener is sufficient to trigger the install prompt
  return
})
