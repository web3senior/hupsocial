'use client'

import { useEffect, useRef, useState } from 'react'
import { CopyIcon, EyeIcon, KeyIcon } from '@phosphor-icons/react'
import { useClientMounted } from '@/hooks/useClientMount'
import { useConnection, useDisconnect } from 'wagmi'
import clsx from 'clsx'
import { toast } from '@/components/NextToast'
import { getEmbeddedAddress, getEmbeddedPrivateKey } from '@/lib/embeddedWallet/connector'
import { encryptBackup, forgetDeviceShare, loadDeviceShare, saveDeviceShare, serializeKdfParams, splitKey } from '@/lib/embeddedWallet/crypto'
import styles from './EmailWallet.module.scss'

const MIN_PASSWORD_LENGTH = 8

// Keep in sync with the --holding transition in EmailWallet.module.scss
const HOLD_TO_REVEAL_MS = 1500

/**
 * Owner controls for the email embedded wallet. Everything here runs on the
 * key already unlocked in this tab's memory — changing the recovery password
 * re-encrypts the backup client-side and rotates the share split, and export
 * hands the raw key to the owner so Hup stops being their single point of
 * failure. None of it sends key material anywhere.
 */
export default function EmailWallet() {
  // Connection state and the in-memory key only exist client-side; rendering
  // them during SSR/hydration is a guaranteed mismatch (same gate ConnectWallet uses)
  const mounted = useClientMounted()
  const { address, isConnected } = useConnection()
  const { mutate: disconnect } = useDisconnect()

  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [holding, setHolding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const holdTimerRef = useRef(null)

  // Deliberate friction: the key only shows after an uninterrupted hold, so a
  // stray tap (or someone reaching over) can't flash it. Release resets.
  const beginHold = () => {
    if (revealed || holdTimerRef.current) return
    setHolding(true)
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null
      setHolding(false)
      setRevealed(true)
    }, HOLD_TO_REVEAL_MS)
  }

  const cancelHold = () => {
    clearTimeout(holdTimerRef.current)
    holdTimerRef.current = null
    setHolding(false)
  }

  useEffect(() => () => clearTimeout(holdTimerRef.current), [])

  // The card only manages a wallet whose key is unlocked in this tab
  const isEmailWallet = mounted && isConnected && address && getEmbeddedAddress()?.toLowerCase() === address.toLowerCase()

  if (!mounted) return null

  const execute = async (event, work) => {
    event?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const changePassword = (event) =>
    execute(event, async () => {
      if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Recovery password needs at least ${MIN_PASSWORD_LENGTH} characters`)
      if (password !== passwordConfirm) throw new Error('Passwords do not match')

      const privateKey = getEmbeddedPrivateKey()
      if (!privateKey) throw new Error('Wallet is locked — reconnect with your email first')

      // New backup under the new password, and a fresh split for hygiene
      const backupBlob = await encryptBackup(privateKey, password)
      const { deviceShare, serverShare } = splitKey(privateKey)

      const response = await fetch('/api/v1/auth/email/keystore', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: getEmbeddedAddress(), serverShare, backupBlob, kdfParams: serializeKdfParams() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.success === false) throw new Error(data.error || 'Failed to update the keystore')

      const device = await loadDeviceShare(getEmbeddedAddress())
      await saveDeviceShare({ email: device?.email || '', address: getEmbeddedAddress(), share: deviceShare })

      setPassword('')
      setPasswordConfirm('')
      toast(`recovery password updated`, `success`)
    })

  const copyKey = async () => {
    await navigator.clipboard.writeText(getEmbeddedPrivateKey() || '')
    toast(`private key copied — store it somewhere safe`, `success`)
  }

  const forgetDevice = (event) =>
    execute(event, async () => {
      await forgetDeviceShare(address)
      disconnect()
      toast(`wallet removed from this device`, `success`)
    })

  return (
    <div className={styles.emailWallet}>
      <header className={styles.emailWallet__header}>
        <span className={styles.emailWallet__icon}>
          <KeyIcon size={22} />
        </span>
        <div>
          <h4 className={styles.emailWallet__title}>Email wallet</h4>
          <p className={styles.emailWallet__subtitle}>Recovery password, key export and device controls.</p>
        </div>
      </header>

      {!isEmailWallet && <p className={styles.emailWallet__hint}>Connect with your email wallet to manage it here.</p>}

      {isEmailWallet && (
        <>
          <p className={styles.emailWallet__hint}>
            Wallet: <code className={styles.emailWallet__code}>{address}</code>
          </p>

          <section className={styles.emailWallet__section}>
            <h5 className={styles.emailWallet__sectionTitle}>Change recovery password</h5>
            <form className={styles.emailWallet__form} onSubmit={changePassword}>
              <input
                className={styles.emailWallet__input}
                type="password"
                autoComplete="new-password"
                placeholder="New recovery password"
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <input
                className={styles.emailWallet__input}
                type="password"
                autoComplete="new-password"
                placeholder="Repeat it"
                minLength={MIN_PASSWORD_LENGTH}
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                required
              />
              <button className={styles.emailWallet__submit} type="submit" disabled={busy || !password || !passwordConfirm}>
                {busy ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </section>

          <section className={styles.emailWallet__section}>
            <h5 className={styles.emailWallet__sectionTitle}>Export / backup</h5>
            <p className={styles.emailWallet__hint}>
              Anyone with this key fully controls the wallet. Import it into MetaMask as your own backup — never paste it into a
              website or chat.
            </p>
            {!revealed ? (
              <button
                className={clsx(
                  styles.emailWallet__submit,
                  styles['emailWallet__submit--outline'],
                  styles.emailWallet__holdReveal,
                  holding && styles['emailWallet__holdReveal--holding'],
                )}
                type="button"
                onPointerDown={beginHold}
                onPointerUp={cancelHold}
                onPointerLeave={cancelHold}
                onPointerCancel={cancelHold}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) beginHold()
                }}
                onKeyUp={cancelHold}
                onContextMenu={(e) => e.preventDefault()}
              >
                <span className={styles.emailWallet__holdLabel}>
                  <EyeIcon size={16} weight="bold" />
                  {holding ? 'Keep holding…' : 'Hold to reveal key'}
                </span>
              </button>
            ) : (
              <div className={styles.emailWallet__keyRow}>
                <code className={styles.emailWallet__code}>{getEmbeddedPrivateKey()}</code>
                <button className={styles.emailWallet__iconBtn} type="button" onClick={copyKey} aria-label="Copy private key">
                  <CopyIcon size={16} />
                </button>
              </div>
            )}
          </section>

          <section className={styles.emailWallet__section}>
            <h5 className={styles.emailWallet__sectionTitle}>This device</h5>
            <p className={styles.emailWallet__hint}>
              Removes the saved key share and disconnects. You&rsquo;ll need your email code (and on a new device, the recovery
              password) to get back in.
            </p>
            <button className={clsx(styles.emailWallet__submit, styles['emailWallet__submit--outline'])} type="button" onClick={forgetDevice} disabled={busy}>
              Forget wallet on this device
            </button>
          </section>
        </>
      )}

      {error && <p className={styles.emailWallet__error}>{error}</p>}
    </div>
  )
}
