import { ethers } from 'ethers'
import { getUserSessions } from './communication'
import { decryptData, isPrivateKeyEncrypted } from './cryptoHelper'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const localStorageBurnerAddress = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}burner_address`
export const localStorageBurnerKey = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}burner_key`
export const sessionStorageUnlockedKey = `hup_unlocked_burner_key`

const getRpcUrl = (chain) => chain?.rpcUrls?.default?.http?.[0] || chain?.rpcUrl || chain?.rpc || process.env.NEXT_PUBLIC_LUKSO_RPC_URL

/**
 * Retrieves the burner signer. Asynchronously decrypts the key if locked.
 *
 * @param {object} chain - The chain object containing RPC configurations.
 * @param {string|null} password - Optional password to decrypt the key if locked.
 */
export const getBurnerSigner = async (chain, password = null) => {
  const storedAddress = localStorage.getItem(localStorageBurnerAddress)
  const storedKey = localStorage.getItem(localStorageBurnerKey)

  if (!storedKey || !storedAddress) return null

  // 1. Check in-memory cache first
  let privateKey = sessionStorage.getItem(sessionStorageUnlockedKey)

  if (!privateKey) {
    // 2. Fallback to legacy unencrypted key
    if (!isPrivateKeyEncrypted(storedKey)) {
      privateKey = storedKey
    } else {
      // 3. Encrypted key requires password to decrypt
      if (!password) {
        // throw new Error('PASSWORD_REQUIRED')
        password = prompt(`Please enter your password`)
      }
      privateKey = await decryptData(storedKey, password)

      // Cache decrypted key in sessionStorage for this tab session
      sessionStorage.setItem(sessionStorageUnlockedKey, privateKey)
    }
  }

  const rpcUrl = getRpcUrl(chain)
  if (!rpcUrl) throw new Error('Missing RPC URL for burner transaction')

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const wallet = new ethers.Wallet(privateKey, provider)

  if (wallet.address.toLowerCase() !== storedAddress.toLowerCase()) {
    throw new Error('Stored burner private key does not match stored burner address')
  }

  return wallet
}

/**
 * Writes a transaction with the burner session key.
 * Bubbles up 'PASSWORD_REQUIRED' if the key needs to be unlocked.
 */
export const writeWithBurnerSession = async ({ chain, contractAddress, abi, functionName, args, password = null }) => {
  // Retrieve signer (decrypts key asynchronously if needed)
  const burnerSigner = await getBurnerSigner(chain, password)

  if (!burnerSigner) {
    throw new Error('No burner session key found')
  }

  const contract = new ethers.Contract(contractAddress, abi, burnerSigner)
  const tx = await contract[functionName](...args)

  await tx.wait()
  return tx
}

/**
 * Reads stored credentials. Designed to be fast and non-blocking for background checks.
 * Does not decrypt locked keys to avoid unnecessary password prompts.
 */
export const getStoredBurner = () => {
  if (typeof window === 'undefined') return null

  const address = localStorage.getItem(localStorageBurnerAddress)
  const privateKey = localStorage.getItem(localStorageBurnerKey)

  if (!privateKey || !address) return null

  try {
    // If it's a legacy unencrypted key, validate it immediately
    if (!isPrivateKeyEncrypted(privateKey)) {
      const wallet = new ethers.Wallet(privateKey)
      if (wallet.address.toLowerCase() !== address.toLowerCase()) {
        return null
      }
    }

    // For encrypted keys, we trust the stored address (validated during setup/import)
    return {
      address,
      privateKey,
    }
  } catch (err) {
    console.error('Invalid burner private key in localStorage', err)
    return null
  }
}

/**
 * Checks if the session is active on-chain.
 * Runs completely in the background without needing to decrypt the private key.
 */
export const isSessionActive = async ({ userAddress, publicClient }) => {
  const session = await getUserSessions(userAddress)

  if (!userAddress) {
    return {
      session,
      active: false,
      burnerAddress: null,
      expiresAt: null,
    }
  }

  const storedBurner = getStoredBurner()

  if (!storedBurner) {
    return {
      session,
      active: false,
      burnerAddress: null,
      expiresAt: null,
    }
  }

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
    session,
    active,
    burnerAddress: sessionBurner,
    expiresAt,
  }
}
