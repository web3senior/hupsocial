import { createReadable } from 'readable-sdk'
import { getPublicClient } from 'wagmi/actions'
import { config, robinhood } from './wagmi'

/**
 * Readable (readable.name): onchain numbers like `+0 42421230` that point to a wallet, and that a
 * wallet can choose as its primary name. Read from the registry on Robinhood Chain by readable-sdk.
 */
export const readable = {
  // The site a name links to. Without a trailing slash; NEXT_PUBLIC_ values are inlined only when referenced literally
  api: (process.env.NEXT_PUBLIC_READABLE_API || 'https://readable.name').replace(/\/+$/, ''),
  // A wallet changes its primary name rarely; a profile visit doesn't need it fresher than this
  staleMs: 300_000,
}

// Through the app's own Robinhood client: the SDK's default RPC sends browsers a malformed CORS header
export const readableRegistry = createReadable({ client: getPublicClient(config, { chainId: robinhood.id }) })
