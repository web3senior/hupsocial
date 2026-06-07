import Web3 from 'web3'
import { config, CONTRACTS, setNetworkColor } from '@/config/wagmi'
import postAbi from '@/abi/post.json'
import statusAbi from '@/abi/status.json'
import commentAbi from '@/abi/post-comment.json'
import HupCommunityABI from '@/abis/HupCommunity'

/**
 * Get user selected chain
 * @returns Array [chainObject, contractAddressMapObject]
 */
export const getActiveChain = () => {
  const DEFAULT_CHAIN_ID = 42

  if (typeof window !== 'undefined') {
    /* Extract the multichain context from local storage cleanly */
    const activeChain = localStorage.getItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`) || DEFAULT_CHAIN_ID.toString()
    const userSelectedChain = config.chains.filter((filterItem) => filterItem.id.toString() === activeChain.toString())

    if (userSelectedChain.length > 0) {
      setNetworkColor(userSelectedChain[0])
      return [userSelectedChain[0], CONTRACTS[`chain${userSelectedChain[0].id}`]]
    }
  }

  const defaultChain = config.chains.find((filterItem) => filterItem.id === DEFAULT_CHAIN_ID)
  if (defaultChain) {
    return [defaultChain, CONTRACTS[`chain${DEFAULT_CHAIN_ID}`]]
  }

  console.error('Default chain not found in config.')
  return [null, null]
}

/**
 * Initialize post contract
 */
export function initHupContract() {
  const activeChain = getActiveChain()
  if (!activeChain[0] || !activeChain[1]) throw new Error('Active network deployment configuration context unresolvable.')

  const rpcUrl = activeChain[0].rpcUrls.default.http[0]
  if (!rpcUrl) throw new Error('WEB3_RPC_URL is not defined in environment variables.')

  if (!activeChain[1].hup) {
    throw new Error(`Hup core contract address is not configured for network sequence: ${activeChain[0].name}`)
  }

  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl))
  const contract = new web3.eth.Contract(postAbi, activeChain[1].hup)
  return { web3, contract }
}

export function initHupCommunityContract() {
  const activeChain = getActiveChain()
  if (!activeChain[0] || !activeChain[1]) throw new Error('Active network deployment configuration context unresolvable.')

  const rpcUrl = activeChain[0].rpcUrls.default.http[0]
  if (!rpcUrl) throw new Error('WEB3_RPC_URL is not defined in environment variables.')

  if (!activeChain[1].community) {
    throw new Error(`Hup Community contract address is not configured for network sequence: ${activeChain[0].name}`)
  }

  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl))
  const contract = new web3.eth.Contract(HupCommunityABI, activeChain[1].community)
  return { web3, contract }
}

/**
 * Initialize post comment contract
 */
export function initPostCommentContract() {
  const activeChain = getActiveChain()
  if (!activeChain[0] || !activeChain[1]) throw new Error('Active network deployment configuration context unresolvable.')

  const rpcUrl = activeChain[0].rpcUrls.default.http[0]
  if (!rpcUrl) throw new Error('WEB3_RPC_URL is not defined in environment variables.')

  if (!activeChain[1].comment) {
    throw new Error(`Hup Comment contract address is not configured for network sequence: ${activeChain[0].name}`)
  }

  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl))
  const contract = new web3.eth.Contract(commentAbi, activeChain[1].comment)
  return { web3, contract }
}

/**
 * Initialize status contract
 */
export function initStatusContract() {
  const activeChain = getActiveChain()
  if (!activeChain[0] || !activeChain[1]) throw new Error('Active network deployment configuration context unresolvable.')

  const rpcUrl = activeChain[0].rpcUrls.default.http[0]
  if (!rpcUrl) throw new Error('WEB3_RPC_URL is not defined in environment variables.')

  if (!activeChain[1].status) {
    throw new Error(`Hup Status contract address is not configured for network sequence: ${activeChain[0].name}`)
  }

  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl))
  const contract = new web3.eth.Contract(statusAbi, activeChain[1].status)
  return { web3, contract }
}

export async function getCommunityCount() {
  try {
    const { contract } = initHupCommunityContract()
    const result = await contract.methods.communityCount().call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getStatus(address) {
  try {
    const { contract } = initStatusContract()
    const result = await contract.methods.statuses(address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getMaxLength() {
  try {
    const { contract } = initStatusContract()
    const result = await contract.methods.maxLength().call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getUserSessions(address) {
  try {
    const { contract } = initHupContract()
    const result = await contract.methods.userSessions(address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getPosts(index, count, address = '0x0000000000000000000000000000000000000000') {
  try {
    const { contract } = initHupContract()
    const result = await contract.methods.getPosts(index, count, address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getPostByIndex(index, address = '0x0000000000000000000000000000000000000000') {
  try {
    const { contract } = initHupContract()
    const result = await contract.methods.getPostByIndex(index, address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getPostCommentCount(parentId) {
  try {
    const { contract } = initPostCommentContract()
    const result = await contract.methods.getPostCommentCount(parentId).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getReplyCount(postId) {
  try {
    const { contract } = initPostCommentContract()
    const result = await contract.methods.getReplyCount(postId).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getCommentsByPostId(postId, startIndex, count, address = '0x0000000000000000000000000000000000000000') {
  try {
    const { contract } = initPostCommentContract()
    const result = await contract.methods.getCommentsByPostId(postId, startIndex, count, address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getRepliesByCommentId(commentId, startIndex, count, address = '0x0000000000000000000000000000000000000000') {
  try {
    const { contract } = initPostCommentContract()
    const result = await contract.methods.getRepliesByCommentId(commentId, startIndex, count, address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getPostCount() {
  try {
    const { contract } = initHupContract()
    const result = await contract.methods.postCount().call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getVoteCountsForPoll(id) {
  try {
    const { contract } = initHupContract()
    const result = await contract.methods.getVoteCountsForPoll(id).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getVoteCount(id, optionIndex) {
  try {
    const { contract } = initHupContract()
    const result = await contract.methods.getVoteCount(id, optionIndex).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getVoterChoices(id, address) {
  try {
    const { contract } = initHupContract()
    const result = await contract.methods.getVoterChoice(id, address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getHasLikedPost(postId, addr) {
  try {
    const { contract } = initHupContract()
    const result = await contract.methods.hasLiked(postId, addr).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getHasLikedComment(commentId, addr) {
  try {
    const { contract } = initPostCommentContract()
    const result = await contract.methods.hasLikedComment(commentId, addr).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getComment(commentId, address = '0x0000000000000000000000000000000000000000') {
  try {
    const { contract } = initPostCommentContract()
    const result = await contract.methods.getComment(commentId, address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getPostsByCreator(creator, startIndex, count, viewer = '0x0000000000000000000000000000000000000000') {
  try {
    const { contract } = initHupContract()
    const result = await contract.methods.getPostsByCreator(creator, startIndex, count, viewer).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getCreatorPostCount(creator) {
  try {
    const { contract } = initHupContract()
    const result = await contract.methods.getCreatorPostCount(creator).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getAllEvents() {
  try {
    const { web3, contract } = initHupContract()
    const latestBlock = await web3.eth.getBlockNumber()
    console.log(`Latest block: ${latestBlock}`)

    const allEvents = await contract.getPastEvents('allEvents', {
      fromBlock: 0,
      toBlock: 'latest',
    })

    console.log(`All historical events: count(${allEvents.length})`)
    allEvents.forEach((event) => {
      console.log('---')
      console.log(`Event Name: ${event.event}`)
      console.log(`Block Number: ${event.blockNumber}`)
      console.log(`Transaction Hash: ${event.transactionHash}`)
      console.log('Return Values:', event.returnValues)
    })
    return allEvents
  } catch (error) {
    console.error('Error fetching past events:', error)
  }
}

export async function getPostLikedEvents() {
  try {
    const { contract } = initHupContract()
    const reactEvents = await contract.getPastEvents('PostLiked', {
      fromBlock: 0,
      toBlock: 'latest',
    })
    return reactEvents
  } catch (error) {
    console.error('Error fetching past events:', error)
    return error
  }
}

/**
 * Fetches "PostLiked" events in chunks to prevent RPC timeouts and handle large datasets.
 * @param {number} startBlock - The block number where the contract was deployed.
 * @param {number} endBlock - The block number to start scanning backwards from (usually latest).
 * @param {number} chunkSize - Number of blocks to scan per request (default 5000).
 * @returns {Promise<Array>} - Array of Web3.js event objects.
 */
export async function getLikesPaginated(startBlock, endBlock, chunkSize = 10000, targetCount = 20) {
  try {
    const { contract } = initHupContract()
    let allEvents = []
    let currentTo = endBlock

    while (allEvents.length < targetCount && currentTo >= startBlock) {
      const currentFrom = Math.max(startBlock, currentTo - chunkSize + 1)
      
      const events = await contract.getPastEvents('PostLiked', {
        fromBlock: currentFrom,
        toBlock: currentTo,
      })

      allEvents.push(...events.reverse())
      currentTo = currentFrom - 1
    }

    return {
      events: allEvents.slice(0, targetCount),
      lastScannedBlock: currentTo
    }
  } catch (error) {
    console.error('Error during chunked event parsing logs:', error)
    return { events: [], lastScannedBlock: endBlock, error }
  }
}