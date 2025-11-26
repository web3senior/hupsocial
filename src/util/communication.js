import Web3 from 'web3'
import { config, CONTRACTS, setNetworkColor } from '@/config/wagmi'
import postAbi from '@/abi/post.json'
import statusAbi from '@/abi/status.json'
import commentAbi from '@/abi/post-comment.json'

/**
 * Get user selected chain
 * @returns Array [chainObject, contractAddress]
 */
export const getActiveChain = () => {
  const DEFAULT_CHAIN_ID = 4201

  if (typeof window !== 'undefined') {
    // Client-side execution: Read from localStorage
    const activeChain = localStorage.getItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`) || DEFAULT_CHAIN_ID.toString()
    const userSelectedChain = config.chains.filter((filterItem) => filterItem.id.toString() === activeChain.toString())

    // Ensure a chain was actually found
    if (userSelectedChain.length > 0) {
      // Change primary color of the app
      setNetworkColor(userSelectedChain[0])
      return [userSelectedChain[0], CONTRACTS[`chain${userSelectedChain[0].id}`]]
    }
  }

  // Server-side execution OR localStorage failed to find a matching chain
  const defaultChain = config.chains.find((filterItem) => filterItem.id === DEFAULT_CHAIN_ID)

  if (defaultChain) {
    return [defaultChain, CONTRACTS[`chain${DEFAULT_CHAIN_ID}`]]
  }

  // Fallback if the default chain isn't even in config (should rarely happen)
  console.error('Default chain not found in config.')
  return [null, null]
}

// /**
//  * Get user selected chain
//  * @returns Array
//  */
// export const getActiveChain = () => {

//   if (typeof window !== 'undefined') {
//   const activeChain = localStorage.getItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`) || 4201
//   const userSelectedChain = config.chains.filter((filterItem) => filterItem.id.toString() === activeChain.toString())

//   return [userSelectedChain[0], CONTRACTS[`chain${userSelectedChain[0].id}`]]
//   }

// }

/**
 * Initialize post contract
 */
export function initPostContract() {
  const activeChain = getActiveChain()
  const rpcUrl = activeChain[0].rpcUrls.default.http[0]

  if (!rpcUrl) throw new Error('WEB3_RPC_URL is not defined in environment variables.')

  // Initialize Web3 with an HttpProvider for server-side connection
  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl))

  // Create a Contract instance
  const contract = new web3.eth.Contract(postAbi, activeChain[1].post)
  return { web3, contract }
}

/**
 * Initialize post comment contract
 */
export function initPostCommentContract() {
  const activeChain = getActiveChain()
  const rpcUrl = activeChain[0].rpcUrls.default.http[0]

  if (!rpcUrl) throw new Error('WEB3_RPC_URL is not defined in environment variables.')

  // Initialize Web3 with an HttpProvider for server-side connection
  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl))

  // Create a Contract instance
  const contract = new web3.eth.Contract(commentAbi, activeChain[1].comment)
  return { web3, contract }
}

/**
 * Initialize status contract
 */
export function initStatusContract() {
  const activeChain = getActiveChain()
  const rpcUrl = activeChain[0].rpcUrls.default.http[0]

  if (!rpcUrl) throw new Error('WEB3_RPC_URL is not defined in environment variables.')

  // Initialize Web3 with an HttpProvider for server-side connection
  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl))
  // Create a Contract instance
  const contract = new web3.eth.Contract(statusAbi, activeChain[1].status)
  return { web3, contract }
}

export async function getStatus(address) {
  const { web3, contract } = initStatusContract()

  try {
    const result = await contract.methods.statuses(address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getMaxLength() {
  const { web3, contract } = initStatusContract()

  try {
    const result = await contract.methods.maxLength().call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getPosts(index, count, address = `0x0000000000000000000000000000000000000000`) {
  const { web3, contract } = initPostContract()

  try {
    const result = await contract.methods.getPosts(index, count, address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getPostByIndex(index, address = `0x0000000000000000000000000000000000000000`) {
  const { web3, contract } = initPostContract()

  try {
    const result = await contract.methods.getPostByIndex(index, address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}
export async function getPostCommentCount(parentId) {
  const { web3, contract } = initPostCommentContract()

  try {
    const result = await contract.methods.getPostCommentCount(parentId).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getReplyCount(postId) {
  const { web3, contract } = initPostCommentContract()

  try {
    const result = await contract.methods.getReplyCount(postId).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getCommentsByPostId(postId, startIndex, count, address = `0x0000000000000000000000000000000000000000`) {
  const { web3, contract } = initPostCommentContract()

  try {
    const result = await contract.methods.getCommentsByPostId(postId, startIndex, count, address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getRepliesByCommentId(commentId, startIndex, count, address = `0x0000000000000000000000000000000000000000`) {
  const { web3, contract } = initPostCommentContract()

  try {
    const result = await contract.methods.getRepliesByCommentId(commentId, startIndex, count, address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getPostCount() {
  const { web3, contract } = initPostContract()

  try {
    const result = await contract.methods.postCount().call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getVoteCountsForPoll(id) {
  const { web3, contract } = initPostContract()

  try {
    const result = await contract.methods.getVoteCountsForPoll(id).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getVoteCount(id, optionIndex) {
  const { web3, contract } = initPostContract()

  try {
    const result = await contract.methods.getVoteCount(id, optionIndex).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}
export async function getVoterChoices(id, address) {
  const { web3, contract } = initPostContract()

  try {
    const result = await contract.methods.getVoterChoice(id, address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getHasLikedPost(postId, addr) {
  const { web3, contract } = initPostContract()

  try {
    const result = await contract.methods.hasLiked(postId, addr).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getHasLikedComment(commentId, addr) {
  const { web3, contract } = initPostCommentContract()

  try {
    const result = await contract.methods.hasLikedComment(commentId, addr).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getComment(commentId, address = `0x0000000000000000000000000000000000000000`) {
  const { web3, contract } = initPostCommentContract()

  try {
    const result = await contract.methods.getComment(commentId, address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getPostsByCreator(creator, startIndex, count, viewer = `0x0000000000000000000000000000000000000000`) {
  const { web3, contract } = initPostContract()

  try {
    const result = await contract.methods.getPostsByCreator(creator, startIndex, count, viewer).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getCreatorPostCount(creator) {
  const { web3, contract } = initPostContract()

  try {
    const result = await contract.methods.getCreatorPostCount(creator).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getAllEvents() {
  const { web3, contract } = initPostContract()

  try {
    // Get the latest block number (optional, but good for defining a range)
    const latestBlock = await web3.eth.getBlockNumber()
    console.log(`Latest block: ${latestBlock}`)

    // Fetch all events from the contract
    const allEvents = await contract.getPastEvents('allEvents', {
      fromBlock: 0, // Start from block 0 or a specific block number
      toBlock: 'latest', // Go up to the latest block or a specific block number
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
export async function getAllReacted() {
  const { web3, contract } = initPostContract()

  try {
    // Get the latest block number (optional, but good for defining a range)
    const latestBlock = await web3.eth.getBlockNumber()

    // Fetch specific events (e.g., 'Transfer' events)
    const reactEvents = await contract.getPastEvents('Reacted', {
      fromBlock: 0, // Example: fetch events from the last 1000 blocks
      toBlock: 'latest',
    })

    // reactEvents.forEach(event => {
    //     console.log('---');
    //     console.log(`Block Number: ${event.blockNumber}`);
    //     console.log(`From: ${event.returnValues.from}`);
    //     console.log(`To: ${event.returnValues.to}`);
    //     console.log(`Value: ${event.returnValues.value}`);
    // });
    return reactEvents
  } catch (error) {
    console.error('Error fetching past events:', error)
    return error
  }
}
export async function getLastGift() {
  const { web3, contract } = initPostContract()

  try {
    // Get the latest block number (optional, but good for defining a range)
    const latestBlock = await web3.eth.getBlockNumber()

    // Fetch specific events (e.g., 'Transfer' events)
    const reactEvents = await contract.getPastEvents('Reacted', {
      fromBlock: 0, // Example: fetch events from the last 1000 blocks
      toBlock: 'latest',
    })

    // reactEvents.forEach(event => {
    //     console.log('---');
    //     console.log(`Block Number: ${event.blockNumber}`);
    //     console.log(`From: ${event.returnValues.from}`);
    //     console.log(`To: ${event.returnValues.to}`);
    //     console.log(`Value: ${event.returnValues.value}`);
    // });
    return reactEvents
  } catch (error) {
    console.error('Error fetching past events:', error)
    return error
  }
}
