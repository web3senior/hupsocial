/**
 * @file lib/threadPublication.js
 * @description Publishes the parts of a thread that come after its first post. Each part is a
 * reply to the part before it, and that parent only has an id once the indexer has seen it — so
 * the chain runs from trackPostPublication's onIndexed, long after the composer has closed.
 *
 * Every part was moderated and pinned by the composer before part one was signed, so what is
 * left here is only the transaction per part. That is why this module talks to wagmi/actions and
 * not to hooks: nothing it touches may depend on a component still being mounted.
 *
 * The thread reads as one act from start to finish: one toast counts the parts up, and the first
 * part's ghost card holds its place in the feed until the last part has landed.
 */

import { signTypedData, writeContract } from 'wagmi/actions'
import abi from '@/abi/post.json'
import { CONTRACTS, config } from '@/config/wagmi'
import { formatWait } from '@/config/gasless'
import { HUP_SOLANA_KIND, isSolanaNetworkId } from '@/config/solana'
import { toast } from '@/components/NextToast'
import { ContentType } from '@/lib/content'
import { isSessionActive } from '@/lib/burnerSession'
import { gaslessCooldown, isGaslessEnabled, relayHupAction } from '@/lib/relayGasless'
import { describeWalletError } from '@/lib/walletErrors'
import { releaseGhost, THREAD_PROGRESS_EVENT, trackPostPublication } from '@/lib/postPublication'
import { updatePendingPost } from '@/db/pendingPosts'
import { useComposerStore } from '@/stores/useComposerStore'

// A beat past the relay's own cooldown, so the request never lands a hair early and bounces
const COOLDOWN_MARGIN_MS = 1500
// The server can still turn a part down for a cooldown our local mirror had already counted out
// (its clock started a moment later). Those are waited out again, a few times over; only a wait
// longer than this — the hourly window spent, not the per-post gap — moves the part to the wallet.
const MAX_COOLDOWN_RETRIES = 4
const MAX_COOLDOWN_WAIT_S = 300

/**
 * Wording for one part, on the one toast the whole thread shares. `done` is only ever shown as
 * the final word on the last part; on the others it is the line that holds until the next part
 * picks the toast up.
 * @param {number} index 1-based position of the part.
 * @param {number} total Parts in the whole thread.
 */
export const threadPartCopy = (index, total) => ({
  pending: `Publishing your thread · ${index}/${total}`,
  done: index === total ? `Your thread is live · ${total}/${total}` : `Publishing your thread · ${index}/${total} live`,
  slow: `Part ${index} of ${total} is still indexing — the rest of your thread was not sent.`,
  failed: `Part ${index} of ${total} was rejected onchain — sign it again to finish your thread.`,
})

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

/**
 * Sponsored when the relay serves this chain and wallet, from the wallet otherwise. A cooldown
 * is waited out rather than paid around — every time the relay names one, not just the first:
 * the parts were written as one act, and an author on a gasless trial may hold nothing to pay
 * with.
 * @returns {Promise<{txHash?: string, signature?: string}>}
 */
const submitPart = async ({ networkId, owner, chain, publicClient, solanaSigner, metadata, parentId, allowComments, onWait }) => {
  if (isSolanaNetworkId(networkId)) {
    if (!solanaSigner) throw new Error('Connect a Solana wallet to finish your thread')
    // Loaded on demand, as in postPublication: an EVM-only session never pays for the bundle
    const [{ hupInstruction, readHupConfig }, { sendHupAction }] = await Promise.all([import('@/lib/solana/hup'), import('@/lib/solana/relay')])
    const { treasury } = await readHupConfig(networkId)
    const instruction = hupInstruction.create({
      networkId,
      creator: solanaSigner.account.address,
      treasury,
      kind: HUP_SOLANA_KIND.COMMENT,
      parentId,
      metadata,
      allowComments,
    })
    const { signature } = await sendHupAction({ networkId, signer: solanaSigner, instructions: [instruction], confirm: false })
    return { signature }
  }

  const contractAddress = CONTRACTS[`chain${networkId}`]?.hup
  if (!contractAddress) throw new Error('Contract configuration missing for network')
  const args = [owner, ContentType.Comment, metadata, BigInt(parentId), allowComments]

  if (isGaslessEnabled(networkId) && chain && publicClient) {
    for (let attempt = 0; attempt <= MAX_COOLDOWN_RETRIES; attempt += 1) {
      // Our own mirror of the throttle, refreshed from the server's Retry-After on every 429
      const wait = gaslessCooldown('create', networkId, owner)
      if (wait > MAX_COOLDOWN_WAIT_S) break
      if (wait > 0) {
        onWait?.(wait)
        await sleep(wait * 1000 + COOLDOWN_MARGIN_MS)
      }

      try {
        const session = await isSessionActive({ userAddress: owner, publicClient })
        const txHash = await relayHupAction({
          chain,
          publicClient,
          owner,
          functionName: 'create',
          args,
          signTypedDataAsync: (request) => signTypedData(config, request),
          useSessionKey: session.active,
        })
        if (txHash) return { txHash }
        break
      } catch (error) {
        // The relay already sent it and only lost sight of the receipt: sending again from the
        // wallet would publish the part twice, so the tracker settles this hash instead
        if (error.code === 'RELAY_SUBMITTED' && error.txHash) return { txHash: error.txHash }
        // A cooldown is a "not yet", never a "pay for it yourself" — go round and wait again
        if (error.code === 'RELAY_COOLDOWN') continue
        // Same rule as the composer: a relay hiccup only decides who pays, never whether it posts
        console.warn('Gasless thread part unavailable:', error.message)
        break
      }
    }
  }

  const txHash = await writeContract(config, { abi, address: contractAddress, functionName: 'create', args, chainId: networkId })
  return { txHash }
}

/**
 * Sends the next part as a reply to `parent`, then hands the rest to the tracker so the part
 * after it starts once this one is indexed.
 *
 * @param {object} thread
 * @param {object} thread.parent The indexed row of the part just published.
 * @param {Array<{metadata: string, content: object}>} thread.parts What is still to go, in order.
 * @param {number} thread.total Parts in the whole thread, the first one included.
 * @param {number} thread.networkId
 * @param {string} thread.owner The signer's address — the EVM wallet, or the Solana one.
 * @param {object} [thread.chain] Viem chain, for the relay.
 * @param {object} [thread.publicClient] Viem client on that chain, for the relay.
 * @param {object} [thread.solanaSigner] Captured by the composer while the wallet was in hand.
 * @param {boolean} thread.allowComments The reply setting the first part went out with.
 * @param {object} [thread.handle] The toast the first part opened; every part updates it.
 * @param {string} [thread.ghostId] The first part's ghost card, held until the thread is whole.
 * @param {object} [thread.root] The first part's indexed row.
 */
export function continueThread(thread) {
  const { parent, parts, total, networkId, owner, allowComments, handle, ghostId } = thread
  const root = thread.root ?? parent
  const [part, ...rest] = parts
  if (!part || !parent?.id) return

  const index = total - parts.length + 1
  const copy = threadPartCopy(index, total)
  const rootKey = `${networkId}:${root.id}`
  // What has landed so far, out where the thread's first part is drawn — and, once the thread
  // stops for good, the ghost goes so the parts that did land show up in the feed
  const announce = () => window.dispatchEvent(new CustomEvent(THREAD_PROGRESS_EVENT, { detail: { networkId: Number(networkId), rootId: String(root.id) } }))
  const stop = () => {
    releaseGhost(ghostId, rootKey)
    announce()
  }
  if (ghostId) updatePendingPost(ghostId, { progress: { part: index, of: total } })

  // If this part never lands, the composer comes back as a reply to the part that did, holding
  // this one and everything still behind it — the thread resumes from exactly where it broke
  const recovery = {
    props: { actionType: 'comment', replyTarget: parent },
    state: { content: part.content, allowComments, thread: rest.map((next) => next.content), threadStart: index },
  }

  const run = async () => {
    let receipt
    try {
      receipt = await submitPart({
        ...thread,
        metadata: part.metadata,
        parentId: parent.id,
        onWait: (seconds) => handle?.update(`Publishing your thread · ${index - 1}/${total} live · part ${index} in ${formatWait(seconds)}`, 'loading'),
      })
    } catch (error) {
      console.error(error)
      const message = describeWalletError(error, { fallback: `Part ${index} of ${total} was not sent` })
      // A toast the author already closed takes no update — an error still has to be seen
      if (!handle?.update(message, 'error')) toast(message, 'error')
      stop()
      useComposerStore.getState().restoreComposer(recovery)
      return
    }

    trackPostPublication({
      networkId,
      author: owner,
      metadata: part.metadata,
      kind: 'reply',
      parentId: parent.id,
      copy,
      handle,
      settles: rest.length === 0,
      ...receipt,
      recovery,
      onAbandoned: stop,
      onIndexed: (found) => {
        if (rest.length) {
          announce()
          continueThread({ ...thread, root, parent: found, parts: rest })
        } else stop()
      },
    })
  }

  run()
}
