'use client'

// PIN-free by design: the session key is a child of the app-wide vault (Settings → Security). New
// keys come from Key Vault v2; keys made under the original vault keep working and can be moved
// to v2 from here. When a vault is needed and locked, the shared unlock dialog opens for the
// action underway — this component never runs a password prompt of its own.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useConnection, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { getActiveChain } from '@/lib/communication'
import hupABI from '@/abi/hup.json'
import { ArrowsClockwiseIcon, CheckIcon, CopyIcon, KeyIcon, ShieldCheckIcon, ShieldWarningIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { ethers } from 'ethers'
import Balance from '@/app/(user)/[wallet]/_components/balance'
import { toRelativeTime } from '@/lib/dateHelper'
import {
  ensureVaultUnlocked,
  getBurnerVersion,
  isSessionActive,
  localStorageBatchLikeKey,
  resolveLegacyBurner,
  unlockBurnerWithMaster,
} from '@/lib/burnerSession'
import { BURNER_FIELDS, readBurner, readUnlockedBurner, writeBurner, writeUnlockedBurner } from '@/lib/burnerStorage'
import { localStorageGaslessKey, readGaslessPreference } from '@/lib/relayGasless'
import { encryptData, decryptData } from '@/lib/cryptoHelper'
import { getCachedMasterHex } from '@/lib/securityVault'
import { deriveKeyFromMasterV2, ensureMasterV2, wrapLegacyMaster } from '@/lib/keyVaultV2'
import { KEY_LABELS } from '@/lib/keyDerivationV2.mjs'
import { upgradeBurnerToV2 } from '@/lib/burnerUpgrade'
import { appChains } from '@/config/contracts'
import { isHexString, Wallet } from 'ethers'
import ToggleSwitch from '@/components/ui/ToggleSwitch'
import styles from './InAppWallet.module.scss'
import clsx from 'clsx'

const chainName = (chainId) => appChains.find((chain) => chain.id === chainId)?.name ?? `Chain ${chainId}`

const SWEEP_COPY = {
  moved: 'moved',
  empty: 'nothing to move',
  dust: 'too little to cover gas, left on the old key',
  failed: 'not moved',
}

// A cancelled unlock or signature is the member changing their mind, not an error to show
const isCancel = (err) => err?.code === 4001 || err?.name === 'UserRejectedRequestError'

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

  // v1 → v2 upgrade: which vault the stored key belongs to, and the per-chain sweep as it runs
  // Read at first render: this panel already reads local storage while rendering (the backup
  // button below), so it only ever renders in the browser
  const readLegacyFlag = () => typeof window !== 'undefined' && Boolean(readBurner(BURNER_FIELDS.legacy))
  const [burnerVersion, setBurnerVersion] = useState(getBurnerVersion)
  const [hasLegacyKey, setHasLegacyKey] = useState(readLegacyFlag)
  const [upgradeResults, setUpgradeResults] = useState(null)
  const [isUpgrading, setIsUpgrading] = useState(false)

  const readStoredVersion = useCallback(() => {
    setBurnerVersion(getBurnerVersion())
    setHasLegacyKey(Boolean(readBurner(BURNER_FIELDS.legacy)))
  }, [])

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

      // The stored key is per wallet, so a switch re-reads which vault it belongs to
      readStoredVersion()
      setSessionActive(session.active)
      setBurnerAddress(session.burnerAddress)
      setExpiresAt(session.expiresAt)
    } catch (err) {
      console.error('Status check failed:', err)
      setSessionActive(false)
    }
  }, [address, publicClient, readStoredVersion])

  useEffect(() => {
    checkStatus()
    const interval = setInterval(checkStatus, 30000)
    return () => clearInterval(interval)
  }, [checkStatus])

  // Recovers the burner's plaintext private key with the master of the vault it belongs to.
  // unlockBurnerWithMaster also handles the oldest case (a blob at rest under the retired
  // per-feature password): a vault-derived key is re-derived and re-encrypted, and only a foreign
  // imported key from that era needs a re-import.
  const unlockBurnerPrivateKey = async () => {
    if (!readBurner(BURNER_FIELDS.key)) return null
    const version = getBurnerVersion()
    const masterHex = version === 'v2' ? await ensureMasterV2({ reason: 'Backing up your session key' }) : getCachedMasterHex()
    if (!masterHex) {
      setNeedsVault(true)
      return null
    }
    try {
      return await unlockBurnerWithMaster(masterHex, version)
    } catch (err) {
      if (err.code === 'WRONG_PIN') throw new Error('This session key was imported under an old password. Re-import it to use it again.')
      throw err
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

      // A key left from before keys had owners may be another wallet's — never authorize that one
      await resolveLegacyBurner({ reason: 'Checking the session key on this device' })

      let targetBurnerAddress = readBurner(BURNER_FIELDS.address)

      if (!readBurner(BURNER_FIELDS.key) || !targetBurnerAddress) {
        // Child key of Key Vault v2. Same wallet + same PIN always reproduces the same burner
        // key on any device; the shared unlock dialog asks for that PIN, this component never does.
        const masterHex = await ensureMasterV2({ reason: 'Creating your in-app wallet' })
        const burner = new ethers.Wallet(deriveKeyFromMasterV2(masterHex, KEY_LABELS.inAppWallet))
        const encryptedKey = await encryptData(burner.privateKey, masterHex)

        writeBurner({ key: encryptedKey, address: burner.address, version: 'v2' })
        writeUnlockedBurner(burner.privateKey)
        readStoredVersion()

        targetBurnerAddress = burner.address
      }

      const duration = 3600 * 24 * 365 // 1 year

      writeContract({
        address: activeChain[1].hup,
        abi: hupABI,
        functionName: 'authorizeSession',
        args: [targetBurnerAddress, duration],
      })
    } catch (err) {
      if (isCancel(err)) return
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

      const decrypted = await unlockBurnerPrivateKey()
      if (!decrypted) {
        if (readBurner(BURNER_FIELDS.key)) return // vault pointer is showing
        throw new Error('No session key found on this device.')
      }

      writeUnlockedBurner(decrypted)
      setRevealedPrivateKey(decrypted)
      setRevealKeyMode(true)
    } catch (err) {
      if (isCancel(err)) return
      setErrorMsg(err.message || 'Failed to unlock the session key.')
    } finally {
      setIsLoading(false)
    }
  }

  // The pre-upgrade key, kept under v2 so whatever a sweep left behind is never out of reach
  const handleRevealLegacy = async () => {
    try {
      setIsLoading(true)
      setErrorMsg('')
      const masterHex = await ensureMasterV2({ reason: 'Showing your previous session key' })
      setRevealedPrivateKey(await decryptData(readBurner(BURNER_FIELDS.legacy), masterHex))
      setRevealKeyMode(true)
    } catch (err) {
      if (isCancel(err)) return
      setErrorMsg(err.message || 'Failed to open the previous session key.')
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * Moves a v1 session key to Key Vault v2: opens the old key (v1 vault) and the v2 vault, sweeps
   * every chain's balance to the new address, then re-authorizes this chain's session for it.
   * Other chains show "Not Set" until authorized there, as a new key always has.
   */
  const handleUpgrade = async () => {
    try {
      setIsUpgrading(true)
      setErrorMsg('')
      setUpgradeResults([])

      await ensureVaultUnlocked({ reason: 'Upgrading your in-app wallet' })
      const oldPrivateKey = readUnlockedBurner()
      if (!oldPrivateKey) throw new Error('Your current session key is still locked.')

      const masterV2Hex = await ensureMasterV2({ reason: 'Upgrading your in-app wallet' })
      // Both vaults are open right now, which is the one moment the v1 master can be wrapped
      // under v2 — after this, one v2 unlock opens communities too
      if (getCachedMasterHex()) await wrapLegacyMaster(address).catch(() => false)

      const { newAddress } = await upgradeBurnerToV2({
        masterV2Hex,
        oldPrivateKey,
        onProgress: (result) => setUpgradeResults((previous) => [...(previous ?? []), result]),
      })
      readStoredVersion()

      if (sessionActive) {
        writeContract({
          address: activeChain[1].hup,
          abi: hupABI,
          functionName: 'authorizeSession',
          args: [newAddress, 3600 * 24 * 365],
        })
      }
      await checkStatus()
    } catch (err) {
      if (isCancel(err)) return
      console.error('In-app wallet upgrade failed:', err)
      setErrorMsg(err.message || 'The upgrade did not finish. Nothing was lost; try again.')
    } finally {
      setIsUpgrading(false)
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

      // At-rest encryption uses the Key Vault v2 master — no separate password to remember
      const masterHex = await ensureMasterV2({ reason: 'Importing a session key' })

      // Instantiation using the updated v6 class syntax
      const importedWallet = new Wallet(importPrivateKeyInput)
      const encryptedKey = await encryptData(importPrivateKeyInput, masterHex)

      writeBurner({ key: encryptedKey, address: importedWallet.address, version: 'v2' })
      writeUnlockedBurner(importPrivateKeyInput)
      readStoredVersion()

      await checkStatus()
      setShowImportPrompt(false)
      setImportPrivateKeyInput('')
    } catch (err) {
      if (isCancel(err)) return
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
      {/* No __container here: the settings pane is already one, and a nested container takes
          the sidebar clearance a second time and pushes this card past the pane */}
      <div className={styles.stack}>
        <div className={styles.section}>
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
                    <code className={styles.address}>{burnerAddress}</code>
                  </p>
                  {/* Balance renders a block, so it cannot sit in a <p> — the browser closes
                      the paragraph before it and the layout loses the wrapper */}
                  <div className="m-0 mb-5">
                    <strong>Balance:</strong> <Balance addr={burnerAddress} />
                  </div>
                  {expiresAt && (
                    <p className="m-0">
                      <strong>Expires At:</strong> <br />
                      <code>
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

            {/* UPGRADE TO THE KEY VAULT — only for a key made under the original vault */}
            {burnerAddress && burnerVersion === 'v1' && (
              <div className={styles.secureSetup}>
                <h5>
                  <ShieldCheckIcon size={16} /> Upgrade to your Key Vault
                </h5>
                <p>
                  Your Key Vault replaces the short PIN with a strong passphrase that is far harder to guess, even by someone holding
                  your signature. Upgrading gives this wallet a new address: Hup moves the balance on every network to it,
                  keeps your current key as a backup, and asks you to authorize the new key on this network.
                </p>
                <div className="flex justify-end">
                  <button onClick={handleUpgrade} className={styles.btnPrimary} disabled={isUpgrading || isLoading}>
                    {isUpgrading ? 'Upgrading…' : 'Upgrade'}
                  </button>
                </div>
              </div>
            )}

            {upgradeResults && upgradeResults.length > 0 && (
              <div className={styles.bgLight}>
                <p className="m-0 mb-5">
                  <strong>{isUpgrading ? 'Moving your balances…' : 'Upgrade finished'}</strong>
                </p>
                {upgradeResults.map((result) => (
                  <p key={result.chainId} className="m-0">
                    {chainName(result.chainId)}: {SWEEP_COPY[result.status]}
                    {result.status === 'failed' && result.error ? ` (${result.error})` : ''}
                  </p>
                ))}
              </div>
            )}

            {/* VAULT LOCKED NOTICE — the Security tab is the app's only PIN entry point */}
            {needsVault && (
              <div className={styles.secureSetup}>
                <h5>
                  <KeyIcon size={16} /> Original vault locked
                </h5>
                <p>
                  This session key was made under your original vault (one signature + one PIN, shared with private
                  communities). Unlock it once and come back, or upgrade the key to your Key Vault.
                </p>
                <div className="flex justify-end">
                  <button onClick={onOpenSecurity} className={styles.btnPrimary} disabled={!onOpenSecurity}>
                    Open Security settings
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
                <p>Paste the private key from your other device — it's stored encrypted under your Key Vault.</p>
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

              {readBurner(BURNER_FIELDS.key) && !revealKeyMode && (
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

              {hasLegacyKey && !revealKeyMode && (
                <button onClick={handleRevealLegacy} className={styles.btnSecondary} disabled={isLoading}>
                  Previous Key
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

        <div className={styles.prefRow}>
          <span>Batch Like</span>
          <ToggleSwitch checked={isOn} onChange={handleToggleChange} aria-label="Batch Like" />
        </div>

        <div className={styles.prefRow}>
          <div className={styles.prefRow__text}>
            <span>Gasless Actions</span>
            {/* Whoever just learned their posts are paid for is exactly who might chip in */}
            <Link href="/gas" className={styles.subtleLink}>
              See the gas tank
            </Link>
          </div>
          <ToggleSwitch checked={isGaslessOn} onChange={handleGaslessToggleChange} aria-label="Gasless Actions" />
        </div>
      </div>
    </div>
  )
}
