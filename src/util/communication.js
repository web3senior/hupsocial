import Web3 from 'web3'
import ABI from '@/abi/somnia.json'

/**
 * Initialize Web3
 */
export function initContract() {
  const rpcUrl = process.env.NEXT_PUBLIC_SOMNIA_PROVIDER

  if (!rpcUrl) throw new Error('WEB3_RPC_URL is not defined in environment variables.')

  // 1. Initialize Web3 with an HttpProvider for server-side connection
  const web3 = new Web3(window.ethereum) //new Web3.providers.HttpProvider(rpcUrl)

  // Create a Contract instance
  const contract = new web3.eth.Contract(ABI, process.env.NEXT_PUBLIC_SOMNIA_CONTRACT)
  return { web3, contract }
}

export async function getPolls(index, count) {
  const { web3, contract } = initContract()

  try {
    const result = await contract.methods.getPolls(index, count).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getPollCount() {
  const { web3, contract } = initContract()

  try {
    const result = await contract.methods.pollCount().call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getVoteCountsForPoll(pollId) {
  const { web3, contract } = initContract()

  try {
    const result = await contract.methods.getVoteCountsForPoll(pollId).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}

export async function getVoteCount(pollId, optionIndex) {
  const { web3, contract } = initContract()

  try {
    const result = await contract.methods.getVoteCount(pollId, optionIndex).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}
export async function getVoterChoices(pollId, address) {
  const { web3, contract } = initContract()

  try {
    const result = await contract.methods.voterChoices(pollId, address).call()
    return result
  } catch (error) {
    console.error('Error fetching contract data with Web3.js:', error)
    return { error }
  }
}
export async function getAllEvents() {
  const { web3, contract } = initContract()

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
  const { web3, contract } = initContract()

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
  const { web3, contract } = initContract()

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
