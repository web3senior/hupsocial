'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import { useConnection, usePublicClient, useWriteContract, useSignMessage } from 'wagmi'
import { isHexString, Wallet, ethers } from 'ethers'
import ecies from 'eciesjs'
import clsx from 'clsx'
import abiChat from '@/abis/Chat.json'
import { unlockAppKeyFromStorage, lockAppPrivateKey, APP_PASSWORD_SESSION_STORAGE, ENCRYPTED_APP_KEY_STORAGE } from '@/lib/appVault'
import { getActiveChain } from '@/lib/communication'
import { encryptData, decryptData, isPrivateKeyEncrypted } from '@/lib/cryptoHelper'
import { ConnectWallet } from '@/components/ConnectWallet'
import { EyeIcon, EyeOffIcon, KeyRoundIcon, ShieldAlertIcon, CheckIcon, CopyIcon, UploadIcon, DatabaseIcon } from 'lucide-react'
import styles from './page.module.scss'

import {
  CHAT_ZERO_ADDRESS,
  chatLocalStorageBurnerKey,
  chatLocalStorageBurnerAddress,
  chatSessionStorageUnlockedKey,
} from '@/lib/chatBurnerSession'

// ─── Constants ───────────────────────────────────────────────────────────────

const SESSION_DURATION_SECONDS = 3600 * 24 * 30

// ─── Component ───────────────────────────────────────────────────────────────

export default function Register() {
  const router = useRouter()
  const { address, isConnected } = useConnection()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()

  const [, activeChainContracts] = getActiveChain()
  const tunnelAddress = activeChainContracts?.chat

  // ■■■ Core State ■■■
  const [isActivating, setIsActivating] = useState(false)
  const [hasLocalVault, setHasLocalVault] = useState(false)
  const [isPkRegistered, setIsPkRegistered] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [isSessionOrphaned, setIsSessionOrphaned] = useState(false)
  const [burnerAddress, setBurnerAddress] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')

  // ■■■ Vault Setup State ■■■
  const [vaultPassword, setVaultPassword] = useState('')
  const [confirmVaultPassword, setConfirmVaultPassword] = useState('')
  const [vaultAgree, setVaultAgree] = useState(false)
  const [showVaultPlainPassword, setShowVaultPlainPassword] = useState(false)

  // ■■■ Security & UI State ■■■
  const [showPasswordSetup, setShowPasswordSetup] = useState(false)
  const [showDecryptPrompt, setShowDecryptPrompt] = useState(false)
  const [showImportPrompt, setShowImportPrompt] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [decryptPassword, setDecryptPassword] = useState('')
  const [revealKeyMode, setRevealKeyMode] = useState(false)
  const [revealedPrivateKey, setRevealedPrivateKey] = useState(null)
  const [copied, setCopied] = useState(false)

  const [importPrivateKeyInput, setImportPrivateKeyInput] = useState('')
  const [importPassword, setImportPassword] = useState('')
  const [showPlainPassword, setShowPlainPassword] = useState(false)

  // ─── Status Polling ──────────────────────────────────────────────────────

  const checkStatus = useCallback(async () => {
    const vaultExists = !!localStorage.getItem(ENCRYPTED_APP_KEY_STORAGE)
    setHasLocalVault(vaultExists)

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
    void checkStatus()
    const interval = setInterval(() => void checkStatus(), 30000)
    return () => clearInterval(interval)
  }, [checkStatus])

  // ─── Vault Creation ──────────────────────────────────────────────────────

  const handleCreateVaultAndRegister = async () => {
    if (!isConnected || !address) return setErrorMsg('Please connect your wallet first.')
    if (vaultPassword.length < 8) return setErrorMsg('Vault password must be at least 8 characters.')
    if (vaultPassword !== confirmVaultPassword) return setErrorMsg('Vault passwords do not match.')
    if (!vaultAgree) return setErrorMsg('You must acknowledge that the password cannot be recovered.')

    setIsActivating(true)
    setErrorMsg('')

    try {
      const lowAddress = address.toLowerCase()
      const nonceBytes = window.crypto.getRandomValues(new Uint8Array(16))
      const nonce = ethers.hexlify(nonceBytes)

      const message = [
        'Hup Stealth Protocol - Identity Authorization',
        '',
        'By signing this message, you are generating a unique encryption key for this wallet.',
        '',
        'Safety Notice:',
        '- This signature does not authorize any token transfers.',
        '- This key is used locally to encrypt/decrypt your stealth messages.',
        '- Keep your password safe; it is required to unlock this key.',
        '',
        `Wallet: ${lowAddress}`,
        `Nonce: ${nonce}`,
        'Version: 1.0.0',
      ].join('\n')

      // This is a personal_sign — no tx, just a sig for key derivation.
      const signature = await signMessageAsync({ message })
      const sigHash = ethers.keccak256(signature)
      const passwordHash = ethers.keccak256(ethers.toUtf8Bytes(vaultPassword))
      const seed = ethers.solidityPackedKeccak256(['string', 'bytes32', 'bytes32'], ['HUP_STEALTH_V1', sigHash, passwordHash])

      const privKey = new ecies.PrivateKey(ethers.getBytes(seed))
      const rawPrivKeyHex = privKey.toHex()
      const rawPubKeyHex = privKey.publicKey.toHex()
      const pubKeyHex = rawPubKeyHex.startsWith('0x') ? rawPubKeyHex : `0x${rawPubKeyHex}`

      const encryptedKey = await lockAppPrivateKey(rawPrivKeyHex, vaultPassword)
      localStorage.setItem(ENCRYPTED_APP_KEY_STORAGE, encryptedKey)
      sessionStorage.setItem(APP_PASSWORD_SESSION_STORAGE, vaultPassword)
      setHasLocalVault(true)

      // Immediately chain into public key registration (still requires one tx from main wallet).
      await handleJoinTunnel(pubKeyHex)
    } catch (error) {
      console.error('Vault creation failed:', error)
      setErrorMsg(
        error?.name === 'UserRejectedRequestError'
          ? 'Signature rejected. You must sign to generate your secure vault.'
          : error.message || 'Failed to secure vault.'
      )
      setIsActivating(false)
    }
  }

  // ─── Public Key Registration ─────────────────────────────────────────────
  // This is the ONLY action that still requires a direct tx from the main wallet.
  // It registers the ECIES public key — unrelated to wallet identity; no link
  // is created beyond what the user has already accepted by connecting.

  const handleJoinTunnel = async (directPubKeyHex = null) => {
    try {
      setIsActivating(true)
      setErrorMsg('')
      if (!address) throw new Error('Wallet not connected.')
      if (!tunnelAddress) throw new Error('Tunnel contract is not configured.')

      let pubKeyHex = directPubKeyHex
      if (!pubKeyHex) {
        const keys = await unlockAppKeyFromStorage()
        pubKeyHex = keys?.pubKey
      }
      if (!pubKeyHex) throw new Error('No public key found. Please create the local vault first.')

      const normalizedPubKey = pubKeyHex.startsWith('0x') ? pubKeyHex : `0x${pubKeyHex}`

      await writeContractAsync({
        address: tunnelAddress,
        abi: abiChat,
        functionName: 'registerPublicKey',
        args: [CHAT_ZERO_ADDRESS, normalizedPubKey],
      })

      await checkStatus()
    } catch (err) {
      console.error('Public key registration failed:', err)
      setErrorMsg(err.message || 'Registration failed.')
    } finally {
      setIsActivating(false)
    }
  }

  // ─── Session Authorization ───────────────────────────────────────────────
  //
  // Flow:
  //   1. Generate (or reuse) a burner keypair and encrypt it locally.
  //   2. Main wallet calls authorizeSession() directly — one on-chain transaction.

  const triggerAuthorizeFlow = () => {
    setErrorMsg('')
    setPassword('')
    setConfirmPassword('')

    const storedAddress = localStorage.getItem(chatLocalStorageBurnerAddress)
    if (storedAddress) {
      handleAuthorizeSession(null)
    } else {
      setShowPasswordSetup(true)
    }
  }

  const handleAuthorizeSession = async (customPassword = null) => {
    try {
      setIsActivating(true)
      setErrorMsg('')

      if (!address) throw new Error('Wallet not connected.')
      if (!tunnelAddress) throw new Error('Tunnel contract is not configured.')

      let targetBurnerAddress

      const storedKey = localStorage.getItem(chatLocalStorageBurnerKey)
      const storedAddress = localStorage.getItem(chatLocalStorageBurnerAddress)

      if (!storedKey || !storedAddress) {
        if (!customPassword || customPassword.length < 6) {
          throw new Error('Secure password required (min 6 characters).')
        }
        const burner = Wallet.createRandom()
        const encryptedKey = await encryptData(burner.privateKey, customPassword)

        localStorage.setItem(chatLocalStorageBurnerKey, encryptedKey)
        localStorage.setItem(chatLocalStorageBurnerAddress, burner.address)
        sessionStorage.setItem(chatSessionStorageUnlockedKey, burner.privateKey)

        targetBurnerAddress = burner.address
      } else {
        targetBurnerAddress = storedAddress
      }

      await writeContractAsync({
        address: tunnelAddress,
        abi: abiChat,
        functionName: 'authorizeSession',
        args: [targetBurnerAddress, BigInt(SESSION_DURATION_SECONDS)],
      })

      setShowPasswordSetup(false)
      await checkStatus()
    } catch (err) {
      console.error('Session authorization failed:', err)
      setErrorMsg(err.message || 'Authorization failed. Please try again.')
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

  const handleRevokeSession = async () => {
    try {
      setIsActivating(true)
      // revokeSession is called by the main wallet (it deletes its own entry).
      // This intentionally links the wallet but is an explicit user action to close the session.
      await writeContractAsync({
        address: tunnelAddress,
        abi: abiChat,
        functionName: 'revokeSession',
        args: [],
      })
      await checkStatus()
    } catch (err) {
      console.error('Session revocation failed:', err)
      setErrorMsg(err.message || 'Revocation failed.')
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

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className={clsx(styles.register)}>
      <div className={clsx(styles.register__card)}>
        {/* ■■■ Header ■■■ */}
        <header className={clsx(styles.register__header)}>
          <div className="d-f-c flex-column" style={{ marginBottom: '1rem' }}>
            <ConnectWallet />
          </div>
          <h1 className={clsx(styles.register__title)}>Identity Setup</h1>
          <p className={clsx(styles.register__subtitle)}>
            {isFullyRegistered ? 'Your stealth identity is fully active.' : 'Complete the steps below to enter the tunnel.'}
          </p>
        </header>

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
              <strong>1. Local App Vault</strong>
              <p>{hasLocalVault ? 'Secured and encrypted on this device' : 'Requires creation & signature'}</p>
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
          <div className={clsx(styles['register__feature-item'], isPkRegistered && styles['register__feature-item--active'])}>
            <div className={clsx(styles.register__icon)}>
              <ShieldAlertIcon size={20} />
            </div>
            <div className="flex-grow-1">
              <strong>2. Public Key Registry</strong>
              <p>{isPkRegistered ? 'Registered onchain' : 'Pending onchain registration'}</p>
            </div>
            <div
              className={clsx(
                styles.register__status,
                isPkRegistered ? styles['register__status--ok'] : styles['register__status--pending']
              )}
            >
              {isPkRegistered ? 'OK' : '!'}
            </div>
          </div>

          {/* Step 3 */}
          <div
            className={clsx(
              styles['register__feature-item'],
              (sessionActive || isSessionOrphaned) && styles['register__feature-item--active']
            )}
          >
            <div className={clsx(styles.register__icon)}>
              <KeyRoundIcon size={20} />
            </div>
            <div className="flex-grow-1">
              <strong>3. Session Burner</strong>
              <p>
                {sessionActive
                  ? 'Session mode active — wallet unlinked from contract'
                  : isSessionOrphaned
                    ? 'Local key missing (Import or create a new session)'
                    : 'Activation required'}
              </p>
              {burnerAddress && (sessionActive || isSessionOrphaned) && (
                <small className={clsx(styles.register__address)}>
                  {burnerAddress.slice(0, 8)}...{burnerAddress.slice(-6)}
                </small>
              )}
            </div>
            <div
              className={clsx(
                styles.register__status,
                sessionActive ? styles['register__status--ok'] : styles['register__status--pending']
              )}
            >
              {sessionActive ? 'OK' : isSessionOrphaned ? 'LOST' : '!'}
            </div>
          </div>
        </section>

        {/* ■■■ Security Modules ■■■ */}
        <div className={clsx(styles.register__secureModules)}>
          {/* Vault Creation */}
          {!hasLocalVault && isConnected && (
            <div className={clsx(styles.register__secureSetup)}>
              <h5>
                <DatabaseIcon size={16} /> Create App Vault
              </h5>
              <p>This password encrypts your master stealth keys locally. It cannot be recovered.</p>
              <div className={clsx(styles.register__formGroup)}>
                <input
                  type={showVaultPlainPassword ? 'text' : 'password'}
                  placeholder="Vault password (min 8 chars)"
                  value={vaultPassword}
                  onChange={(e) => setVaultPassword(e.target.value)}
                  className={clsx(styles.register__input)}
                />
                <input
                  type={showVaultPlainPassword ? 'text' : 'password'}
                  placeholder="Confirm vault password"
                  value={confirmVaultPassword}
                  onChange={(e) => setConfirmVaultPassword(e.target.value)}
                  className={clsx(styles.register__input)}
                />
              </div>
              <div className="flex gap-05 align-items-center mt-10 mb-10">
                <input type="checkbox" id="vaultAgree" checked={vaultAgree} onChange={(e) => setVaultAgree(e.target.checked)} />
                <label htmlFor="vaultAgree" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  I understand that this password cannot be recovered.
                </label>
              </div>
              <div className="flex justify-between align-items-center mt-10">
                <button
                  type="button"
                  onClick={() => setShowVaultPlainPassword(!showVaultPlainPassword)}
                  className={clsx(styles.register__btnLink)}
                >
                  {showVaultPlainPassword ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />} {showVaultPlainPassword ? 'Hide' : 'Show'}
                </button>
                <button
                  onClick={handleCreateVaultAndRegister}
                  className={clsx(styles.register__btnPrimary)}
                  disabled={isActivating || vaultPassword.length < 8 || vaultPassword !== confirmVaultPassword || !vaultAgree}
                >
                  {isActivating ? 'Signing...' : 'Sign & Secure Vault'}
                </button>
              </div>
            </div>
          )}

          {/* Session Password Setup (new burner) */}
          {showPasswordSetup && (
            <div className={clsx(styles.register__secureSetup)}>
              <h5>
                <KeyRoundIcon size={16} /> Secure Your Session Key
              </h5>
              <p>
                Choose a password to encrypt the burner private key locally. After this, your main wallet will send a transaction to register the session on-chain.
              </p>
              <div className={clsx(styles.register__formGroup)}>
                <input
                  type={showPlainPassword ? 'text' : 'password'}
                  placeholder="Enter password (min 6 chars)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={clsx(styles.register__input)}
                />
                <input
                  type={showPlainPassword ? 'text' : 'password'}
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={clsx(styles.register__input)}
                />
              </div>
              <div className="flex gap-05 justify-between align-items-center mt-10">
                <button type="button" onClick={() => setShowPlainPassword(!showPlainPassword)} className={clsx(styles.register__btnLink)}>
                  {showPlainPassword ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />} {showPlainPassword ? 'Hide' : 'Show'}
                </button>
                <div className="flex gap-05">
                  <button onClick={() => setShowPasswordSetup(false)} className={clsx(styles.register__btnSecondary)}>
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (password !== confirmPassword) return setErrorMsg('Passwords do not match.')
                      handleAuthorizeSession(password)
                    }}
                    className={clsx(styles.register__btnPrimary)}
                    disabled={isActivating || password.length < 6}
                  >
                    {isActivating ? 'Authorizing...' : 'Authorize Session'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Decrypt & Reveal */}
          {showDecryptPrompt && (
            <div className={clsx(styles.register__secureSetup)}>
              <h5>
                <KeyRoundIcon size={16} /> Enter Password to Unlock
              </h5>
              <p>Provide your password to securely decrypt the key from localStorage.</p>
              <input
                type="password"
                placeholder="Enter session password"
                value={decryptPassword}
                onChange={(e) => setDecryptPassword(e.target.value)}
                className={clsx(styles.register__input)}
              />
              <div className="flex justify-end gap-05 mt-10">
                <button onClick={() => setShowDecryptPrompt(false)} className={clsx(styles.register__btnSecondary)}>
                  Cancel
                </button>
                <button onClick={handleDecryptAndReveal} className={clsx(styles.register__btnPrimary)} disabled={isActivating}>
                  Unlock Key
                </button>
              </div>
            </div>
          )}

          {/* Import */}
          {showImportPrompt && (
            <div className={clsx(styles.register__secureSetup)}>
              <h5>
                <UploadIcon size={16} /> Import Session Key
              </h5>
              <p>Paste the private key from your other device and choose a new password for local encryption.</p>
              <div className={clsx(styles.register__formGroup)}>
                <input
                  type="text"
                  placeholder="Private Key (0x...)"
                  value={importPrivateKeyInput}
                  onChange={(e) => setImportPrivateKeyInput(e.target.value)}
                  className={clsx(styles.register__input)}
                />
                <input
                  type="password"
                  placeholder="New Local Password"
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
                  Encrypt & Import
                </button>
              </div>
            </div>
          )}

          {/* Backup Key */}
          {revealKeyMode && revealedPrivateKey && (
            <div className={clsx(styles.register__secureSetup)}>
              <h5>Backup Session Private Key</h5>
              <p>
                <strong>CAUTION:</strong> Never share this key. Store it securely to recover your session on another device.
              </p>
              <div className={clsx(styles.register__keyContainer)}>
                <code>{revealedPrivateKey}</code>
                <button onClick={() => copyToClipboard(revealedPrivateKey)} className={clsx(styles.register__btnIcon)} title="Copy">
                  {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
                </button>
              </div>
              <div className="flex justify-end mt-10">
                <button
                  onClick={() => {
                    setRevealKeyMode(false)
                    setRevealedPrivateKey(null)
                  }}
                  className={clsx(styles.register__btnSecondary)}
                >
                  Hide Key
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ■■■ Footer Actions ■■■ */}
        <footer className={clsx(styles.register__footer)}>
          {isFullyRegistered ? (
            <button className={clsx(styles.register__button, 'btn')} onClick={() => router.push('/chat')}>
              Enter Chat Room
            </button>
          ) : !hasLocalVault ? (
            <button className={clsx(styles.register__button, 'btn')} disabled>
              1. Complete Vault Setup Above
            </button>
          ) : !isPkRegistered ? (
            <button
              className={clsx(styles.register__button, 'btn')}
              onClick={() => handleJoinTunnel(null)}
              disabled={isActivating || !isConnected}
            >
              {isActivating ? 'Registering...' : '2. Register Public Key'}
            </button>
          ) : (
            <button
              className={clsx(styles.register__button, 'btn')}
              onClick={triggerAuthorizeFlow}
              disabled={isActivating || !isConnected || showPasswordSetup}
            >
              {isActivating ? 'Authorizing...' : isSessionOrphaned ? '3. Create New Session' : '3. Activate Session'}
            </button>
          )}

          {/* Auxiliary Actions */}
          {isPkRegistered && (
            <div className="flex flex-wrap gap-05 mt-10 justify-center">
              {sessionActive && (
                <button onClick={handleRevokeSession} disabled={isActivating} className={clsx(styles.register__btnDanger, 'btn-small')}>
                  Revoke Session
                </button>
              )}
              {localStorage.getItem(chatLocalStorageBurnerKey) && !revealKeyMode && (
                <button
                  onClick={() => {
                    setErrorMsg('')
                    setShowDecryptPrompt(true)
                    setShowPasswordSetup(false)
                    setShowImportPrompt(false)
                  }}
                  className={clsx(styles.register__btnSecondary, 'btn-small')}
                  disabled={isActivating}
                >
                  Backup Key
                </button>
              )}
              {!sessionActive && (
                <button
                  onClick={() => {
                    setErrorMsg('')
                    setShowImportPrompt(true)
                    setShowPasswordSetup(false)
                    setShowDecryptPrompt(false)
                  }}
                  className={clsx(styles.register__btnSecondary, 'btn-small')}
                  disabled={isActivating}
                >
                  Import Session Key
                </button>
              )}
            </div>
          )}

          {!isFullyRegistered && (
            <p className={clsx(styles['register__gas-note'])}>
              * Steps 2 and 3 require a gas fee from your main wallet.
            </p>
          )}
        </footer>
      </div>
    </div>
  )
}
