/**
 * @file lib/followSystem.js
 * @description Server-only reader for the LSP26FollowerSystem contract, used to
 * resolve "who does this wallet follow" live on-chain (no indexer needed - the
 * contract exposes enumerable getters). Takes an explicit chainId since server
 * routes can't rely on the browser-resolved getActiveChain().
 */

import Web3 from 'web3'
import { config, CONTRACTS } from '@/config/wagmi'
import followerSystemAbi from '@/abis/LSP26FollowerSystem.json'

/**
 * Resolves the list of addresses a wallet follows on a given chain.
 * Returns `supported: false` when the chain has no followerSystem contract configured.
 */
export async function getFollowingAddresses(chainId, viewerAddress) {
  const chain = config.chains.find((c) => c.id === Number(chainId))
  const contracts = CONTRACTS[`chain${chainId}`]

  if (!chain || !contracts?.followerSystem) {
    return { supported: false, addresses: [] }
  }

  const web3 = new Web3(new Web3.providers.HttpProvider(chain.rpcUrls.default.http[0]))
  const contract = new web3.eth.Contract(followerSystemAbi, contracts.followerSystem)

  try {
    const count = Number(await contract.methods.followingCount(viewerAddress).call())
    if (count === 0) return { supported: true, addresses: [] }

    const addresses = await contract.methods.getFollowsByIndex(viewerAddress, 0, count).call()
    return { supported: true, addresses: addresses.map((a) => a.toLowerCase()) }
  } catch (error) {
    console.error('Error fetching following addresses:', error)
    return { supported: true, addresses: [] }
  }
}
