import { ethers } from 'ethers'
import { getUserSessions } from './communication'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const localStorageBurnerAddress = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}burner_address`
const localStorageBurnerKey = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}burner_key`

const getRpcUrl = (chain) => chain?.rpcUrls?.default?.http?.[0] || chain?.rpcUrl || chain?.rpc || process.env.NEXT_PUBLIC_LUKSO_RPC_URL

const getBurnerSigner = (chain) => {
  const privateKey = localStorage.getItem(localStorageBurnerKey)
  const storedAddress = localStorage.getItem(localStorageBurnerAddress)

  if (!privateKey || !storedAddress) return null

  const rpcUrl = getRpcUrl(chain)
  if (!rpcUrl) throw new Error('Missing RPC URL for burner transaction')

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const wallet = new ethers.Wallet(privateKey, provider)

  if (wallet.address.toLowerCase() !== storedAddress.toLowerCase()) {
    throw new Error('Stored burner private key does not match stored burner address')
  }

  return wallet
}

export const writeWithBurnerSession = async ({ chain, contractAddress, abi, functionName, args }) => {
  const burnerSigner = getBurnerSigner(chain)

  if (!burnerSigner) {
    throw new Error('No burner session key found')
  }

  const contract = new ethers.Contract(contractAddress, abi, burnerSigner)
  const tx = await contract[functionName](...args)

  await tx.wait()
  return tx
}

const getStoredBurner = () => {
  if (typeof window === 'undefined') return null

  const privateKey = localStorage.getItem(localStorageBurnerKey)
  const address = localStorage.getItem(localStorageBurnerAddress)
  console.log('Retrieved burner from localStorage:', { address, privateKey: privateKey ? '***' : null })
 
  if (!privateKey || !address) return null
  console.log('Validating burner credentials...')

  try {
    const wallet = new ethers.Wallet(privateKey)
    console.log('Derived address from private key:', wallet.address)
    console.log('Comparing with stored address:', address)

    if (wallet.address.toLowerCase() !== address.toLowerCase()) {
      return null
    }

    return {
      address,
      privateKey,
    }
  } catch (err) {
    console.error('Invalid burner private key in localStorage', err)
    return null
  }
}

export const isSessionActive = async ({ userAddress, publicClient }) => {
  if (!userAddress) {
    return {
      active: false,
      burnerAddress: null,
      expiresAt: null,
    }
  }

  const storedBurner = getStoredBurner()

  if (!storedBurner) {
    return {
      active: false,
      burnerAddress: null,
      expiresAt: null,
    }
  }

  const session = await getUserSessions(userAddress)
  console.log(session)
  const latestBlock = await publicClient?.getBlock()
  const networkTime = latestBlock?.timestamp ?? BigInt(Math.floor(Date.now() / 1000))

  const sessionBurner = session?.burnerKey ?? session?.[0]
  const expiresAt = BigInt(session?.expiresAt ?? session?.[1] ?? 0)

  const active =
    Boolean(sessionBurner) &&
    sessionBurner !== ZERO_ADDRESS &&
    sessionBurner.toLowerCase() === storedBurner.address.toLowerCase() &&
    expiresAt > networkTime

  return {
    active,
    burnerAddress: sessionBurner,
    expiresAt,
  }
}
