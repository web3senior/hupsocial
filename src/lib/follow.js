/**
 * @file lib/follow.js
 * @description Universal Profiles follow through LUKSO's LSP26 registry. Other wallets use
 * the signed-in offchain API. Existing mixed follows are cleared when unfollowing.
 */

import { getConnection, getPublicClient, switchChain, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import followerSystemAbi from '@/abis/LSP26FollowerSystem'
import { MAX_FOLLOW_TARGETS, SOCIAL_GRAPH_CHAIN_ID, socialGraphAddress } from '@/config/socialGraph'
import { config } from '@/config/wagmi'
import { isEvmAddress } from './address'
import { clearChatToken, ensureChatSession } from './chatApi'
import { isOnchainFollowAccount } from './followAccount'

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
 * @returns {Promise<{following: Set<string>, onchain: Set<string>, offchain: Set<string>}>} Lowercased addresses.
 */
export const fetchFollowRelations = async (viewer, targets) => {
  const list = [...new Set(targets.map((target) => target.toLowerCase()))].filter((target) => target !== viewer?.toLowerCase())
  if (!viewer || list.length === 0) return { following: new Set(), onchain: new Set(), offchain: new Set() }

  const params = new URLSearchParams({ viewer, targets: list.join(',') })
  const data = await json(await fetch(`/api/v1/follows?${params}`, { cache: 'no-store' }))
  return { following: new Set(data.following), onchain: new Set(data.onchain), offchain: new Set(data.offchain) }
}

const putFollows = (token, targets, following) =>
  fetch('/api/v1/follows', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ targets, following }),
  }).then(json)

const setOnchainFollowing = async (client, address, targets, following) => {
  if (targets.length === 0) return
  const registry = socialGraphAddress()
  if (!registry) throw new Error('The LUKSO follow registry is not configured')

  // LSP26 reverts the whole batch for an already-followed or not-followed target.
  // Read the live registry because the indexer can lag behind a confirmed transaction.
  const states = await Promise.all(targets.map((target) => client.readContract({
    address: registry,
    abi: followerSystemAbi,
    functionName: 'isFollowing',
    args: [address, target],
  })))
  const changes = targets.filter((_, index) => states[index] !== following)
  if (changes.length === 0) return

  if (getConnection(config).chainId !== SOCIAL_GRAPH_CHAIN_ID) await switchChain(config, { chainId: SOCIAL_GRAPH_CHAIN_ID })
  if (getConnection(config).address?.toLowerCase() !== address.toLowerCase()) throw new Error('Your wallet changed. Please try again')
  const action = following ? 'follow' : 'unfollow'
  const hash = await writeContract(config, {
    account: address,
    address: registry,
    abi: followerSystemAbi,
    functionName: changes.length === 1 ? action : `${action}Batch`,
    args: changes.length === 1 ? changes : [changes],
    chainId: SOCIAL_GRAPH_CHAIN_ID,
  })
  const receipt = await waitForTransactionReceipt(config, { chainId: SOCIAL_GRAPH_CHAIN_ID, hash })
  if (receipt.status !== 'success') throw new Error(`The LUKSO ${action} did not go through`)
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
 * @returns {Promise<{onchain: boolean}>} The confirmed route for the new follow state.
 */
export const setFollowing = async ({ address, targets, following, signMessageAsync, chainId, onchain = [] }) => {
  if (getConnection(config).address?.toLowerCase() !== address?.toLowerCase()) throw new Error('Your wallet changed. Please try again')
  const wallet = address.toLowerCase()
  const uniqueTargets = [...new Set(targets.map((target) => target.toLowerCase()))].filter((target) => target !== wallet)
  if (uniqueTargets.length === 0) throw new Error('Name at least one other account')
  if (uniqueTargets.length > MAX_FOLLOW_TARGETS) throw new Error(`Follow up to ${MAX_FOLLOW_TARGETS} accounts at a time`)
  if (!uniqueTargets.every(isEvmAddress)) throw new Error('Every account must be a wallet address')
  const client = getPublicClient(config, { chainId: SOCIAL_GRAPH_CHAIN_ID })
  const isProfile = await isOnchainFollowAccount(client, address)

  if (isProfile) {
    if (!following) {
      const { offchain } = await fetchFollowRelations(address, uniqueTargets)
      const legacyTargets = uniqueTargets.filter((target) => offchain.has(target))
      if (legacyTargets.length > 0) await setOffchainFollowing(wallet, legacyTargets, false, signMessageAsync, chainId)
    }
    await setOnchainFollowing(client, address, uniqueTargets, following)
    return { onchain: following }
  }

  await setOffchainFollowing(wallet, uniqueTargets, following, signMessageAsync, chainId)
  if (!following) {
    const onchainSet = new Set([...onchain].map((target) => target.toLowerCase()))
    await setOnchainFollowing(client, address, uniqueTargets.filter((target) => onchainSet.has(target)), false)
  }
  return { onchain: false }
}

const setOffchainFollowing = async (wallet, targets, following, signMessageAsync, chainId) => {
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
}
