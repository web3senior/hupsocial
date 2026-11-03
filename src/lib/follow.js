/**
 * @file lib/follow.js
 * @description The one way the browser follows and unfollows (config/socialGraph.js). A follow is
 * offchain: the signed-in session writes it through api/v1/follows — one signature per week, then
 * every tap is instant and free, on any chain. The only onchain step left is undoing a LUKSO LSP26
 * follow: an unfollow of someone the viewer also follows there sends LSP26 `unfollow` from the
 * wallet, otherwise the onchain row would keep them listed as following.
 */

import { getConnection, switchChain, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import followerSystemAbi from '@/abis/LSP26FollowerSystem'
import { SOCIAL_GRAPH_CHAIN_ID, socialGraphAddress } from '@/config/socialGraph'
import { config } from '@/config/wagmi'
import { clearChatToken, ensureChatSession } from './chatApi'

const json = async (response) => {
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.success) {
    const error = new Error(body?.error || 'Could not update follows')
    error.status = response.status
    throw error
  }
  return body.data
}

/**
 * Which of `targets` the viewer follows. `onchain` is the subset followed on LUKSO's LSP26.
 * @returns {Promise<{following: Set<string>, onchain: Set<string>}>} Lowercased addresses.
 */
export const fetchFollowRelations = async (viewer, targets) => {
  const list = [...new Set(targets.map((target) => target.toLowerCase()))].filter((target) => target !== viewer?.toLowerCase())
  if (!viewer || list.length === 0) return { following: new Set(), onchain: new Set() }

  const params = new URLSearchParams({ viewer, targets: list.join(',') })
  const data = await json(await fetch(`/api/v1/follows?${params}`, { cache: 'no-store' }))
  return { following: new Set(data.following), onchain: new Set(data.onchain) }
}

const putFollows = (token, targets, following) =>
  fetch('/api/v1/follows', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ targets, following }),
  }).then(json)

// The wallet half of an unfollow: LSP26 on LUKSO, for the targets followed there
const unfollowOnchain = async (targets) => {
  const registry = socialGraphAddress()
  if (!registry || targets.length === 0) return

  if (getConnection(config).chainId !== SOCIAL_GRAPH_CHAIN_ID) await switchChain(config, { chainId: SOCIAL_GRAPH_CHAIN_ID })
  const hash = await writeContract(config, {
    address: registry,
    abi: followerSystemAbi,
    functionName: targets.length === 1 ? 'unfollow' : 'unfollowBatch',
    args: targets.length === 1 ? targets : [targets],
    chainId: SOCIAL_GRAPH_CHAIN_ID,
  })
  const receipt = await waitForTransactionReceipt(config, { chainId: SOCIAL_GRAPH_CHAIN_ID, hash })
  if (receipt.status !== 'success') throw new Error('The LUKSO unfollow did not go through')
}

/**
 * Follows or unfollows `targets` as `address`.
 * @param {Object} params
 * @param {string} params.address The connected EVM wallet.
 * @param {string[]} params.targets Accounts to follow or unfollow (up to MAX_FOLLOW_TARGETS).
 * @param {boolean} params.following true to follow, false to unfollow.
 * @param {Function} params.signMessageAsync wagmi signer, for the one-time session sign-in.
 * @param {number} [params.chainId] The wallet's chain, passed to the sign-in.
 * @param {Iterable<string>} [params.onchain] Targets followed on LUKSO (fetchFollowRelations), whose
 *   unfollow also goes onchain.
 * @throws {Error} code 'ONCHAIN_UNFOLLOW_FAILED' when the offchain unfollow landed but the LUKSO one did not.
 */
export const setFollowing = async ({ address, targets, following, signMessageAsync, chainId, onchain = [] }) => {
  const wallet = address.toLowerCase()
  let token = await ensureChatSession(wallet, signMessageAsync, chainId, 'follow')

  try {
    await putFollows(token, targets, following)
  } catch (error) {
    if (error.status !== 401) throw error
    // An expired or revoked session: sign in again once
    clearChatToken(wallet)
    token = await ensureChatSession(wallet, signMessageAsync, chainId, 'follow')
    await putFollows(token, targets, following)
  }

  if (following) return

  const onchainSet = new Set([...onchain].map((target) => target.toLowerCase()))
  const onchainTargets = targets.filter((target) => onchainSet.has(target.toLowerCase()))
  try {
    await unfollowOnchain(onchainTargets)
  } catch (cause) {
    const error = new Error(`Unfollowed on Hup, but the LUKSO follow is still onchain`, { cause })
    error.code = 'ONCHAIN_UNFOLLOW_FAILED'
    throw error
  }
}
