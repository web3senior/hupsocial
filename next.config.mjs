/**
 * Frame policy for mini apps.
 *
 * `frame-src *` is intentional: registered apps are arbitrary third-party origins chosen by
 * developers, so a static allowlist is impossible here. Containment comes from ordinary
 * cross-origin policy (the frame runs sandboxed WITH allow-same-origin so real dapps keep
 * storage and WebCrypto, but its origin is its own — the embed resolver refuses frame URLs on
 * Hup's origin, the only case where that flag would grant parent access) plus the bridge, which
 * never proxies a signature without an explicit user confirmation.
 *
 * `frame-ancestors` is the part that matters defensively: it stops Hup from being framed by
 * arbitrary pages, which is what would otherwise let a hostile page wrap the app and harvest
 * clicks on the very confirmation dialogs the bridge relies on. universaleverything.io is the
 * deliberate exception — Hup runs as a mini app on LUKSO Grid profiles, where the Grid host
 * hands Hup the visitor's wallet over up-provider (see src/lib/upProviderClient.js). Localhost
 * ancestors are allowed in dev only, so the Grid-host harness can frame the dev server.
 */
const FRAME_ANCESTORS = [
  "'self'",
  'https://universaleverything.io',
  'https://*.universaleverything.io',
  ...(process.env.NODE_ENV === 'development' ? ['http://localhost:*', 'https://localhost:*'] : []),
].join(' ')

const CONTENT_SECURITY_POLICY = [
  `frame-ancestors ${FRAME_ANCESTORS}`,
  'frame-src *',
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

/**
 * Post embeds are the deliberate hole in the policy above, and only for the embed document at
 * /networks/{networkId}/{postId}/embed. Framing the app is dangerous because a hostile wrapper
 * could harvest clicks on the bridge's confirmation dialogs; that document has nothing to
 * harvest — no wallet, no session, no forms, no app shell, just a rendered post and outbound
 * links (see src/app/networks/[networkId]/[postId]/embed/route.js). It frames nothing itself,
 * which is why frame-src drops to 'none' here.
 */
const EMBED_CONTENT_SECURITY_POLICY = [
  'frame-ancestors *',
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // A navigation, prefetch or Server Action that hits a dead network no longer throws to
    // error.jsx — Next keeps it pending and replays it once connectivity returns, so the route
    // sits on its loading.jsx skeleton the way X's timeline does. Also exposes next/offline.
    // Client-side fetch() (the feeds' getPosts) is NOT covered: those keep their own retry state.
    useOffline: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // The worker now owns the offline app shell, so it must never come from a stale HTTP
        // cache — otherwise a shipped strategy change can't reach already-installed clients.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        // Must stay after the catch-all: matching rules apply in order, and for a repeated key
        // the last value wins — this is what lifts frame-ancestors for the embed document alone.
        source: '/networks/:networkId/:postId/embed',
        headers: [{ key: 'Content-Security-Policy', value: EMBED_CONTENT_SECURITY_POLICY }],
      },
      {
        // The embed loader runs on the pages that host embeds, i.e. anyone's origin
        source: '/embed.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
      {
        // The guest SDK is meant to be loaded by mini apps on their own origins
        source: '/miniapp-sdk.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // Legacy misspelled route — the page moved to /bazaar
      {
        source: '/bazzar',
        destination: '/bazaar',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
