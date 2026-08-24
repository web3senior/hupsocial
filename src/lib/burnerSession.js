import { ethers } from 'ethers'
import { getUserSessions } from './communication'
import { decryptData, encryptData, isPrivateKeyEncrypted } from './cryptoHelper'
import { deriveChildKeyBytes, CHILD_KEY_LABELS } from './securityVault'

const prefix = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const localStorageBurnerAddress = `${prefix}burner_address`
export const localStorageBurnerKey = `${prefix}burner_key`
export const sessionStorageUnlockedKey = `${prefix}unlocked_burner_key`

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
 * Silent variant of getBurnerSigner for host-mediated signing (the mini app bridge). It must
 * never open a password prompt — a third-party frame's request is not a place to ask for the
 * vault PIN — so a locked vault throws a coded error for the caller to surface instead.
 *
 * @throws {Error} code 'NO_SESSION_KEY' when this device holds no burner key.
 * @throws {Error} code 'VAULT_LOCKED' when the key is encrypted and not unlocked this tab.
 */
export const getBurnerSignerSilent = (chain) => {
  const storedAddress = localStorage.getItem(localStorageBurnerAddress)
  const storedKey = localStorage.getItem(localStorageBurnerKey)

  if (!storedKey || !storedAddress) {
    const err = new Error('No session key found on this device')
    err.code = 'NO_SESSION_KEY'
    throw err
  }

  let privateKey = sessionStorage.getItem(sessionStorageUnlockedKey)

  if (!privateKey) {
    if (isPrivateKeyEncrypted(storedKey)) {
      const err = new Error('Security Vault is locked')
      err.code = 'VAULT_LOCKED'
      throw err
    }
    // Legacy unencrypted key
    privateKey = storedKey
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
 * Unlocks the burner key for this tab using an already-unlocked vault master: decrypts the
 * stored key and caches the plaintext in sessionStorage so silent signing works from then on.
 * Mirrors the settings page's recovery path — a vault-derived wallet whose blob at rest was
 * encrypted under the legacy per-feature password is simply re-derived from the master and
 * re-encrypted. A decrypt AND re-derive failure means the master is wrong, i.e. a wrong PIN
 * (or a foreign imported key from the old scheme, which needs a re-import in Settings).
 *
 * @throws {Error} code 'NO_SESSION_KEY' when this device holds no burner key.
 * @throws {Error} code 'WRONG_PIN' when the master cannot open or reproduce the stored key.
 */
export const unlockBurnerWithMaster = async (masterHex) => {
  const storedKey = localStorage.getItem(localStorageBurnerKey)
  const storedAddress = localStorage.getItem(localStorageBurnerAddress)

  if (!storedKey || !storedAddress) {
    const err = new Error('No session key found on this device')
    err.code = 'NO_SESSION_KEY'
    throw err
  }

  if (!isPrivateKeyEncrypted(storedKey)) {
    sessionStorage.setItem(sessionStorageUnlockedKey, storedKey)
    return storedKey
  }

  try {
    const privateKey = await decryptData(storedKey, masterHex)
    sessionStorage.setItem(sessionStorageUnlockedKey, privateKey)
    return privateKey
  } catch {
    const seedBytes = await deriveChildKeyBytes(masterHex, CHILD_KEY_LABELS.inAppWallet)
    const derived = new ethers.Wallet(ethers.hexlify(seedBytes))
    if (derived.address.toLowerCase() === storedAddress.toLowerCase()) {
      localStorage.setItem(localStorageBurnerKey, await encryptData(derived.privateKey, masterHex))
      sessionStorage.setItem(sessionStorageUnlockedKey, derived.privateKey)
      return derived.privateKey
    }
    const err = new Error('That PIN does not open this session key')
    err.code = 'WRONG_PIN'
    throw err
  }
}

/**
 * Sends a raw calldata transaction with the burner session key, without prompting. Used by the
 * mini app bridge for host-approved gasless calls — value is pinned to zero on purpose: session
 * calls may spend gas, never funds.
 *
 * Returns the transaction hash as soon as the node accepts it; callers poll the receipt
 * themselves so a slow block never stalls the bridge.
 */
export const sendRawWithBurnerSession = async ({ chain, to, data }) => {
  const wallet = getBurnerSignerSilent(chain)
  const tx = await wallet.sendTransaction({ to, data, value: 0n })
  return tx.hash
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
