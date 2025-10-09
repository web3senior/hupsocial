import Web3 from 'web3'
import postAbi from '@/abi/post.json'
import statusAbi from '@/abi/status.json'
import commentAbi from '@/abi/post-comment.json'

/**
 * Initialize post contract
 */
export function initPostContract() {
  const rpcUrl = process.env.NEXT_PUBLIC_LUKSO_PROVIDER

  if (!rpcUrl) throw new Error('WEB3_RPC_URL is not defined in environment variables.')

  // 1. Initialize Web3 with an HttpProvider for server-side connection
  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl))

  // Create a Contract instance
  const contract = new web3.eth.Contract(postAbi, process.env.NEXT_PUBLIC_CONTRACT_POST)
  return { web3, contract }
}

/**
 * Initialize post comment contract
 */
export function initPostCommentContract() {
  const rpcUrl = process.env.NEXT_PUBLIC_LUKSO_PROVIDER

  if (!rpcUrl) throw new Error('WEB3_RPC_URL is not defined in environment variables.')

  // 1. Initialize Web3 with an HttpProvider for server-side connection
  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl))

  // Create a Contract instance
  const contract = new web3.eth.Contract(commentAbi, process.env.NEXT_PUBLIC_CONTRACT_POST_COMMENT)
  return { web3, contract }
}

/**
 * Initialize status contract
 */
export function initStatusContract() {
  const rpcUrl = process.env.NEXT_PUBLIC_LUKSO_PROVIDER

  if (!rpcUrl) throw new Error('WEB3_RPC_URL is not defined in environment variables.')

  // 1. Initialize Web3 with an HttpProvider for server-side connection
  const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl))

  // Create a Contract instance
  const contract = new web3.eth.Contract(statusAbi, process.env.NEXT_PUBLIC_CONTRACT_STATUS)
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

export async function getPosts(index, count) {
  const { web3, contract } = initPostContract()

  try {
    const result = await contract.methods.getPosts(index, count).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getPostByIndex(index) {
  const { web3, contract } = initPostContract()

  try {
    const result = await contract.methods.getPostByIndex(index).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}
export async function getPostCommentCount(postId) {
  const { web3, contract } = initPostCommentContract()

  try {
    const result = await contract.methods.getPostCommentCount(postId).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}
export async function getCommentsByPostId(postId, startIndex, count) {
  const { web3, contract } = initPostCommentContract()

  try {
    const result = await contract.methods.getCommentsByPostId(postId, startIndex, count).call()
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

export async function getPostsByCreator(addr, startIndex, count ) {
  const { web3, contract } = initPostContract()

  try {
    const result = await contract.methods.getPostsByCreator(addr,startIndex, count ).call()
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
