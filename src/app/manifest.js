// Single source of truth for the web app manifest — Next serves this at
// /manifest.webmanifest and injects the <link rel="manifest"> itself.
// `description` plus `screenshots` are what make Chromium show its rich install
// dialog (icon, origin, "From the app" blurb, screenshot carousel) instead of the
// compact one, so keep both populated.
export default function manifest() {
  return {
    id: '/',
    name: process.env.NEXT_PUBLIC_NAME || 'Hup',
    short_name: process.env.NEXT_PUBLIC_NAME || 'Hup',
    description: process.env.NEXT_PUBLIC_DESCRIPTION || 'Fully onchain social network',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    lang: 'en',
    dir: 'ltr',
    background_color: '#ffffff',
    theme_color: '#000000',
    categories: ['social', 'finance'],
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        // The mark runs edge to edge, so a maskable purpose would crop it — let the
        // platform letterbox instead
        purpose: 'any',
      },
      {
        src: '/web-app-manifest-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    screenshots: [
      {
        src: '/screenshots/narrow.png',
        sizes: '390x844',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'The Hup feed on mobile',
      },
      {
        src: '/screenshots/wide.png',
        sizes: '1280x720',
        type: 'image/png',
        form_factor: 'wide',
        label: 'The Hup feed on desktop',
      },
    ],
    // Long-press / right-click jump list on the installed icon. Only routed
    // destinations belong here — "New post" is a composer modal, not a URL, so it
    // is deliberately absent. Android surfaces at most four, in this order.
    shortcuts: [
      { name: 'Search', short_name: 'Search', description: 'Search posts and people', url: '/search' },
      { name: 'Notifications', short_name: 'Alerts', description: 'See what you missed', url: '/notifications' },
      { name: 'Chat', short_name: 'Chat', description: 'Open your conversations', url: '/chat' },
      { name: 'Saved', short_name: 'Saved', description: 'Posts you bookmarked', url: '/saved' },
    ],
    // Reuse the running window and route it to the shortcut target instead of
    // spawning a second app window
    launch_handler: {
      client_mode: 'navigate-existing',
    },
  }
}
