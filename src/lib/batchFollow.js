/**
 * @file lib/batchFollow.js
 * @description Pure helpers for following a selection of profiles in one LSP26
 * followBatch transaction (chunking and toast copy come from lib/batch.js). followBatch is all-or-nothing —
 * a single already-followed (or self) address reverts the whole array with
 * LSP26AlreadyFollowing / LSP26CannotSelfFollow, so the selection is validated
 * here instead of failing at wallet gas estimation.
 */

import followerSystemAbi from '@/abis/LSP26FollowerSystem'

// Each follow can trigger the target's LSP1 universalReceiver hook, so gas per
// entry is heavier than a like — 50 per transaction is a safe ceiling.
export const MAX_BATCH_FOLLOW_COUNT = 50
const MAX_FOLLOWING_READ_COUNT = 500

/**
 * Splits a selection into the addresses followBatch will accept and the ones it
 * would revert on. The authoritative "already following" answer is the active
 * chain's contract — the cross-network aggregate that seeds row state can say
 * "not following" while this chain says otherwise.
 * @param {Object} params
 * @param {Object} params.client Public client bound to the active chain.
 * @param {string} params.contractAddress LSP26 followerSystem on that chain.
 * @param {Array<string>} params.addresses Selected profile addresses.
 * @param {string} params.viewer Wallet the follows are attributed to.
 * @returns {Promise<{followable: Array<string>, dropped: Array<{address: string, reason: string}>}>}
 */
export const preflightSelection = async ({ client, contractAddress, addresses, viewer }) => {
  const followingCount = await client.readContract({
    abi: followerSystemAbi,
    address: contractAddress,
    functionName: 'followingCount',
    args: [viewer],
  })

  const alreadyFollowing = new Set()
  const total = Number(followingCount)

  for (let start = 0; start < total; start += MAX_FOLLOWING_READ_COUNT) {
    const end = Math.min(start + MAX_FOLLOWING_READ_COUNT, total)
    const slice = await client.readContract({
      abi: followerSystemAbi,
      address: contractAddress,
      functionName: 'getFollowsByIndex',
      args: [viewer, BigInt(start), BigInt(end)],
    })
    for (const followed of slice) alreadyFollowing.add(followed.toLowerCase())
  }

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
