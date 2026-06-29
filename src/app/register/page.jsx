'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import { useConnection, usePublicClient, useSignMessage, useSignTypedData } from 'wagmi'
import { isHexString, Wallet, ethers } from 'ethers'
import ecies from 'eciesjs'
import clsx from 'clsx'
import abiChat from '@/abis/Chat.json'
import { unlockAppKeyFromStorage, unlockAppKeyWithPassword, lockAppPrivateKey, APP_PASSWORD_SESSION_STORAGE, ENCRYPTED_APP_KEY_STORAGE } from '@/lib/appVault'
import { getActiveChain } from '@/lib/communication'
import { encryptData, decryptData, isPrivateKeyEncrypted } from '@/lib/cryptoHelper'
import { EyeIcon, EyeOffIcon, KeyRoundIcon, ShieldAlertIcon, CheckIcon, CopyIcon, UploadIcon, DatabaseIcon } from 'lucide-react'
import styles from './page.module.scss'

import {
  CHAT_ZERO_ADDRESS,
  chatLocalStorageBurnerKey,
  chatLocalStorageBurnerAddress,
  chatSessionStorageUnlockedKey,
} from '@/lib/chatBurnerSession'

// ─── Constants ───────────────────────────────────────────────────────────────

const SESSION_DURATION_SECONDS = 3600 * 24 * 365

const FORWARDER_NONCES_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
    name: 'nonces',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
]

const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Register() {
  const router = useRouter()
  const { address, isConnected } = useConnection()
  const publicClient = usePublicClient()
  const { signMessageAsync } = useSignMessage()
  const { signTypedDataAsync } = useSignTypedData()

  const [activeChainConfig, activeChainContracts] = getActiveChain()
  const tunnelAddress = activeChainContracts?.chat
  const forwarderAddress = activeChainContracts?.forwarder
  const relayRpcUrl = activeChainConfig?.rpcUrls?.default?.http?.[0]

  // ■■■ Core State ■■■
  const [isActivating, setIsActivating] = useState(false)
  const [hasLocalVault, setHasLocalVault] = useState(false)
  const [hasBurnerKey, setHasBurnerKey] = useState(false)
  const [isPkRegistered, setIsPkRegistered] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [isSessionOrphaned, setIsSessionOrphaned] = useState(false)
  const [burnerAddress, setBurnerAddress] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  // ■■■ Vault Setup State ■■■
  const [vaultPassword, setVaultPassword] = useState('')
  const [confirmVaultPassword, setConfirmVaultPassword] = useState('')
  const [showVaultPlainPassword, setShowVaultPlainPassword] = useState(false)

  // ■■■ PIN Re-entry (when sessionStorage cleared between visits) ■■■
  const [showPinEntry, setShowPinEntry] = useState(false)
  const [pinEntry, setPinEntry] = useState('')
  const [showPinEntryPlain, setShowPinEntryPlain] = useState(false)

  // ■■■ Key Management State ■■■
  const [showDecryptPrompt, setShowDecryptPrompt] = useState(false)
  const [showImportPrompt, setShowImportPrompt] = useState(false)
  const [decryptPassword, setDecryptPassword] = useState('')
  const [revealKeyMode, setRevealKeyMode] = useState(false)
  const [revealedPrivateKey, setRevealedPrivateKey] = useState(null)
  const [copied, setCopied] = useState(false)
  const [importPrivateKeyInput, setImportPrivateKeyInput] = useState('')
  const [importPassword, setImportPassword] = useState('')

  // ─── Status Polling ──────────────────────────────────────────────────────

  const checkStatus = useCallback(async () => {
    const vaultExists = !!localStorage.getItem(ENCRYPTED_APP_KEY_STORAGE)
    const burnerExists = !!localStorage.getItem(chatLocalStorageBurnerKey)
    setHasLocalVault(vaultExists)
    setHasBurnerKey(burnerExists)

    if (!address || !publicClient || !tunnelAddress) {
      setIsPkRegistered(false)
      setSessionActive(false)
      setIsSessionOrphaned(false)
      return
    }

    try {
      const [pk, session, latestBlock] = await Promise.all([
        publicClient.readContract({
          address: tunnelAddress,
          abi: abiChat,
          functionName: 'publicKeyRegistry',
          args: [address],
        }),
        publicClient.readContract({
          address: tunnelAddress,
          abi: abiChat,
          functionName: 'userSessions',
          args: [address],
        }),
        publicClient.getBlock({ blockTag: 'latest' }),
      ])

      const registered = Boolean(pk && pk !== '0x')
      setIsPkRegistered(registered)

      const activeBurner = String(session?.burnerKey ?? session?.[0] ?? CHAT_ZERO_ADDRESS)
      const expiresAt = BigInt(session?.expiresAt ?? session?.[1] ?? 0)
      const networkTime = BigInt(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000))

      const isActiveOnChain = activeBurner !== CHAT_ZERO_ADDRESS && expiresAt > networkTime

      const localAddress = localStorage.getItem(chatLocalStorageBurnerAddress)
      const hasLocalKey = !!localStorage.getItem(chatLocalStorageBurnerKey)
      const isLocalSynced = isActiveOnChain && hasLocalKey && localAddress && localAddress.toLowerCase() === activeBurner.toLowerCase()

      setSessionActive(isLocalSynced)
      setIsSessionOrphaned(isActiveOnChain && !isLocalSynced)
      setBurnerAddress(isActiveOnChain ? activeBurner : null)
    } catch (err) {
      console.error('Status check failed:', err)
      setIsPkRegistered(false)
      setSessionActive(false)
      setIsSessionOrphaned(false)
    }
  }, [address, publicClient, tunnelAddress])

  useEffect(() => {
    if (!isConnected) return
    void checkStatus()
    const interval = setInterval(() => void checkStatus(), 30000)
    return () => clearInterval(interval)
  }, [checkStatus, isConnected])

  // ─── Vault Creation ──────────────────────────────────────────────────────

  const handleCreateVaultAndActivate = async () => {
    if (!isConnected || !address) return setErrorMsg('Please connect your wallet first.')
    if (vaultPassword.length < 8) return setErrorMsg('Your PIN must be at least 8 characters.')
    if (vaultPassword !== confirmVaultPassword) return setErrorMsg('PINs do not match.')
    setIsActivating(true)
    setErrorMsg('')

    try {
      const lowAddress = address.toLowerCase()

      // Deterministic: no nonce — same wallet always produces the same vault key.
      // This means re-signing on any device recovers the original key and on-chain PK
      // stays in sync, preventing ECDH topic mismatches for existing contacts.
      const message = [
        'Tunnel Stealth Protocol - Identity Authorization',
        '',
        'By signing this message, you are generating a unique encryption key for this wallet.',
        '',
        'Safety Notice:',
        '- This signature does not authorize any token transfers.',
        '- This key is used locally to encrypt/decrypt your stealth messages.',
        '- Keep your password safe; it is required to unlock this key.',
        '',
        `Wallet: ${lowAddress}`,
        'Version: 1.0.0',
      ].join('\n')

      // personal_sign — no tx, just a sig for key derivation.
      setStatusMsg('Check your wallet — sign the message to generate your encryption key.')
      const signature = await signMessageAsync({ message })
      setStatusMsg('')
      const sigHash = ethers.keccak256(signature)
      const seed = ethers.solidityPackedKeccak256(['string', 'bytes32'], ['Tunnel', sigHash])

      const privKey = new ecies.PrivateKey(ethers.getBytes(seed))
      const rawPrivKeyHex = privKey.toHex()
      // Contract requires uncompressed pubkey (64 or 65 bytes); eciesjs gives compressed (33 bytes).
      const privKeyWith0x = rawPrivKeyHex.startsWith('0x') ? rawPrivKeyHex : `0x${rawPrivKeyHex}`
      const pubKeyHex = new ethers.SigningKey(privKeyWith0x).publicKey // 0x04... 65 bytes

      const encryptedKey = await lockAppPrivateKey(rawPrivKeyHex, vaultPassword)
      localStorage.setItem(ENCRYPTED_APP_KEY_STORAGE, encryptedKey)
      sessionStorage.setItem(APP_PASSWORD_SESSION_STORAGE, vaultPassword)
      setHasLocalVault(true)

      // Chain directly into combined relay: register PK + authorize session in one call.
      await handleActivateIdentity(vaultPassword, pubKeyHex)
    } catch (error) {
      console.error('Vault creation failed:', error)
      setStatusMsg('')
      setErrorMsg(
        error?.name === 'UserRejectedRequestError'
          ? 'Signature rejected. You must sign to generate your secure vault.'
          : error.message || 'Failed to secure vault.'
      )
      setIsActivating(false)
    }
  }

  // ─── Gasless Relay Helper ────────────────────────────────────────────────

  const relayViaForwarder = async (to, abi, functionName, args, gas) => {
    if (!forwarderAddress || !address || !publicClient || !relayRpcUrl) {
      throw new Error('Gasless relay is not configured for this chain.')
    }

    const nonce = await publicClient.readContract({
      address: forwarderAddress,
      abi: FORWARDER_NONCES_ABI,
      functionName: 'nonces',
      args: [address],
    })

    const chainId = publicClient.chain.id
    const deadline = Math.floor(Date.now() / 1000) + 3600
    const iface = new ethers.Interface(abi)
    const data = iface.encodeFunctionData(functionName, args)
    const message = { from: address, to, value: 0n, gas: BigInt(gas), nonce, deadline }

    const typedDataParams = {
      domain: { name: 'HupForwarder', version: '1', chainId, verifyingContract: forwarderAddress },
      types: FORWARD_REQUEST_TYPES,
      primaryType: 'ForwardRequest',
      message: { ...message, data },
    }

    setStatusMsg('Check your wallet — sign the gasless transaction to activate your chat identity.')
    let signature
    try {
      // Standard path: wallets that support eth_signTypedData_v4 (MetaMask, etc.)
      signature = await signTypedDataAsync(typedDataParams)
    } catch (typedDataErr) {
      // Fallback for any wallet that can't handle eth_signTypedData_v4:
      //   - LUKSO UP: "eth_signTypedData_v4 is not supported"
      //   - LUKSO UP on wrong chain: "Provided chainId X must match active chainId Y"
      //   - Other smart-contract wallets with similar constraints
      // Only re-throw on explicit user rejection; everything else falls through to personal_sign.
      const isRejection =
        typedDataErr?.name === 'UserRejectedRequestError' ||
        /user rejected|user denied|rejected the request/i.test(typedDataErr?.message ?? '')
      if (isRejection) throw typedDataErr
      const digest = ethers.TypedDataEncoder.hash(
        typedDataParams.domain,
        FORWARD_REQUEST_TYPES,
        typedDataParams.message,
      )
      signature = await signMessageAsync({ message: { raw: digest } })
    }
    setStatusMsg('')

    const res = await fetch('/api/v1/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        { request: { ...message, data }, signature, rpcUrl: relayRpcUrl, forwarderAddress, chainId },
        (_, v) => (typeof v === 'bigint' ? v.toString() : v)
      ),
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Relay failed.')
    return payload.txHash
  }

  // ─── Combined Activation (PK + Session in one relay call) ────────────────
  //
  // explicitPin: provided when called right after vault creation (sessionStorage already set),
  //              or when user re-enters PIN after the session tab was closed.
  // directPubKey: optional pre-derived pubKey hex; if omitted, unlocked from vault.

  const handleActivateIdentity = async (explicitPin = null, directPubKey = null) => {
    try {
      setIsActivating(true)
      setErrorMsg('')

      if (!address) throw new Error('Wallet not connected.')
      if (!tunnelAddress) throw new Error('Tunnel contract is not configured.')

      // Unlock vault to get the public key.
      // Also register when directPubKey is provided — this handles the case where
      // the message format changed (version bump) and the on-chain PK needs updating.
      let pubKeyArg = '0x'
      if (!isPkRegistered || directPubKey) {
        let pubKeyHex = directPubKey
        if (!pubKeyHex) {
          const keys = explicitPin
            ? await unlockAppKeyWithPassword(explicitPin)
            : await unlockAppKeyFromStorage()
          if (!keys) throw new Error('Cannot unlock vault. Please re-enter your PIN.')
          pubKeyHex = keys.pubKey
        }
        pubKeyArg = pubKeyHex.startsWith('0x') ? pubKeyHex : `0x${pubKeyHex}`
      }

      // Derive the PIN we'll use to encrypt the burner key.
      const pin = explicitPin || sessionStorage.getItem(APP_PASSWORD_SESSION_STORAGE)
      if (!pin) throw new Error('Session expired. Please re-enter your PIN.')

      // Get or create burner wallet.
      let targetBurnerAddress
      const storedKey = localStorage.getItem(chatLocalStorageBurnerKey)
      const storedAddress = localStorage.getItem(chatLocalStorageBurnerAddress)

      if (storedKey && storedAddress) {
        targetBurnerAddress = storedAddress
      } else {
        const burner = Wallet.createRandom()
        const encryptedKey = await encryptData(burner.privateKey, pin)
        localStorage.setItem(chatLocalStorageBurnerKey, encryptedKey)
        localStorage.setItem(chatLocalStorageBurnerAddress, burner.address)
        sessionStorage.setItem(chatSessionStorageUnlockedKey, burner.privateKey)
        targetBurnerAddress = burner.address
      }

      // One relay call: activateIdentity registers PK (if pubKeyArg non-empty) + session.
      const txHash = await relayViaForwarder(
        tunnelAddress, abiChat, 'activateIdentity',
        [targetBurnerAddress, BigInt(SESSION_DURATION_SECONDS), pubKeyArg],
        180000
      )

      // Wait for on-chain confirmation before reading contract state.
      if (txHash) {
        setStatusMsg('Waiting for transaction to confirm…')
        await publicClient.waitForTransactionReceipt({ hash: txHash })
      }

      setShowPinEntry(false)
      setPinEntry('')
      setStatusMsg('')
      await checkStatus()
    } catch (err) {
      console.error('Activation failed:', err)
      setStatusMsg('')
      setErrorMsg(err.message || 'Activation failed. Please try again.')
    } finally {
      setIsActivating(false)
    }
  }

  // ─── Trigger activation — reads PIN from sessionStorage or shows re-entry form ─

  const triggerActivation = () => {
    setErrorMsg('')
    const pin = sessionStorage.getItem(APP_PASSWORD_SESSION_STORAGE)
    if (pin) {
      handleActivateIdentity(pin)
    } else {
      setShowPinEntry(true)
      setShowDecryptPrompt(false)
      setShowImportPrompt(false)
    }
  }

  // ─── Session Revocation ──────────────────────────────────────────────────

  const handleRevokeSession = async () => {
    try {
      setIsActivating(true)
      const txHash = await relayViaForwarder(tunnelAddress, abiChat, 'revokeSession', [], 80000)
      if (txHash) {
        setStatusMsg('Waiting for transaction to confirm…')
        await publicClient.waitForTransactionReceipt({ hash: txHash })
        setStatusMsg('')
      }
      await checkStatus()
    } catch (err) {
      console.error('Session revocation failed:', err)
      setErrorMsg(err.message || 'Revocation failed.')
    } finally {
      setIsActivating(false)
    }
  }

  // ─── Key Management ──────────────────────────────────────────────────────

  const handleDecryptAndReveal = async () => {
    try {
      setIsActivating(true)
      setErrorMsg('')
      const encryptedKey = localStorage.getItem(chatLocalStorageBurnerKey)
      if (!encryptedKey) throw new Error('No session key found on this device.')

      if (!isPrivateKeyEncrypted(encryptedKey)) {
        setRevealedPrivateKey(encryptedKey)
        setRevealKeyMode(true)
        setShowDecryptPrompt(false)
        return
      }

      const decrypted = await decryptData(encryptedKey, decryptPassword)
      setRevealedPrivateKey(decrypted)
      sessionStorage.setItem(chatSessionStorageUnlockedKey, decrypted)
      setRevealKeyMode(true)
      setShowDecryptPrompt(false)
      setDecryptPassword('')
    } catch (err) {
      setErrorMsg(err.message || 'Decryption failed. Incorrect password.')
    } finally {
      setIsActivating(false)
    }
  }

  const handleImportSessionKey = async () => {
    try {
      setIsActivating(true)
      setErrorMsg('')

      if (!isHexString(importPrivateKeyInput, 32)) {
        throw new Error('Invalid format. Requires a 66-character hex string (0x...).')
      }
      if (importPassword.length < 6) {
        throw new Error('Password must be at least 6 characters.')
      }

      const importedWallet = new Wallet(importPrivateKeyInput)
      const encryptedKey = await encryptData(importPrivateKeyInput, importPassword)

      localStorage.setItem(chatLocalStorageBurnerKey, encryptedKey)
      localStorage.setItem(chatLocalStorageBurnerAddress, importedWallet.address)
      sessionStorage.setItem(chatSessionStorageUnlockedKey, importPrivateKeyInput)

      await checkStatus()
      setShowImportPrompt(false)
      setImportPrivateKeyInput('')
      setImportPassword('')
    } catch (err) {
      setErrorMsg(err.message || 'Import failed. Check private key format.')
    } finally {
      setIsActivating(false)
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isFullyRegistered = hasLocalVault && isPkRegistered && sessionActive

  const hasSessionUnlocked = typeof window !== 'undefined' && !!sessionStorage.getItem(APP_PASSWORD_SESSION_STORAGE)

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className={clsx(styles.register)}>
      <div className={clsx(styles.register__card)}>
        {/* ■■■ Header ■■■ */}
        <header className={clsx(styles.register__header)}>
          <h1 className={clsx(styles.register__title)}>Get Started</h1>
          <p className={clsx(styles.register__subtitle)}>
            {isFullyRegistered ? "You're all set!" : 'Just 2 quick steps and you can start chatting.'}
          </p>
        </header>

        {/* ■■■ Status Banner ■■■ */}
        {statusMsg && (
          <div className={clsx(styles.register__alertInfo)}>
            <span>{statusMsg}</span>
          </div>
        )}

        {/* ■■■ Error Banner ■■■ */}
        {errorMsg && (
          <div className={clsx(styles.register__alertError)}>
            <ShieldAlertIcon size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* ■■■ Status Steps ■■■ */}
        <section className={clsx(styles.register__features)}>
          {/* Step 1 */}
          <div className={clsx(styles['register__feature-item'], hasLocalVault && styles['register__feature-item--active'])}>
            <div className={clsx(styles.register__icon)}>
              <DatabaseIcon size={20} />
            </div>
            <div className="flex-grow-1">
              <strong>1. Set PIN</strong>
              <p>{hasLocalVault ? 'Vault saved on this device' : 'Takes about 30 seconds'}</p>
              <details className={clsx(styles.register__stepDetails)}>
                <summary>Advanced info</summary>
                <p>Your PIN protects the vault on this device. If you forget it, you can recover by re-signing the same message with your wallet — your keypair is derived from your signature, not the PIN.</p>
              </details>
            </div>
            <div
              className={clsx(
                styles.register__status,
                hasLocalVault ? styles['register__status--ok'] : styles['register__status--pending']
              )}
            >
              {hasLocalVault ? 'OK' : '!'}
            </div>
          </div>

          {/* Step 2 */}
          <div
            className={clsx(
              styles['register__feature-item'],
              (isPkRegistered && sessionActive) && styles['register__feature-item--active']
            )}
          >
            <div className={clsx(styles.register__icon)}>
              <KeyRoundIcon size={20} />
            </div>
            <div className="flex-grow-1">
              <strong>2. Join Chat</strong>
              <p>
                {isPkRegistered && sessionActive
                  ? 'Active — private messages and session enabled'
                  : isSessionOrphaned
                    ? 'Session lost — import or start a new one'
                    : 'Sign a message to activate your session — revoke anytime'}
              </p>
              {burnerAddress && (sessionActive || isSessionOrphaned) && (
                <small className={clsx(styles.register__address)}>
                  {burnerAddress.slice(0, 8)}...{burnerAddress.slice(-6)}
                </small>
              )}
              <details className={clsx(styles.register__stepDetails)}>
                <summary>Advanced info</summary>
                <p>Registers your encryption public key on-chain once, then signs a message to open a session via a temporary burner key. You can revoke your session at any time via the contract. Fully gas-free — HUP's relayer covers the fee.</p>
              </details>
            </div>
            <div
              className={clsx(
                styles.register__status,
                (isPkRegistered && sessionActive) ? styles['register__status--ok'] : styles['register__status--pending']
              )}
            >
              {isPkRegistered && sessionActive ? 'OK' : isSessionOrphaned ? 'LOST' : '!'}
            </div>
          </div>
        </section>

        {/* ■■■ Security Modules ■■■ */}
        <div className={clsx(styles.register__secureModules)}>
          {/* Vault Creation */}
          {!hasLocalVault && isConnected && (
            <div className={clsx(styles.register__secureSetup)}>
              <h5>
                <DatabaseIcon size={16} /> Set PIN
              </h5>
              <p>Locks your vault on this device. Forgot it? Re-sign with your wallet anytime to recover.</p>
              <div className={clsx(styles.register__formGroup)}>
                <div className={clsx(styles.register__inputWrapper)}>
                  <input
                    type={showVaultPlainPassword ? 'text' : 'password'}
                    placeholder="Choose a PIN (min 8 chars)"
                    value={vaultPassword}
                    onChange={(e) => setVaultPassword(e.target.value)}
                    className={clsx(styles.register__input)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowVaultPlainPassword(!showVaultPlainPassword)}
                    className={clsx(styles.register__inputEye)}
                    tabIndex={-1}
                  >
                    {showVaultPlainPassword ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                  </button>
                </div>
                <input
                  type={showVaultPlainPassword ? 'text' : 'password'}
                  placeholder="Confirm PIN"
                  value={confirmVaultPassword}
                  onChange={(e) => setConfirmVaultPassword(e.target.value)}
                  className={clsx(styles.register__input)}
                />
              </div>
              <div className="flex justify-end mt-10">
                <button
                  onClick={handleCreateVaultAndActivate}
                  className={clsx(styles.register__btnPrimary)}
                  disabled={isActivating || vaultPassword.length < 8 || vaultPassword !== confirmVaultPassword}
                >
                  {isActivating ? 'Joining...' : 'Join Hup'}
                </button>
              </div>
            </div>
          )}

          {/* PIN Re-entry (vault exists, sessionStorage cleared) */}
          {showPinEntry && (
            <div className={clsx(styles.register__secureSetup)}>
              <h5>
                <KeyRoundIcon size={16} /> Re-enter Your PIN
              </h5>
              <p>Enter your vault PIN to activate your identity.</p>
              <div className={clsx(styles.register__formGroup)}>
                <input
                  type={showPinEntryPlain ? 'text' : 'password'}
                  placeholder="Your PIN"
                  value={pinEntry}
                  onChange={(e) => setPinEntry(e.target.value)}
                  className={clsx(styles.register__input)}
                />
              </div>
              <div className="flex gap-05 justify-between align-items-center mt-10">
                <button type="button" onClick={() => setShowPinEntryPlain(!showPinEntryPlain)} className={clsx(styles.register__btnLink)}>
                  {showPinEntryPlain ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />} {showPinEntryPlain ? 'Hide' : 'Show'}
                </button>
                <div className="flex gap-05">
                  <button onClick={() => { setShowPinEntry(false); setPinEntry('') }} className={clsx(styles.register__btnSecondary)}>
                    Cancel
                  </button>
                  <button
                    onClick={() => handleActivateIdentity(pinEntry)}
                    className={clsx(styles.register__btnPrimary)}
                    disabled={isActivating || pinEntry.length < 8}
                  >
                    {isActivating ? 'Joining...' : 'Activate'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Decrypt & Reveal session key */}
          {showDecryptPrompt && (
            <div className={clsx(styles.register__secureSetup)}>
              <h5>
                <KeyRoundIcon size={16} /> Unlock Session Key
              </h5>
              <p>Enter the password used when this session was created.</p>
              <input
                type="password"
                placeholder="Your password"
                value={decryptPassword}
                onChange={(e) => setDecryptPassword(e.target.value)}
                className={clsx(styles.register__input)}
              />
              <div className="flex justify-end gap-05 mt-10">
                <button onClick={() => setShowDecryptPrompt(false)} className={clsx(styles.register__btnSecondary)}>
                  Cancel
                </button>
                <button onClick={handleDecryptAndReveal} className={clsx(styles.register__btnPrimary)} disabled={isActivating}>
                  Unlock
                </button>
              </div>
            </div>
          )}

          {/* Import session key from another device */}
          {showImportPrompt && (
            <div className={clsx(styles.register__secureSetup)}>
              <h5>
                <UploadIcon size={16} /> Use Another Device's Session
              </h5>
              <p>Paste your session key from another device and set a new password for it.</p>
              <div className={clsx(styles.register__formGroup)}>
                <input
                  type="text"
                  placeholder="Session key (0x...)"
                  value={importPrivateKeyInput}
                  onChange={(e) => setImportPrivateKeyInput(e.target.value)}
                  className={clsx(styles.register__input)}
                />
                <input
                  type="password"
                  placeholder="New password"
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                  className={clsx(styles.register__input)}
                />
              </div>
              <div className="flex justify-end gap-05 mt-10">
                <button onClick={() => setShowImportPrompt(false)} className={clsx(styles.register__btnSecondary)}>
                  Cancel
                </button>
                <button onClick={handleImportSessionKey} className={clsx(styles.register__btnPrimary)} disabled={isActivating}>
                  Import
                </button>
              </div>
            </div>
          )}

          {/* Backup Key display */}
          {revealKeyMode && revealedPrivateKey && (
            <div className={clsx(styles.register__secureSetup)}>
              <h5>Save Your Session Key</h5>
              <p>
                <strong>Keep this private.</strong> Save it somewhere safe — you'll need it to restore your session on another device.
              </p>
              <div className={clsx(styles.register__keyContainer)}>
                <code>{revealedPrivateKey}</code>
                <button onClick={() => copyToClipboard(revealedPrivateKey)} className={clsx(styles.register__btnIcon)} title="Copy">
                  {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
                </button>
              </div>
              <div className="flex justify-end mt-10">
                <button
                  onClick={() => { setRevealKeyMode(false); setRevealedPrivateKey(null) }}
                  className={clsx(styles.register__btnSecondary)}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ■■■ Footer Actions ■■■ */}
        <footer className={clsx(styles.register__footer)}>
          {isFullyRegistered ? (
            <button className={clsx(styles.register__button, 'btn')} onClick={() => router.push(hasSessionUnlocked ? '/chat' : '/unlock')}>
              {hasSessionUnlocked ? 'Open Chat' : 'Unlock to Enter'}
            </button>
          ) : !hasLocalVault ? (
            <button className={clsx(styles.register__button, 'btn')} disabled>
              Set your PIN first ↑
            </button>
          ) : (
            <button
              className={clsx(styles.register__button, 'btn')}
              onClick={triggerActivation}
              disabled={isActivating || !isConnected || showPinEntry}
            >
              {isActivating ? 'Joining...' : isSessionOrphaned ? 'New Session' : 'Join Chat'}
            </button>
          )}

          {/* Auxiliary Actions */}
          {isPkRegistered && (
            <div className="flex flex-wrap gap-05 mt-10 justify-center">
              {sessionActive && (
                <button onClick={handleRevokeSession} disabled={isActivating} className={clsx(styles.register__btnDanger, 'btn-small')}>
                  End Session
                </button>
              )}
              {hasBurnerKey && !revealKeyMode && (
                <button
                  onClick={() => {
                    setErrorMsg('')
                    setShowDecryptPrompt(true)
                    setShowPinEntry(false)
                    setShowImportPrompt(false)
                  }}
                  className={clsx(styles.register__btnSecondary, 'btn-small')}
                  disabled={isActivating}
                >
                  Save Key
                </button>
              )}
              {!sessionActive && (
                <button
                  onClick={() => {
                    setErrorMsg('')
                    setShowImportPrompt(true)
                    setShowPinEntry(false)
                    setShowDecryptPrompt(false)
                  }}
                  className={clsx(styles.register__btnSecondary, 'btn-small')}
                  disabled={isActivating}
                >
                  Use Another Device
                </button>
              )}
            </div>
          )}

          {!isFullyRegistered && (
            <p className={clsx(styles['register__gas-note'])}>
             ✓ Gas-free · fees covered by {process.env.NEXT_PUBLIC_NAME}
            </p>
          )}
        </footer>
      </div>
    </div>
  )
}
