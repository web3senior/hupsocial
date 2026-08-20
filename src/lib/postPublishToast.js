/**
 * @file lib/postPublishToast.js
 * @description Holds a loading toast open from the moment a submission leaves the composer until
 * the indexer has actually written the post, then morphs it into a success card and pulls the
 * post into the feed.
 *
 * Lives in a module rather than in the composer because the composer unmounts the instant it
 * closes — the poll and the toast handle have to outlive it.
 */

import { toast } from '@/components/NextToast'
import { usePostStore } from '@/stores/usePostStore'

// cidex only sees the post once the transaction is mined AND its next scan runs, so the wait is
// a block time plus a poll interval — a couple of seconds on a fast chain, longer on a slow one.
const POLL_INTERVAL_MS = 2500
// Past this the indexer is behind rather than busy; say so and let the card expire instead of
// spinning at the reader forever.
const POLL_TIMEOUT_MS = 120_000

const COPY = {
  post: {
    pending: 'Publishing your post…',
    done: 'Your post is live',
    slow: 'Still indexing — your post will show up shortly.',
  },
  reply: {
    pending: 'Publishing your reply…',
    done: 'Your reply is live',
    slow: 'Still indexing — your reply will show up shortly.',
  },
  edit: {
    pending: 'Saving your changes…',
    done: 'Your post has been updated',
    slow: 'Still indexing — your changes will show up shortly.',
  },
}

const lookupPost = async ({ networkId, author, metadata }) => {
  const params = new URLSearchParams({
    network_id: String(networkId),
    wallet_address: author,
    metadata,
  })

  const response = await fetch(`/api/v1/networks/posts/lookup?${params}`, { cache: 'no-store' })
  if (!response.ok) return null

  const body = await response.json()
  return body?.indexed ? body.data : null
}

/**
 * Opens the loading toast and resolves it when the post lands.
 *
 * @param {object} submission
 * @param {number} submission.networkId Chain the submission was pinned to.
 * @param {string} submission.author Wallet that authored it.
 * @param {string} submission.metadata The `ipfs://…` URI written onchain — the only identifier
 *   that is known before the transaction is sent, is the same on the wallet and relayed paths,
 *   and is rewritten onto the existing row by an edit.
 * @param {'post'|'reply'|'edit'} [submission.kind] Picks the wording and whether the feed is pulled.
 */
export function trackPostPublication({ networkId, author, metadata, kind = 'post' }) {
  const copy = COPY[kind] ?? COPY.post
  const handle = toast(copy.pending, 'loading')

  // Nothing to poll for — better a card that expires than one that spins forever
  if (!networkId || !author || !metadata) {
    handle.update(copy.slow, 'info')
    return
  }

  const startedAt = Date.now()

  const tick = async () => {
    let found = null
    try {
      found = await lookupPost({ networkId, author, metadata })
    } catch (error) {
      // A dropped request is just a slower poll, never the end of the wait
      console.warn('Post indexing check failed:', error.message)
    }

    if (found) {
      handle.update(copy.done, 'success')
      // A reply belongs to a post page's comment list, not the home feed — pulling page 1 there
      // would refresh a feed the author isn't even looking at
      if (kind !== 'reply') usePostStore.getState().notifyAuthoredPost()
      return
    }

    if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
      handle.update(copy.slow, 'info')
      return
    }

    window.setTimeout(tick, POLL_INTERVAL_MS)
  }

  // First check is deferred: on the relayed path the transaction isn't even mined yet, so an
  // immediate probe can only ever miss.
  window.setTimeout(tick, POLL_INTERVAL_MS)
}
