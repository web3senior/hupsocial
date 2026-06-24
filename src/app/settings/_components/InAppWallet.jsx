'use client'

import { useCallback, useEffect, useState } from 'react'
import { useConnection, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { getActiveChain } from '@/lib/communication'
import hupABI from '@/abi/hup.json'
import { RefreshCwIcon, EyeIcon, EyeOffIcon, KeyRoundIcon, ShieldAlertIcon, CheckIcon, CopyIcon, UploadIcon } from 'lucide-react'
import { ethers } from 'ethers'
import Balance from '@/app/(user)/[wallet]/_components/balance'
import { toRelativeTime } from '@/lib/dateHelper'
import { isSessionActive, localStorageBurnerAddress,localStorageBurnerKey, localStorageBatchLikeKey, sessionStorageUnlockedKey} from '@/lib/burnerSession'
import { encryptData, decryptData, isPrivateKeyEncrypted } from '@/lib/cryptoHelper'
import { isHexString, Wallet } from 'ethers'
import styles from './InAppWallet.module.scss'
import clsx from 'clsx'

export default function InAppWallet() {
  // Establish state to track whether the switch is turned on or off
  const [isOn, setIsOn] = useState(true)

  const { address } = useConnection()
  const publicClient = usePublicClient()
  const activeChain = getActiveChain()

  // Base states
  const [sessionActive, setSessionActive] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [burnerAddress, setBurnerAddress] = useState(null)
  const [expiresAt, setExpiresAt] = useState(null)

  // Password / Security States
  const [showPasswordSetup, setShowPasswordSetup] = useState(false)
  const [showDecryptPrompt, setShowDecryptPrompt] = useState(false)
  const [showImportPrompt, setShowImportPrompt] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [decryptPassword, setDecryptPassword] = useState('')
  const [revealKeyMode, setRevealKeyMode] = useState(false)
  const [revealedPrivateKey, setRevealedPrivateKey] = useState(null)
  const [copied, setCopied] = useState(false)

  // Import custom key states
  const [importPrivateKeyInput, setImportPrivateKeyInput] = useState('')
  const [importPassword, setImportPassword] = useState('')

  // UI helpers
  const [showPlainPassword, setShowPlainPassword] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const { data: hash, writeContract } = useWriteContract()

  // Load the initial toggle preference from localStorage on mount
  useEffect(() => {
    const savedPreference = localStorage.getItem(localStorageBatchLikeKey)
    if (savedPreference !== null) {
      setIsOn(savedPreference === 'true')
    }
  }, [])

  // Update localStorage whenever the toggle switch state changes
  const handleToggleChange = (e) => {
    const nextState = e.target.checked
    setIsOn(nextState)
    localStorage.setItem(localStorageBatchLikeKey, String(nextState))
  }

  const checkStatus = useCallback(async () => {
    try {
      const session = await isSessionActive({
        userAddress: address,
        publicClient,
      })

      setSessionActive(session.active)
      setBurnerAddress(session.burnerAddress)
      setExpiresAt(session.expiresAt)
    } catch (err) {
      console.error('Status check failed:', err)
      setSessionActive(false)
    }
  }, [address, publicClient])

  useEffect(() => {
    checkStatus()
    const interval = setInterval(checkStatus, 30000)
    return () => clearInterval(interval)
  }, [checkStatus])

  const triggerAuthorizeFlow = () => {
    setErrorMsg('')
    setPassword('')
    setConfirmPassword('')

    const existingKey = localStorage.getItem(localStorageBurnerKey)
    if (existingKey && isPrivateKeyEncrypted(existingKey)) {
      handleAuthorizeSession(null)
    } else {
      setShowPasswordSetup(true)
    }
  }

  const handleAuthorizeSession = async (customPassword = null) => {
    try {
      setIsLoading(true)
      setErrorMsg('')

      let targetBurnerAddress
      let currentKey = localStorage.getItem(localStorageBurnerKey)

      if (!currentKey || !localStorage.getItem(localStorageBurnerAddress)) {
        if (!customPassword || customPassword.length < 6) {
          throw new Error('Please enter a secure password (at least 6 characters).')
        }

        const burner = ethers.Wallet.createRandom()
        const encryptedKey = await encryptData(burner.privateKey, customPassword)

        localStorage.setItem(localStorageBurnerKey, encryptedKey)
        localStorage.setItem(localStorageBurnerAddress, burner.address)
        sessionStorage.setItem(sessionStorageUnlockedKey, burner.privateKey)

        targetBurnerAddress = burner.address
      } else {
        targetBurnerAddress = localStorage.getItem(localStorageBurnerAddress)
      }

      const duration = 3600 * 24 * 30 // 30 days

      writeContract({
        address: activeChain[1].hup,
        abi: hupABI,
        functionName: 'authorizeSession',
        args: [targetBurnerAddress, duration],
      })

      setShowPasswordSetup(false)
    } catch (err) {
      console.error('Session authorization failed:', err)
      setErrorMsg(err.message || 'Authorization failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDecryptAndReveal = async () => {
    try {
      setIsLoading(true)
      setErrorMsg('')
      const encryptedKey = localStorage.getItem(localStorageBurnerKey)

      if (!encryptedKey) {
        throw new Error('No session key found on this device.')
      }

      if (!isPrivateKeyEncrypted(encryptedKey)) {
        setRevealedPrivateKey(encryptedKey)
        setRevealKeyMode(true)
        setShowDecryptPrompt(false)
        return
      }

      const decrypted = await decryptData(encryptedKey, decryptPassword)
      setRevealedPrivateKey(decrypted)
      sessionStorage.setItem(sessionStorageUnlockedKey, decrypted)

      setRevealKeyMode(true)
      setShowDecryptPrompt(false)
      setDecryptPassword('')
    } catch (err) {
      setErrorMsg(err.message || 'Decryption failed. Incorrect password.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleImportSessionKey = async () => {
    try {
      setIsLoading(true)
      setErrorMsg('')

      // Validate the raw string format cleanly using Ethers v6 top-level utilities
      if (!isHexString(importPrivateKeyInput, 32)) {
        throw new Error('Invalid private key format. Must be a 66-character hex string (starting with 0x).')
      }

      if (importPassword.length < 6) {
        throw new Error('Password must be at least 6 characters.')
      }

      // Instantiation using the updated v6 class syntax
      const importedWallet = new Wallet(importPrivateKeyInput)
      const encryptedKey = await encryptData(importPrivateKeyInput, importPassword)

      localStorage.setItem(localStorageBurnerKey, encryptedKey)
      localStorage.setItem(localStorageBurnerAddress, importedWallet.address)
      sessionStorage.setItem(sessionStorageUnlockedKey, importPrivateKeyInput)

      await checkStatus()
      setShowImportPrompt(false)
      setImportPrivateKeyInput('')
      setImportPassword('')
    } catch (err) {
      setErrorMsg(err.message || 'Import failed. Check private key format.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRevokeSession = async () => {
    try {
      setIsLoading(true)
      writeContract({
        address: activeChain[1].hup,
        abi: hupABI,
        functionName: 'revokeSession',
        args: [],
      })
    } catch (err) {
      console.error('Session revocation failed:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={clsx(styles.page, 'relative')}>
      <div className="__container" data-width="medium">
        <div className={clsx('col-desktop-8', styles.section)}>
          <div className={styles.sectionBody}>
            <div className="flex justify-between align-items-center">
              <h4>In app wallet</h4>
              <button onClick={checkStatus} className={styles.btnIcon}>
                <RefreshCwIcon size={18} />
              </button>
            </div>
            <small style={{ color: 'var(--text-muted)' }}>
              Send a small amount of native token to the burner address to sign transactions automatically in the background.
            </small>

            <div className="mt-15">
              <p>Status: {sessionActive ? '🟢 Active' : 'Not Set'}</p>

              {burnerAddress && (
                <div className={styles.bgLight}>
                  <p className="m-0 mb-5">
                    <strong>Burner Address:</strong> <br />
                    <code>{burnerAddress}</code>
                  </p>
                  <p className="m-0 mb-5">
                    <strong>Balance:</strong> <Balance addr={burnerAddress} />
                  </p>
                  {expiresAt && (
                    <p className="m-0">
                      <strong>Expires At:</strong> <br />
                      <code>
                        {sessionActive ? 'In ' : ''}
                        {sessionActive ? toRelativeTime(expiresAt) : 'Expired'}
                      </code>
                    </p>
                  )}
                </div>
              )}
            </div>

            {errorMsg && (
              <div className={styles.alertError}>
                <ShieldAlertIcon size={16} />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* PASSWORD SETUP FORM */}
            {showPasswordSetup && (
              <div className={styles.secureSetup}>
                <h5>
                  <KeyRoundIcon size={16} /> Secure Your Session Key
                </h5>
                <p>Choose a PIN or Password. It will be used to encrypt the burner private key before storing it on this device.</p>
                <div className={styles.formGroup}>
                  <input
                    type={showPlainPassword ? 'text' : 'password'}
                    placeholder="Enter password (min 6 characters)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={styles.formControl}
                  />
                  <input
                    type={showPlainPassword ? 'text' : 'password'}
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={styles.formControl}
                  />
                </div>
                <div className="flex gap-05 justify-between align-items-center">
                  <button type="button" onClick={() => setShowPlainPassword(!showPlainPassword)} className={styles.btnLink}>
                    {showPlainPassword ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />} {showPlainPassword ? 'Hide' : 'Show'}
                  </button>
                  <div className="flex gap-05">
                    <button onClick={() => setShowPasswordSetup(false)} className={styles.btnSecondary}>
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (password !== confirmPassword) {
                          setErrorMsg('Passwords do not match.')
                          return
                        }
                        handleAuthorizeSession(password)
                      }}
                      className={styles.btnPrimary}
                      disabled={isLoading}
                    >
                      Encrypt & Authorize
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* DECRYPT / REVEAL PASSWORD PROMPT */}
            {showDecryptPrompt && (
              <div className={styles.secureSetup}>
                <h5>
                  <KeyRoundIcon size={16} /> Enter Password to Unlock
                </h5>
                <p>Provide your password to securely decrypt the key from localStorage.</p>
                <input
                  type="password"
                  placeholder="Enter session password"
                  value={decryptPassword}
                  onChange={(e) => setDecryptPassword(e.target.value)}
                  className={styles.formControl}
                />
                <div className="flex justify-end gap-050 mt-15">
                  <button onClick={() => setShowDecryptPrompt(false)} className={styles.btnSecondary}>
                    Cancel
                  </button>
                  <button onClick={handleDecryptAndReveal} className={styles.btnPrimary} disabled={isLoading}>
                    Unlock Key
                  </button>
                </div>
              </div>
            )}

            {/* IMPORT SESSION KEY PROMPT */}
            {showImportPrompt && (
              <div className={styles.secureSetup}>
                <h5>
                  <UploadIcon size={16} /> Import Session Key
                </h5>
                <p>Paste the private key from your other device and choose a new password for local encryption.</p>
                <div className={styles.formGroup}>
                  <input
                    type="text"
                    placeholder="Enter Private Key (starts with 0x)"
                    value={importPrivateKeyInput}
                    onChange={(e) => setImportPrivateKeyInput(e.target.value)}
                    className={styles.formControl}
                  />
                  <input
                    type="password"
                    placeholder="Create a Password for local encryption"
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    className={styles.formControl}
                  />
                </div>
                <div className="flex justify-end gap-1">
                  <button onClick={() => setShowImportPrompt(false)} className={styles.btnSecondary}>
                    Cancel
                  </button>
                  <button onClick={handleImportSessionKey} className={styles.btnPrimary} disabled={isLoading}>
                    Encrypt & Import
                  </button>
                </div>
              </div>
            )}

            {/* REVEALED PRIVATE KEY SECTION */}
            {revealKeyMode && revealedPrivateKey && (
              <div className={styles.secureSetup}>
                <h5>Backup Session Private Key</h5>
                <p>
                  <strong>CAUTION:</strong> Never share this key. Store it securely to recover your session on other devices.
                </p>
                <div className={styles.keyContainer}>
                  <code>{revealedPrivateKey}</code>
                  <button onClick={() => copyToClipboard(revealedPrivateKey)} className={styles.btnIcon} title="Copy to clipboard">
                    {copied ? <CheckIcon size={16} style={{ color: 'var(--toggle-active)' }} /> : <CopyIcon size={16} />}
                  </button>
                </div>
                <div className="flex justify-end mt-15">
                  <button
                    onClick={() => {
                      setRevealKeyMode(false)
                      setRevealedPrivateKey(null)
                    }}
                    className={styles.btnSecondary}
                  >
                    Hide Key
                  </button>
                </div>
              </div>
            )}

            {/* ACTION BUTTONS GROUP */}
            <div className="flex flex-wrap gap-10 mt-20 gap-1">
              <button
                onClick={triggerAuthorizeFlow}
                disabled={sessionActive || isLoading || showPasswordSetup}
                className={styles.btnPrimary}
              >
                Authorize Session
              </button>

              <button onClick={handleRevokeSession} disabled={!sessionActive || isLoading} className={styles.btnDanger}>
                Revoke Session
              </button>

              {localStorage.getItem(localStorageBurnerKey) && !revealKeyMode && (
                <button
                  onClick={() => {
                    setErrorMsg('')
                    setShowDecryptPrompt(true)
                    setShowPasswordSetup(false)
                    setShowImportPrompt(false)
                  }}
                  className={styles.btnSecondary}
                  disabled={isLoading}
                >
                  Backup Key
                </button>
              )}

              <button
                onClick={() => {
                  setErrorMsg('')
                  setShowImportPrompt(true)
                  setShowPasswordSetup(false)
                  setShowDecryptPrompt(false)
                }}
                className={styles.btnSecondary}
                disabled={isLoading}
              >
                Import Key
              </button>
            </div>
          </div>
        </div>

        <div className={clsx('col-desktop-4 flex align-items-center justify-content-between gap-1')}>
          <span>Batch Like</span>
          <ToggleSwitch checked={isOn} onChange={handleToggleChange} />
        </div>
      </div>
    </div>
  )
}

export function ToggleSwitch({ checked, onChange }) {
  return (
    <label className={clsx(styles.toggleSwitch, checked && styles.checked)}>
      <input type="checkbox" className={styles.nativeCheckbox} checked={checked} onChange={onChange} />
      <span className={styles.slider}></span>
    </label>
  )
}