/**
 * @file lib/batchFollow.js
 * @description Pure helpers for following a selection of profiles in one LSP26
 * followBatch transaction. Mirrors lib/batchLike.js: followBatch is all-or-nothing —
 * a single already-followed (or self) address reverts the whole array with
 * LSP26AlreadyFollowing / LSP26CannotSelfFollow, so the selection is validated
 * here instead of failing at wallet gas estimation.
 */

import followerSystemAbi from '@/abis/LSP26FollowerSystem'

// Each follow can trigger the target's LSP1 universalReceiver hook, so gas per
// entry is heavier than a like — keep batches at the same cap batchLike uses.
export const MAX_BATCH_FOLLOW_COUNT = 50
const MAX_FOLLOWING_READ_COUNT = 500

/**
 * Every address the viewer follows on the active chain, lowercased. This is the answer
 * that decides follow vs unfollow — the tx lands on this chain, and the cross-network
 * aggregate can disagree with it (indexer lag, or a follow made on another chain).
 * @param {Object} params
 * @param {Object} params.client Public client bound to the active chain.
 * @param {string} params.contractAddress LSP26 followerSystem on that chain.
 * @param {string} params.viewer Wallet whose follows are read.
 * @returns {Promise<Set<string>>}
 */
export const readFollowingSet = async ({ client, contractAddress, viewer }) => {
  const followingCount = await client.readContract({
    abi: followerSystemAbi,
    address: contractAddress,
    functionName: 'followingCount',
    args: [viewer],
  })

  const following = new Set()
  const total = Number(followingCount)

  for (let start = 0; start < total; start += MAX_FOLLOWING_READ_COUNT) {
    const end = Math.min(start + MAX_FOLLOWING_READ_COUNT, total)
    const slice = await client.readContract({
      abi: followerSystemAbi,
      address: contractAddress,
      functionName: 'getFollowsByIndex',
      args: [viewer, BigInt(start), BigInt(end)],
    })
    for (const followed of slice) following.add(followed.toLowerCase())
  }

  return following
}

/**
 * Splits a selection into the addresses followBatch will accept and the ones it
 * would revert on, judged by the active chain's contract.
 * @param {Object} params
 * @param {Object} params.client Public client bound to the active chain.
 * @param {string} params.contractAddress LSP26 followerSystem on that chain.
 * @param {Array<string>} params.addresses Selected profile addresses.
 * @param {string} params.viewer Wallet the follows are attributed to.
 * @returns {Promise<{followable: Array<string>, dropped: Array<{address: string, reason: string}>}>}
 */
export const preflightSelection = async ({ client, contractAddress, addresses, viewer }) => {
  const alreadyFollowing = await readFollowingSet({ client, contractAddress, viewer })

  const followable = []
  const dropped = []
  const viewerKey = viewer?.toLowerCase()

  for (const address of addresses) {
    const key = address.toLowerCase()

    if (key === viewerKey) dropped.push({ address, reason: 'self' })
    else if (alreadyFollowing.has(key)) dropped.push({ address, reason: 'already followed' })
    else followable.push(address)
  }

  return { followable, dropped }
}
