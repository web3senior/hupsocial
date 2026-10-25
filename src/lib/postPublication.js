/**
 * @file lib/postPublication.js
 * @description Owns everything that happens to a submission after its composer has closed: it
 * holds a loading toast open, waits for the chain to say what became of the transaction, then
 * either pulls the post into the feed or hands the composer back so the author can sign again.
 *
 * Lives in a module rather than in the composer because the composer now closes the instant the
 * transaction is sent — the receipt, the indexer poll and the toast handle all have to outlive it.
 */

import { mutate as globalMutate } from 'swr'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { config } from '@/config/wagmi'
import { toast } from '@/components/NextToast'
import { usePostStore } from '@/stores/usePostStore'
import { useComposerStore } from '@/stores/useComposerStore'
import { useCommentsCacheStore } from '@/stores/useCommentsCacheStore'
import { usePendingPostStore } from '@/stores/usePendingPostStore'

// cidex only sees the post once the transaction is mined AND its next scan runs, so the wait is
// a block time plus a poll interval — a couple of seconds on a fast chain, longer on a slow one.
const POLL_INTERVAL_MS = 2500
// Past this the indexer is behind rather than busy; say so and let the card expire instead of
// spinning at the reader forever.
const POLL_TIMEOUT_MS = 120_000
// Long enough for a slow chain to mine, short enough that a transaction nobody will ever see
// mined stops holding a toast open. Running out is not a verdict — see settleTransaction.
const RECEIPT_TIMEOUT_MS = 120_000
// How long a handed-over ghost card is kept after the indexer answered. The feed drops it the
// moment the real row is in its list, so this only sweeps up entries belonging to feeds nobody
// had open at the time.
const GHOST_HANDOVER_MS = 30_000

const COPY = {
  post: {
    pending: 'Publishing your post…',
    done: 'Your post is live',
    slow: 'Still indexing — your post will show up shortly.',
    failed: 'Your post was rejected onchain — sign it again to publish it.',
  },
  reply: {
    pending: 'Publishing your reply…',
    done: 'Your reply is live',
    slow: 'Still indexing — your reply will show up shortly.',
    failed: 'Your reply was rejected onchain — sign it again to publish it.',
  },
  edit: {
    pending: 'Saving your changes…',
    done: 'Your post has been updated',
    slow: 'Still indexing — your changes will show up shortly.',
    failed: 'Your changes were rejected onchain — sign them again to save them.',
  },
}

// Fired as each part of a thread lands, so a post page already showing the thread's first part
// can fetch the parts it has not drawn yet
export const THREAD_PROGRESS_EVENT = 'hup:thread-progress'

/**
 * Hands a held ghost over to its indexed row and pulls the feed — what an ordinary post does the
 * moment it is indexed. A thread holds its first part's ghost until every part has landed (or
 * the thread stops), so the feed shows the thread once, whole.
 * @param {string} ghostId The ghost's `networkId:metadata` id.
 * @param {string} resolvedKey The indexed row's `network_id:id`.
 */
export const releaseGhost = (ghostId, resolvedKey) => {
  if (!ghostId) return
  const ghostStore = usePendingPostStore.getState()
  ghostStore.updatePendingPost(ghostId, { status: 'indexed', resolvedKey, progress: null })
  window.setTimeout(() => ghostStore.removePendingPost(ghostId), GHOST_HANDOVER_MS)
  usePostStore.getState().notifyAuthoredPost()
}

// `txHash` keeps an older post with the same pinned content (same words, same author, same CID)
// from answering for this one — without it, a thread posted twice chained its new parts onto the
// first copy's. Edits pass none: the row they rewrite keeps the hash it was created with.
const lookupPost = async ({ networkId, author, metadata, txHash }) => {
  const params = new URLSearchParams({
    network_id: String(networkId),
    wallet_address: author,
    metadata,
  })
  if (txHash) params.set('tx_hash', txHash)

  const response = await fetch(`/api/v1/networks/posts/lookup?${params}`, { cache: 'no-store' })
  if (!response.ok) return null

  const body = await response.json()
  return body?.indexed ? body.data : null
}

/**
 * Drops a freshly indexed reply into the thread it belongs to: the cached snapshot goes, any
 * mounted <Comments> for that post refetches, and the parent's comment counter revalidates so
 * the number moves at the same moment the reply shows up.
 */
const revealReply = ({ networkId, parentId }) => {
  if (!parentId) return

  useCommentsCacheStore.getState().invalidateThread(networkId, parentId)
  // Every viewer variant of the parent's stats entry — the key carries the connected address, and
  // the author's card can be mounted under either it or the anonymous key.
  globalMutate((key) => typeof key === 'string' && key.startsWith(`posts/${networkId}/${parentId}/`))
}

/**
 * Asks the chain what became of a submission the composer has already closed on.
 *
 * A revert is the only answer that costs the author anything, because it is the only one that
 * puts the composer back in their way. A timeout, a dropped RPC or a transaction nobody can find
 * is not evidence that the post failed — those fall through to the indexer poll, which is what
 * actually knows whether the post exists.
 *
 * @returns {Promise<'confirmed'|'reverted'|'unknown'>}
 */
const settleTransaction = async ({ networkId, txHash, signature }) => {
  try {
    // Solana answers on its own cluster connection; the module is loaded on demand so an
    // EVM-only session never pays for the bundle
    if (signature) {
      const { confirmSolanaSignature } = await import('@/lib/solana/hup')
      await confirmSolanaSignature(networkId, signature)
      return 'confirmed'
    }

    if (!txHash) return 'unknown'

    const receipt = await waitForTransactionReceipt(config, {
      chainId: Number(networkId),
      hash: txHash,
      timeout: RECEIPT_TIMEOUT_MS,
    })

    return receipt.status === 'success' ? 'confirmed' : 'reverted'
  } catch (error) {
    // A rejected Solana transaction and an unanswered one both arrive as a throw, so the code
    // is what separates the cluster refusing the transaction from the cluster staying silent
    if (error?.code === 'TX_REVERTED') return 'reverted'

    console.warn('Could not settle the post transaction:', error.message)
    return 'unknown'
  }
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
 * @param {'post'|'reply'|'edit'} [submission.kind] Picks the wording and where the result is shown.
 * @param {string|number} [submission.parentId] The replied-to post, for `reply` submissions.
 * @param {object} [submission.copy] Overrides some of the kind's wording — a thread counts the
 *   part in flight, where the kind's own copy would call every part "your post".
 * @param {object} [submission.handle] A toast already open for this submission. A thread passes
 *   one handle from part to part, so the author watches one card count up instead of a stack.
 * @param {boolean} [submission.settles] False for every part of a thread but the last: once
 *   indexed, the toast stays loading on `copy.done`, and a first part's ghost stays publishing
 *   until releaseGhost hands it over with the thread whole.
 * @param {string} [submission.txHash] EVM transaction, wallet-signed or relayed.
 * @param {string} [submission.signature] Solana signature — the cluster equivalent of txHash.
 * @param {object} [submission.recovery] `{ props, state }` for putting this exact composer back
 *   on screen if the transaction reverts.
 * @param {Function} [submission.onIndexed] Runs once the post is actually readable. This is the
 *   composer callers pass as `onConfirmed`, and it must never fire for a submission the indexer
 *   never saw.
 * @param {Function} [submission.onAbandoned] Runs when the wait ends without the post: it reverted,
 *   or the indexer never answered. A thread uses it to stop holding its first part's ghost.
 */
export function trackPostPublication({
  networkId,
  author,
  metadata,
  kind = 'post',
  parentId = null,
  copy: copyOverride = null,
  handle: openHandle = null,
  settles = true,
  txHash = null,
  signature = null,
  recovery = null,
  onIndexed = null,
  onAbandoned = null,
  ghostId: earlyGhostId = null,
}) {
  const copy = { ...(COPY[kind] ?? COPY.post), ...copyOverride }
  // A handle the author already closed takes no update, so a fresh card stands in for it
  const handle = openHandle?.update(copy.pending, 'loading') ? openHandle : toast(copy.pending, 'loading')
  const ghostStore = usePendingPostStore.getState()

  // Nothing to poll for — better a card that expires than one that spins forever
  if (!networkId || !author || !metadata) {
    handle.update(copy.slow, 'info')
    if (earlyGhostId) ghostStore.removePendingPost(earlyGhostId)
    return
  }

  // A whole post also gets a ghost card at the top of the feed for as long as it is in flight,
  // so the author watches it sit where it will land instead of watching a toast spin. A reply
  // belongs to a thread they are already reading and an edit rewrites a card already on screen,
  // so neither has anywhere to put one. The payload is the plaintext the composer kept for its
  // own recovery, and its media was pinned before the transaction was sent — the ghost shows the
  // real post, not a placeholder.
  //
  // A composer that closed at the tap already put its ghost up (`ghostId`), before anything was
  // pinned: that card is taken over in place — same id, same timestamp — so it never blinks out
  // and back between the tap and the transaction.
  const adopted = earlyGhostId ? ghostStore.pending.find((entry) => entry.id === earlyGhostId) : null
  const ghost =
    kind === 'post' && recovery?.state?.content
      ? {
          id: earlyGhostId ?? `${networkId}:${metadata}`,
          networkId: Number(networkId),
          author,
          metadata,
          content: recovery.state.content,
          createdAt: adopted?.createdAt ?? Math.floor(Date.now() / 1000),
          status: 'publishing',
          resolvedKey: null,
          // A thread's first part: drawn as publishing until releaseGhost, whatever the feed holds
          held: !settles,
        }
      : null

  if (ghost) ghostStore.addPendingPost(ghost)
  else if (earlyGhostId) ghostStore.removePendingPost(earlyGhostId)
  const dropGhost = () => {
    if (ghost) ghostStore.removePendingPost(ghost.id)
  }

  const pollForIndexing = () => {
    const startedAt = Date.now()

    const tick = async () => {
      let found = null
      try {
        found = await lookupPost({ networkId, author, metadata, txHash: kind === 'edit' ? null : txHash })
      } catch (error) {
        // A dropped request is just a slower poll, never the end of the wait
        console.warn('Post indexing check failed:', error.message)
      }

      if (found) {
        handle.update(copy.done, settles ? 'success' : 'loading')
        const resolvedKey = `${networkId}:${found.id}`
        // Handed over rather than dropped: the feed keeps drawing the ghost until the row it
        // names is actually in the list, so the refresh below swaps one for the other with
        // nothing blank in between. A held ghost only learns its row — the feed keeps that row
        // out of sight while the ghost is still publishing — and waits for releaseGhost.
        if (ghost && !settles) ghostStore.updatePendingPost(ghost.id, { resolvedKey })
        else if (ghost) {
          ghostStore.updatePendingPost(ghost.id, { status: 'indexed', resolvedKey })
          window.setTimeout(dropGhost, GHOST_HANDOVER_MS)
        }
        // A reply belongs to a post page's comment list, not the home feed — so it refreshes the
        // thread it landed in instead of pulling page 1 of a feed the author isn't looking at.
        // is_comment is the parent the indexer actually recorded, which beats the composer's own
        // idea of what was replied to; parentId only stands in if an older row left it null.
        if (kind === 'reply') revealReply({ networkId, parentId: found.is_comment ?? parentId })
        else if (settles) usePostStore.getState().notifyAuthoredPost()
        onIndexed?.(found)
        return
      }

      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        handle.update(copy.slow, 'info')
        // The indexer is behind, not busy: the post surfaces on its own with the next refresh,
        // and a ghost that outlives the wait is a card that never resolves.
        dropGhost()
        onAbandoned?.()
        return
      }

      window.setTimeout(tick, POLL_INTERVAL_MS)
    }

    // First check is deferred: the transaction has only just been mined, so an immediate probe
    // lands before cidex has had a chance to scan the block it sits in.
    window.setTimeout(tick, POLL_INTERVAL_MS)
  }

  const run = async () => {
    const settled = await settleTransaction({ networkId, txHash, signature })

    if (settled === 'reverted') {
      handle.update(copy.failed, 'error')
      // Nothing landed, so nothing may keep sitting at the top of the feed
      dropGhost()
      onAbandoned?.()
      // The composer comes back holding everything that was written: the content was pinned
      // before the transaction was ever sent, so a second attempt costs only the signature
      useComposerStore.getState().restoreComposer(recovery)
      return
    }

    pollForIndexing()
  }

  run()
}
