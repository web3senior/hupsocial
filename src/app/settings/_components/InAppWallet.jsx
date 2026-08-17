'use client'

// PIN-free by design: the session key is a child of the app-wide Security Vault (Settings →
// Security), which is the ONLY place the PIN is ever asked. When the vault is locked, this
// component shows a pointer there instead of running its own password prompts.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useConnection, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { getActiveChain } from '@/lib/communication'
import hupABI from '@/abi/hup.json'
import { ArrowsClockwiseIcon, CheckIcon, CopyIcon, KeyIcon, ShieldWarningIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { ethers } from 'ethers'
import Balance from '@/app/(user)/[wallet]/_components/balance'
import { toRelativeTime } from '@/lib/dateHelper'
import { isSessionActive, localStorageBurnerAddress,localStorageBurnerKey, localStorageBatchLikeKey, sessionStorageUnlockedKey} from '@/lib/burnerSession'
import { localStorageGaslessKey, readGaslessPreference } from '@/lib/relayGasless'
import { encryptData, decryptData } from '@/lib/cryptoHelper'
import { getCachedMasterHex, deriveChildKeyBytes, CHILD_KEY_LABELS } from '@/lib/securityVault'
import { isHexString, Wallet } from 'ethers'
import styles from './InAppWallet.module.scss'
import clsx from 'clsx'

export default function InAppWallet({ onOpenSecurity }) {
  // Establish state to track whether the switch is turned on or off
  const [isOn, setIsOn] = useState(true)

  // Trial: while on, posts, likes, unlikes and reposts are relayed through our forwarder
  // and cost the user nothing
  const [isGaslessOn, setIsGaslessOn] = useState(true)

  const { address } = useConnection()
  const publicClient = usePublicClient()
  const activeChain = getActiveChain()

  // Base states
  const [sessionActive, setSessionActive] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [burnerAddress, setBurnerAddress] = useState(null)
  const [expiresAt, setExpiresAt] = useState(null)

  // Security states — no passwords here, only "is the shared vault unlocked"
  const [needsVault, setNeedsVault] = useState(false)
  const [showImportPrompt, setShowImportPrompt] = useState(false)
  const [revealKeyMode, setRevealKeyMode] = useState(false)
  const [revealedPrivateKey, setRevealedPrivateKey] = useState(null)
  const [copied, setCopied] = useState(false)

  // Import custom key states
  const [importPrivateKeyInput, setImportPrivateKeyInput] = useState('')

  // UI helpers
  const [errorMsg, setErrorMsg] = useState('')

  const { data: hash, mutate: writeContract } = useWriteContract()

  // Load the initial toggle preferences from localStorage on mount
  useEffect(() => {
    const savedPreference = localStorage.getItem(localStorageBatchLikeKey)
    if (savedPreference !== null) {
      setIsOn(savedPreference === 'true')
    }

    setIsGaslessOn(readGaslessPreference())
  }, [])

  // Update localStorage whenever the toggle switch state changes
  const handleToggleChange = (e) => {
    const nextState = e.target.checked
    setIsOn(nextState)
    localStorage.setItem(localStorageBatchLikeKey, String(nextState))
  }

  const handleGaslessToggleChange = (e) => {
    const nextState = e.target.checked
    setIsGaslessOn(nextState)
    localStorage.setItem(localStorageGaslessKey, String(nextState))
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

  // Recovers the burner's plaintext private key using the unlocked vault master. Handles the
  // legacy case (key at rest encrypted with the old per-feature PIN, which we no longer ask
  // for): if the stored blob won't open with the master but the wallet is vault-derived, the
  // exact same key is simply re-derived from the master and re-encrypted. Only a foreign
  // (imported) key encrypted under the old scheme is unrecoverable without a re-import.
  const unlockBurnerPrivateKey = async (masterHex) => {
    const encryptedKey = localStorage.getItem(localStorageBurnerKey)
    const storedAddress = localStorage.getItem(localStorageBurnerAddress)
    if (!encryptedKey) return null

    try {
      return await decryptData(encryptedKey, masterHex)
    } catch {
      const seedBytes = await deriveChildKeyBytes(masterHex, CHILD_KEY_LABELS.inAppWallet)
      const derived = new ethers.Wallet(ethers.hexlify(seedBytes))
      if (storedAddress && derived.address.toLowerCase() === storedAddress.toLowerCase()) {
        localStorage.setItem(localStorageBurnerKey, await encryptData(derived.privateKey, masterHex))
        return derived.privateKey
      }
      throw new Error('This session key was imported under an old password. Re-import it to use it again.')
    }
  }

  const handleAuthorizeSession = async () => {
    try {
      setIsLoading(true)
      setErrorMsg('')
      setNeedsVault(false)

      if (!address) {
        throw new Error('Connect your wallet first.')
      }

      let targetBurnerAddress = localStorage.getItem(localStorageBurnerAddress)

      if (!localStorage.getItem(localStorageBurnerKey) || !targetBurnerAddress) {
        // Child key of the app-wide security vault. Same wallet + same PIN always reproduces
        // the same burner key on any device — the vault (Settings → Security) is where that
        // PIN lives; this component never asks for it.
        const masterHex = getCachedMasterHex()
        if (!masterHex) {
          setNeedsVault(true)
          return
        }

        const seedBytes = await deriveChildKeyBytes(masterHex, CHILD_KEY_LABELS.inAppWallet)
        const burner = new ethers.Wallet(ethers.hexlify(seedBytes))
        const encryptedKey = await encryptData(burner.privateKey, masterHex)

        localStorage.setItem(localStorageBurnerKey, encryptedKey)
        localStorage.setItem(localStorageBurnerAddress, burner.address)
        sessionStorage.setItem(sessionStorageUnlockedKey, burner.privateKey)

        targetBurnerAddress = burner.address
      }

      const duration = 3600 * 24 * 30 // 30 days

      writeContract({
        address: activeChain[1].hup,
        abi: hupABI,
        functionName: 'authorizeSession',
        args: [targetBurnerAddress, duration],
      })
    } catch (err) {
      console.error('Session authorization failed:', err)
      setErrorMsg(err.message || 'Authorization failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleReveal = async () => {
    try {
      setIsLoading(true)
      setErrorMsg('')

      const masterHex = getCachedMasterHex()
      if (!masterHex) {
        setNeedsVault(true)
        return
      }

      const decrypted = await unlockBurnerPrivateKey(masterHex)
      if (!decrypted) {
        throw new Error('No session key found on this device.')
      }

      sessionStorage.setItem(sessionStorageUnlockedKey, decrypted)
      setRevealedPrivateKey(decrypted)
      setRevealKeyMode(true)
    } catch (err) {
      setErrorMsg(err.message || 'Failed to unlock the session key.')
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

      // At-rest encryption uses the vault master — no separate password to remember
      const masterHex = getCachedMasterHex()
      if (!masterHex) {
        setNeedsVault(true)
        return
      }

      // Instantiation using the updated v6 class syntax
      const importedWallet = new Wallet(importPrivateKeyInput)
      const encryptedKey = await encryptData(importPrivateKeyInput, masterHex)

      localStorage.setItem(localStorageBurnerKey, encryptedKey)
      localStorage.setItem(localStorageBurnerAddress, importedWallet.address)
      sessionStorage.setItem(sessionStorageUnlockedKey, importPrivateKeyInput)

      await checkStatus()
      setShowImportPrompt(false)
      setImportPrivateKeyInput('')
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
                <ArrowsClockwiseIcon size={18} />
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
                <ShieldWarningIcon size={16} />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* VAULT LOCKED NOTICE — the Security tab is the app's only PIN entry point */}
            {needsVault && (
              <div className={styles.secureSetup}>
                <h5>
                  <KeyIcon size={16} /> Security Vault locked
                </h5>
                <p>
                  Your session key is derived from the app-wide Security Vault (one signature + one PIN, shared with
                  private communities). Unlock it once and come back — no separate wallet password to remember.
                </p>
                <div className="flex justify-end">
                  <button onClick={onOpenSecurity} className={styles.btnPrimary} disabled={!onOpenSecurity}>
                    Open Security Vault
                  </button>
                </div>
              </div>
            )}

            {/* IMPORT SESSION KEY PROMPT */}
            {showImportPrompt && (
              <div className={styles.secureSetup}>
                <h5>
                  <UploadSimpleIcon size={16} /> Import Session Key
                </h5>
                <p>Paste the private key from your other device — it's stored encrypted under your Security Vault.</p>
                <div className={styles.formGroup}>
                  <input
                    type="text"
                    placeholder="Enter Private Key (starts with 0x)"
                    value={importPrivateKeyInput}
                    onChange={(e) => setImportPrivateKeyInput(e.target.value)}
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
                onClick={handleAuthorizeSession}
                disabled={sessionActive || isLoading}
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
                    setShowImportPrompt(false)
                    handleReveal()
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
                  setNeedsVault(false)
                  setShowImportPrompt(true)
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

        <div className={clsx('col-desktop-4 flex align-items-center justify-content-between gap-1')}>
          <div className="flex flex-column">
            <span>Gasless Actions</span>
            {/* Whoever just learned their posts are paid for is exactly who might chip in */}
            <Link href="/gas" className={styles.subtleLink}>
              See the gas tank
            </Link>
          </div>
          <ToggleSwitch checked={isGaslessOn} onChange={handleGaslessToggleChange} />
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