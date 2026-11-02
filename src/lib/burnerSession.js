import { ethers } from 'ethers'
import { getUserSessions } from './communication'
import { decryptData, encryptData, isPrivateKeyEncrypted } from './cryptoHelper'
import { clearMasterSecret, deriveChildKeyBytes, getCachedMasterHex, CHILD_KEY_LABELS } from './securityVault'
import { deriveKeyFromMasterV2, getCachedMasterV2, rejectMasterV2 } from './keyVaultV2'
import { KEY_LABELS } from './keyDerivationV2.mjs'
import { requestVaultUnlock } from './vaultUnlockBus'
import { BURNER_FIELDS, claimLegacyBurner, disownLegacyBurner, isBurnerUnclaimed, readBurner, readUnlockedBurner, writeBurner, writeUnlockedBurner } from './burnerStorage'

const prefix = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const localStorageBatchLikeKey = `${prefix}batch_like_enabled`

const getRpcUrl = (chain) => chain?.rpcUrls?.default?.http?.[0] || chain?.rpcUrl || chain?.rpc || process.env.NEXT_PUBLIC_LUKSO_RPC_URL

/**
 * True when this tab can already sign with the session key — either the plaintext is cached for
 * the tab or the stored key predates at-rest encryption. Reads only; never opens a prompt.
 */
export const isBurnerUnlocked = () => {
  if (typeof window === 'undefined') return false
  if (readUnlockedBurner()) return true

  const storedKey = readBurner(BURNER_FIELDS.key)
  return Boolean(storedKey) && !isPrivateKeyEncrypted(storedKey)
}

/**
 * Makes the session key signable in this tab, asking for the vault PIN only when it has to.
 *
 * The stored blob is encrypted with the vault MASTER, never with a string the user types, so
 * the unlock is always master-first: a vault already opened in Settings decrypts the key here
 * with no prompt at all. Only a locked vault reaches the dialog.
 *
 * @param {{ reason?: string }} [context] - short line naming what is waiting on the unlock
 * @throws {Error} code 'NO_SESSION_KEY' when this device holds no burner key.
 * @throws {Error} code 'VAULT_LOCKED' when the vault is locked and no unlock surface is mounted.
 * @throws {Error} code 4001 when the user cancels the unlock.
 */
export const ensureVaultUnlocked = async (context = {}) => {
  if (isBurnerUnlocked()) return

  if (!readBurner(BURNER_FIELDS.key) || !readBurner(BURNER_FIELDS.address)) {
    const err = new Error('No session key found on this device')
    err.code = 'NO_SESSION_KEY'
    throw err
  }

  if (getBurnerVersion() === 'v2') {
    const cachedV2 = getCachedMasterV2()
    if (cachedV2) {
      try {
        await unlockBurnerWithMaster(cachedV2, 'v2')
        return
      } catch (err) {
        if (err.code !== 'WRONG_PIN') throw err
        rejectMasterV2()
      }
    }
    await requestVaultUnlock({ ...context, version: 'v2' })
    return
  }

  const cachedMaster = getCachedMasterHex()
  if (cachedMaster) {
    try {
      await unlockBurnerWithMaster(cachedMaster)
      return
    } catch (err) {
      if (err.code !== 'WRONG_PIN') throw err
      // The cached master cannot open this key, and unlockMaster hands a cached master straight
      // back without ever looking at the PIN — leaving it in place would make the dialog a
      // no-op that re-fails on every attempt.
      clearMasterSecret()
    }
  }

  await requestVaultUnlock(context)
}

/**
 * Retrieves the burner signer, unlocking the vault first when the key is still encrypted.
 *
 * @param {object} chain - The chain object containing RPC configurations.
 * @param {string|null} password - Legacy escape hatch: a secret to decrypt the key with
 *   directly, for keys still at rest under the old per-feature password scheme.
 */
export const getBurnerSigner = async (chain, password = null) => {
  const storedAddress = readBurner(BURNER_FIELDS.address)
  const storedKey = readBurner(BURNER_FIELDS.key)

  if (!storedKey || !storedAddress) return null

  // 1. Check in-memory cache first
  let privateKey = readUnlockedBurner()

  if (!privateKey) {
    // 2. Fallback to legacy unencrypted key
    if (!isPrivateKeyEncrypted(storedKey)) {
      privateKey = storedKey
    } else if (password) {
      // 3. A caller-supplied secret wins, for keys stored under the old scheme
      privateKey = await decryptData(storedKey, password)

      // Cache decrypted key in sessionStorage for this tab session
      writeUnlockedBurner(privateKey)
    } else {
      // 4. Otherwise the vault owns this key — unlock it (silently when already open)
      await ensureVaultUnlocked()
      privateKey = readUnlockedBurner()
      if (!privateKey) throw new Error('Session key is still locked')
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
  const storedAddress = readBurner(BURNER_FIELDS.address)
  const storedKey = readBurner(BURNER_FIELDS.key)

  if (!storedKey || !storedAddress) {
    const err = new Error('No session key found on this device')
    err.code = 'NO_SESSION_KEY'
    throw err
  }

  let privateKey = readUnlockedBurner()

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
 * @param {string} masterHex The unlocked master of the vault the key belongs to.
 * @param {'v1'|'v2'} [version] Which vault that is; v2 re-derives with the v2 label.
 * @throws {Error} code 'NO_SESSION_KEY' when this device holds no burner key for this wallet,
 *   including an ownerless one this wallet's master turns out not to open.
 * @throws {Error} code 'WRONG_PIN' when the master cannot open or reproduce the stored key.
 */
export const unlockBurnerWithMaster = async (masterHex, version = 'v1') => {
  const storedKey = readBurner(BURNER_FIELDS.key)
  const storedAddress = readBurner(BURNER_FIELDS.address)

  if (!storedKey || !storedAddress) {
    const err = new Error('No session key found on this device')
    err.code = 'NO_SESSION_KEY'
    throw err
  }

  // A key from before keys had owners is this wallet's once its vault opens it, and not otherwise
  const unclaimed = isBurnerUnclaimed()

  if (!isPrivateKeyEncrypted(storedKey)) {
    claimLegacyBurner()
    writeUnlockedBurner(storedKey)
    return storedKey
  }

  try {
    const privateKey = await decryptData(storedKey, masterHex)
    claimLegacyBurner()
    writeUnlockedBurner(privateKey)
    return privateKey
  } catch {
    const derived =
      version === 'v2'
        ? new ethers.Wallet(deriveKeyFromMasterV2(masterHex, KEY_LABELS.inAppWallet))
        : new ethers.Wallet(ethers.hexlify(await deriveChildKeyBytes(masterHex, CHILD_KEY_LABELS.inAppWallet)))
    if (derived.address.toLowerCase() === storedAddress.toLowerCase()) {
      claimLegacyBurner()
      writeBurner({ key: await encryptData(derived.privateKey, masterHex) })
      writeUnlockedBurner(derived.privateKey)
      return derived.privateKey
    }
    /* Another wallet's key, left over from before keys had owners — not a wrong passphrase. This
       wallet stops reading it, and the vault it just opened stays open. */
    if (unclaimed) {
      disownLegacyBurner()
      const err = new Error('No session key found on this device')
      err.code = 'NO_SESSION_KEY'
      throw err
    }
    const err = new Error('That PIN does not open this session key')
    err.code = 'WRONG_PIN'
    throw err
  }
}

/**
 * Settles whose an ownerless session key is before anything acts on it — authorizing its address
 * onchain for a wallet that cannot sign with it would be a session nobody can use. Opening it
 * claims it; failing to marks it as another wallet's, and this wallet then reads no key at all.
 * @param {{ reason?: string }} [context]
 */
export const resolveLegacyBurner = async (context = {}) => {
  if (!isBurnerUnclaimed()) return
  try {
    await ensureVaultUnlocked(context)
  } catch (err) {
    if (err.code !== 'NO_SESSION_KEY') throw err
  }
}

/** Which vault the stored session key belongs to. Keys from before v2 carry no marker. */
export const getBurnerVersion = () => {
  if (typeof window === 'undefined') return 'v1'
  return readBurner(BURNER_FIELDS.version) === 'v2' ? 'v2' : 'v1'
}

/**
 * Unlocks the session key with whichever cached master matches its vault, without prompting.
 * What the unlock dialog runs after either kind of unlock: a v2 unlock may also have restored the
 * v1 master, which is what a not-yet-upgraded key needs.
 * @throws {Error} code 'NO_SESSION_KEY', 'WRONG_PIN', or 'VAULT_LOCKED' when that master is not open.
 */
export const unlockBurnerFromCachedMasters = async () => {
  const version = getBurnerVersion()
  const master = version === 'v2' ? getCachedMasterV2() : getCachedMasterHex()
  if (!master) {
    if (!readBurner(BURNER_FIELDS.key)) {
      const err = new Error('No session key found on this device')
      err.code = 'NO_SESSION_KEY'
      throw err
    }
    const err = new Error('Security Vault is locked')
    err.code = 'VAULT_LOCKED'
    throw err
  }
  return unlockBurnerWithMaster(master, version)
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
 * Writes a transaction with the burner session key. A locked vault opens the unlock dialog
 * first; a cancelled unlock bubbles up as code 4001 for the caller to fall back on.
 *
 * Resolves once the transaction is mined by default. Callers that close their UI the moment
 * the node accepts the transaction and track the receipt themselves (optimistic flows like
 * TipModal) pass `waitForReceipt: false` to get the response back at the hash instead.
 *
 * Never carries value: the session key is a gas float, not a wallet. Buying, paying fees,
 * claiming or otherwise moving funds must be signed by the connected wallet, so an overrides
 * object with a non-zero `value` throws code 'SESSION_FUNDS_FORBIDDEN' before signing.
 */
export const writeWithBurnerSession = async ({ chain, contractAddress, abi, functionName, args, password = null, waitForReceipt = true }) => {
  const overrides = args?.at(-1)
  if (overrides && typeof overrides === 'object' && 'value' in overrides && BigInt(overrides.value ?? 0) > 0n) {
    const err = new Error('Payments are signed by your wallet, not the session key')
    err.code = 'SESSION_FUNDS_FORBIDDEN'
    throw err
  }

  // Retrieve signer (decrypts key asynchronously if needed)
  const burnerSigner = await getBurnerSigner(chain, password)

  if (!burnerSigner) {
    throw new Error('No burner session key found')
  }

  const contract = new ethers.Contract(contractAddress, abi, burnerSigner)
  const tx = await contract[functionName](...args)

  if (waitForReceipt) await tx.wait()
  return tx
}

/**
 * True when a session write failed before it could ever reach the mempool: an empty burner
 * balance on this chain, or a key this tab cannot sign with. Both mean the caller may send the
 * same action from the connected wallet instead. A revert or a dropped transaction is
 * deliberately NOT matched — those may already be onchain, and must never be re-sent anywhere.
 */
export const isSessionUnusableError = (err) => {
  if (!err) return false
  // A cancelled vault unlock, and the coded throws from this file
  if (err.code === 4001 || ['INSUFFICIENT_FUNDS', 'NO_SESSION_KEY', 'VAULT_LOCKED', 'WRONG_PIN', 'SESSION_FUNDS_FORBIDDEN'].includes(err.code)) return true

  const message = [err.shortMessage, err.message, err.info?.error?.message, err.error?.message].filter(Boolean).join(' ').toLowerCase()

  return (
    message.includes('insufficient funds') ||
    message.includes('no burner session key') ||
    message.includes('session key is still locked') ||
    message.includes('missing rpc url for burner transaction')
  )
}

/**
 * Whether the session key can pay for a transaction of its own on one chain.
 *
 * The burner is funded per chain, so an active session says nothing about whether it can send
 * HERE — and unlike a relayed call, which the sponsor pays for, a direct session write spends
 * the burner's own balance. An empty one has to fall back to the wallet.
 *
 * A failed read counts as fundable: the write itself is the authority, and callers fall back
 * on isSessionUnusableError anyway.
 *
 * @param {Object} publicClient - viem client pinned to the chain the action targets.
 */
export const canSessionPayGas = async (publicClient) => {
  const burner = getStoredBurner()
  if (!burner) return false
  if (!publicClient) return true

  try {
    return (await publicClient.getBalance({ address: burner.address })) > 0n
  } catch (err) {
    console.warn('Could not read session key balance:', err.message)
    return true
  }
}

/**
 * Reads stored credentials. Designed to be fast and non-blocking for background checks.
 * Does not decrypt locked keys to avoid unnecessary password prompts.
 */
export const getStoredBurner = () => {
  if (typeof window === 'undefined') return null

  const address = readBurner(BURNER_FIELDS.address)
  const privateKey = readBurner(BURNER_FIELDS.key)

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
export const isSessionActive = async ({ userAddress, publicClient, contractAddress }) => {
  const session = userAddress && contractAddress && publicClient
    ? await publicClient.readContract({
      address: contractAddress,
      abi: [{
        type: 'function',
        name: 'userSessions',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }],
        outputs: [{ name: 'burnerKey', type: 'address' }, { name: 'expiresAt', type: 'uint256' }],
      }],
      functionName: 'userSessions',
      args: [userAddress],
    })
    : await getUserSessions(userAddress)

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
