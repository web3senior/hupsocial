/**
 * @file lib/threadPublication.js
 * @description Publishes the parts of a thread that come after its first post. Each part is a
 * reply to the part before it, and that parent only has an id once the indexer has seen it — so
 * the chain runs from trackPostPublication's onIndexed, long after the composer has closed.
 *
 * Every part was moderated and pinned by the composer before part one was signed, so what is
 * left here is only the transaction per part. That is why this module talks to wagmi/actions and
 * not to hooks: nothing it touches may depend on a component still being mounted.
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
import { trackPostPublication } from '@/lib/postPublication'
import { useComposerStore } from '@/stores/useComposerStore'

// A beat past the relay's own cooldown, so the request never lands a hair early and bounces
const COOLDOWN_MARGIN_MS = 1500

/**
 * Toast wording for one part, so a four-part thread does not announce "Your post is live" four
 * times before it is actually finished.
 * @param {number} index 1-based position of the part.
 * @param {number} total Parts in the whole thread.
 */
export const threadPartCopy = (index, total) => ({
  pending: `Publishing part ${index} of ${total}…`,
  done: index === total ? 'Your thread is live' : `Part ${index} of ${total} is live`,
})

/**
 * Sponsored when the relay serves this chain and wallet, from the wallet otherwise. A cooldown
 * is waited out rather than paid around: the parts were written as one act, and an author on a
 * gasless trial may hold nothing to pay with.
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
    const wait = gaslessCooldown('create', networkId, owner)
    if (wait > 0) {
      onWait?.(wait)
      await new Promise((resolve) => window.setTimeout(resolve, wait * 1000 + COOLDOWN_MARGIN_MS))
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
    } catch (error) {
      // Same rule as the composer: a relay hiccup only decides who pays, never whether it posts
      console.warn('Gasless thread part unavailable:', error.message)
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
 */
export function continueThread(thread) {
  const { parent, parts, total, networkId, owner, allowComments } = thread
  const [part, ...rest] = parts
  if (!part || !parent?.id) return

  const index = total - parts.length + 1
  // If this part never lands, the composer comes back as a reply to the part that did, holding
  // this one and everything still behind it — the thread resumes from exactly where it broke
  const recovery = {
    props: { actionType: 'comment', replyTarget: parent },
    state: { content: part.content, allowComments, thread: rest.map((next) => next.content), threadStart: index },
  }

  let waitHandle = null
  const run = async () => {
    let receipt
    try {
      receipt = await submitPart({
        ...thread,
        metadata: part.metadata,
        parentId: parent.id,
        onWait: (seconds) => {
          waitHandle = toast(`Part ${index} of ${total} goes out in ${formatWait(seconds)}`, 'loading')
        },
      })
    } catch (error) {
      console.error(error)
      waitHandle?.dismiss()
      toast(describeWalletError(error, { fallback: `Part ${index} of ${total} was not sent` }), 'error')
      useComposerStore.getState().restoreComposer(recovery)
      return
    }
    waitHandle?.dismiss()

    trackPostPublication({
      networkId,
      author: owner,
      metadata: part.metadata,
      kind: 'reply',
      parentId: parent.id,
      copy: threadPartCopy(index, total),
      ...receipt,
      recovery,
      onIndexed: rest.length ? (found) => continueThread({ ...thread, parent: found, parts: rest }) : null,
    })
  }

  run()
}
