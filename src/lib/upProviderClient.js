/**
 * Client side of running Hup INSIDE the LUKSO Grid (the mirror of upProviderBridge.js, which is
 * Hup hosting Grid apps).
 *
 * When someone adds hup.social to their Grid on universaleverything.io, Hup loads in a
 * cross-origin iframe where no wallet extension injects — the Grid host is the wallet, spoken to
 * over the up-provider protocol. Creating `createClientUPProvider()` here does two things:
 *
 *   1. It handshakes with the parent, which hands over the visitor's Universal Profile session
 *      (one-click connect, no extension needed).
 *   2. It announces itself via EIP-6963 ("UE Universal Profile"), which wagmi's provider
 *      discovery turns into a regular connector in the connect dialog — no custom connector
 *      code, and the same battle-tested client every Grid mini app uses.
 *
 * The provider is only created when Hup is actually framed: standalone tabs never pay the
 * handshake retries, and the connect dialog never shows a Grid connector that cannot work.
 * CSP `frame-ancestors` (next.config.mjs) limits who can be that parent in the first place.
 */

let provider = null

/** True when Hup is running inside another page's iframe (the Grid, or the dev harness). */
export const isFramedByGridHost = () => {
  if (typeof window === 'undefined') return false
  try {
    return window.self !== window.top
  } catch {
    // Cross-origin access to window.top throws in exotic cases — which itself means framed
    return true
  }
}

/** The rdns the up-provider client announces under; used to spot its connector in the UI. */
export const UP_PROVIDER_RDNS = 'dev.lukso.auth'

/**
 * Creates (once) the up-provider client so wagmi discovers it. Call from a client component on
 * mount — it is a no-op outside an iframe and on the server.
 */
export async function announceUpProvider() {
  if (!isFramedByGridHost() || provider) return provider

  // Dynamic import keeps the Grid client (and its handshake side effects) out of every normal
  // page load — only framed sessions fetch it.
  const { createClientUPProvider } = await import('@lukso/up-provider')
  if (provider) return provider
  provider = createClientUPProvider()
  return provider
}
