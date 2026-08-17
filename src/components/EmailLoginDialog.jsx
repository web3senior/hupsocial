'use client'

import { useEffect, useRef, useState } from 'react'
import { EnvelopeSimpleIcon, XIcon } from '@phosphor-icons/react'
import { useConnect, useConnectors } from 'wagmi'
import { privateKeyToAccount } from 'viem/accounts'
import clsx from 'clsx'
import { toast } from '@/components/NextToast'
import NativeDialog from '@/components/ui/NativeDialog'
import {
  activateEmbeddedAccount,
  deactivateEmbeddedAccount,
  EMAIL_CONNECTOR_ID,
  getEmbeddedAddress,
  restoreEmbeddedAccount,
  setEmailLoginHandler,
} from '@/lib/embeddedWallet/connector'
import {
  createWalletKey,
  decryptBackup,
  encryptBackup,
  forgetAllDeviceShares,
  forgetDeviceShare,
  importWalletKey,
  listDeviceShares,
  saveDeviceShare,
  serializeKdfParams,
  splitKey,
} from '@/lib/embeddedWallet/crypto'
import styles from './EmailLoginDialog.module.scss'

const MIN_PASSWORD_LENGTH = 8

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

const postJson = async (url, body, method = 'POST') => {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.success === false) throw new Error(data.error || 'Something went wrong')
  return data
}

/**
 * The email login flow: email → code → (new account) set a recovery password,
 * or (returning) silent share-join, falling back to the recovery password on a
 * fresh browser. Mounted once in ClientLayout and opened through the connector
 * module's bus, so the wallet list can trigger it from either of its surfaces.
 */
export default function EmailLoginDialog() {
  const dialogRef = useRef(null)
  const connectors = useConnectors()
  const { mutateAsync: connect } = useConnect()

  // 'silent' | 'choose' | 'email' | 'code' | 'create' | 'import' | 'unlock' | 'reset'
  const [step, setStep] = useState('email')
  const [resetPhrase, setResetPhrase] = useState('')
  const [importSecret, setImportSecret] = useState('')
  const [savedAccounts, setSavedAccounts] = useState([])
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [canForget, setCanForget] = useState(false)

  const connector = connectors.find((c) => c.id === EMAIL_CONNECTOR_ID)

  const finishConnect = async (accountEmail) => {
    await connect({ connector })

    // One email maps to one live wallet server-side, so any other record under
    // this email is a dead entry (a crash-orphaned or reset-abandoned wallet)
    // that would clutter the chooser forever — sweep them now.
    const connected = getEmbeddedAddress()
    if (accountEmail && connected) {
      for (const record of await listDeviceShares()) {
        if (record.email?.toLowerCase() === accountEmail.toLowerCase() && record.address.toLowerCase() !== connected.toLowerCase()) {
          await forgetDeviceShare(record.address)
        }
      }
    }

    dialogRef.current?.close()
    toast(`wallet successfuly connected`, `success`)
  }

  const openFlow = async () => {
    setEmail('')
    setCode('')
    setPassword('')
    setPasswordConfirm('')
    setResetPhrase('')
    setImportSecret('')
    setError(null)
    setBusy(false)
    setCanForget(false)

    // Saved accounts get a chooser, never an auto-connect: tapping "Email"
    // must leave room to pick a different account than last time
    setStep('silent')
    dialogRef.current?.open()
    const saved = await listDeviceShares()
    setSavedAccounts(saved)
    setCanForget(saved.length > 0)
    setStep(saved.length > 0 ? 'choose' : 'email')
  }

  // No dependency array on purpose: re-registering every render keeps the
  // handler's closures fresh, and satisfies react-hooks/refs (the flow reads
  // refs, so it must never be created by a call made during render).
  useEffect(() => setEmailLoginHandler(openFlow))

  // Invoked from event handlers only, never during render
  const execute = async (event, work) => {
    event?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(err.shortMessage || err.message)
    } finally {
      setBusy(false)
    }
  }

  const submitEmail = (event) =>
    execute(event, async () => {
      await postJson('/api/v1/auth/email/request-otp', { email })
      setStep('code')
    })

  const continueAs = (record) =>
    execute(null, async () => {
      setEmail(record.email)
      try {
        const address = await restoreEmbeddedAccount()
        // The live session may belong to a different saved account than the
        // one tapped — never silently connect the wrong wallet
        if (address.toLowerCase() !== record.address.toLowerCase()) {
          deactivateEmbeddedAccount()
          throw new Error('session belongs to another account')
        }
        await finishConnect(record.email)
      } catch {
        // No/expired/other-account session: one OTP round re-establishes it,
        // then the stored device share unlocks without the recovery password
        await postJson('/api/v1/auth/email/request-otp', { email: record.email })
        setStep('code')
      }
    })

  const submitCode = (event) =>
    execute(event, async () => {
      const { account } = await postJson('/api/v1/auth/email/verify-otp', { email, code })

      if (!account.hasKeystore) {
        setStep('create')
        return
      }

      // Returning user: the device share may already pair with the fresh session
      try {
        await restoreEmbeddedAccount()
        await finishConnect(email)
      } catch {
        setStep('unlock')
      }
    })

  // Shared by create and import: split, back up under the recovery password,
  // store, and connect — the only difference is where the key came from.
  const provisionWallet = async ({ privateKey, address }) => {
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Recovery password needs at least ${MIN_PASSWORD_LENGTH} characters`)
    if (password !== passwordConfirm) throw new Error('Passwords do not match')

    const { deviceShare, serverShare } = splitKey(privateKey)
    const backupBlob = await encryptBackup(privateKey, password)

    await postJson('/api/v1/auth/email/keystore', { walletAddress: address, serverShare, backupBlob, kdfParams: serializeKdfParams() }, 'PUT')
    await saveDeviceShare({ email, address, share: deviceShare })
    activateEmbeddedAccount(privateKey)
    await finishConnect(email)
  }

  const submitCreate = (event) => execute(event, () => provisionWallet(createWalletKey()))

  const submitImport = (event) =>
    execute(event, async () => {
      await provisionWallet(importWalletKey(importSecret))
      setImportSecret('')
    })

  const submitUnlock = (event) =>
    execute(event, async () => {
      const { keystore } = await fetch('/api/v1/auth/email/keystore').then((r) => {
        if (!r.ok) throw new Error('Session expired — start over')
        return r.json()
      })

      let privateKey
      try {
        privateKey = await decryptBackup(keystore.backupBlob, keystore.kdfParams, password)
      } catch {
        throw new Error('Wrong recovery password')
      }

      const address = privateKeyToAccount(privateKey).address
      if (address.toLowerCase() !== keystore.walletAddress.toLowerCase()) throw new Error('Recovered key does not match this account')

      // Recovery rotates the split: fresh pad for this device, stale shares die
      const { deviceShare, serverShare } = splitKey(privateKey)
      await postJson('/api/v1/auth/email/keystore', { walletAddress: address, serverShare, backupBlob: keystore.backupBlob, kdfParams: keystore.kdfParams }, 'PUT')
      await saveDeviceShare({ email, address, share: deviceShare })
      activateEmbeddedAccount(privateKey)
      await finishConnect(email)
    })

  const submitReset = (event) =>
    execute(event, async () => {
      if (resetPhrase !== 'RESET') throw new Error('Type RESET to confirm')

      const response = await fetch('/api/v1/auth/email/keystore', { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.success === false) throw new Error(data.error || 'Failed to reset the wallet')

      // Only this account's share pairs with the abandoned wallet — other
      // saved accounts on this browser keep theirs
      for (const record of await listDeviceShares()) {
        if (record.email === email) await forgetDeviceShare(record.address)
      }
      setPassword('')
      setPasswordConfirm('')
      setStep('create')
    })

  const forgetDevice = (event) =>
    execute(event, async () => {
      await forgetAllDeviceShares()
      setSavedAccounts([])
      setCanForget(false)
      setStep('email')
      toast(`saved wallets removed from this device`, `success`)
    })

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.emailDialog}
      aria-label="Log in with email"
      onClick={(e) => e.stopPropagation()}
      onCancel={(e) => e.stopPropagation()}
      onClose={(e) => e.stopPropagation()}
    >
      <div className={styles.emailDialog__body}>
        <header className={styles.emailDialog__header}>
          <h3>
            <EnvelopeSimpleIcon size={18} weight="fill" /> Log in with email
          </h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.emailDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        {step === 'silent' && <p className={styles.emailDialog__hint}>Loading…</p>}

        {step === 'choose' && (
          <div className={styles.emailDialog__form}>
            <p className={styles.emailDialog__hint}>Pick an account saved on this device, or sign in with another email.</p>
            {savedAccounts.map((record) => (
              <button
                key={record.address}
                type="button"
                className={styles.emailDialog__account}
                onClick={() => continueAs(record)}
                disabled={busy}
              >
                <span className={styles.emailDialog__accountEmail}>{record.email}</span>
                <span className={styles.emailDialog__accountAddress}>{shortAddress(record.address)}</span>
              </button>
            ))}
            <button className={styles.emailDialog__submit} type="button" onClick={() => setStep('email')} disabled={busy}>
              Use another email
            </button>
            <button className={styles.emailDialog__link} type="button" onClick={forgetDevice} disabled={busy}>
              Forget saved wallets on this device
            </button>
          </div>
        )}

        {step === 'email' && (
          <form className={styles.emailDialog__form} onSubmit={submitEmail}>
            <p className={styles.emailDialog__hint}>
              We&rsquo;ll email you a 6-digit code. New here? A wallet is created for you — no extension, no seed phrase.
            </p>
            <label className={styles.emailDialog__label} htmlFor="email-login-address">
              Email
            </label>
            <input
              id="email-login-address"
              className={styles.emailDialog__input}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <button className={styles.emailDialog__submit} type="submit" disabled={busy || !email}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
            {canForget && (
              <button className={styles.emailDialog__link} type="button" onClick={() => setStep('choose')} disabled={busy}>
                Back to saved accounts
              </button>
            )}
          </form>
        )}

        {step === 'code' && (
          <form className={styles.emailDialog__form} onSubmit={submitCode}>
            <p className={styles.emailDialog__hint}>
              Enter the code sent to <strong>{email}</strong>
            </p>
            <label className={styles.emailDialog__label} htmlFor="email-login-code">
              Code
            </label>
            <input
              id="email-login-code"
              className={clsx(styles.emailDialog__input, styles['emailDialog__input--code'])}
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
            />
            <button className={styles.emailDialog__submit} type="submit" disabled={busy || code.length !== 6}>
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            <button className={styles.emailDialog__link} type="button" onClick={submitEmail} disabled={busy}>
              Resend code
            </button>
          </form>
        )}

        {step === 'create' && (
          <form className={styles.emailDialog__form} onSubmit={submitCreate}>
            <p className={styles.emailDialog__hint}>
              Set a <strong>recovery password</strong>. It encrypts your new wallet&rsquo;s key in your browser before anything is
              stored — we can never read it, so if you lose both this password and this device, the wallet is unrecoverable.
            </p>
            <label className={styles.emailDialog__label} htmlFor="email-login-password">
              Recovery password
            </label>
            <input
              id="email-login-password"
              className={styles.emailDialog__input}
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
            <label className={styles.emailDialog__label} htmlFor="email-login-password-confirm">
              Repeat it
            </label>
            <input
              id="email-login-password-confirm"
              className={styles.emailDialog__input}
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              required
            />
            <button className={styles.emailDialog__submit} type="submit" disabled={busy || !password || !passwordConfirm}>
              {busy ? 'Creating wallet…' : 'Create wallet'}
            </button>
            <button className={styles.emailDialog__link} type="button" onClick={() => setStep('import')} disabled={busy}>
              I already have a wallet — import it
            </button>
          </form>
        )}

        {step === 'import' && (
          <form className={styles.emailDialog__form} onSubmit={submitImport}>
            <p className={styles.emailDialog__hint}>
              Paste a <strong>private key</strong> or a <strong>12–24 word seed phrase</strong>. It is encrypted in your browser
              with the recovery password below — it never reaches our servers readable, and the wallet keeps working in MetaMask
              or wherever it lives today.
            </p>
            <label className={styles.emailDialog__label} htmlFor="email-login-import-secret">
              Private key or seed phrase
            </label>
            <textarea
              id="email-login-import-secret"
              className={styles.emailDialog__textarea}
              rows={3}
              autoComplete="off"
              spellCheck={false}
              value={importSecret}
              onChange={(e) => setImportSecret(e.target.value)}
              required
              autoFocus
            />
            <label className={styles.emailDialog__label} htmlFor="email-login-import-password">
              Recovery password
            </label>
            <input
              id="email-login-import-password"
              className={styles.emailDialog__input}
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <label className={styles.emailDialog__label} htmlFor="email-login-import-password-confirm">
              Repeat it
            </label>
            <input
              id="email-login-import-password-confirm"
              className={styles.emailDialog__input}
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              required
            />
            <button className={styles.emailDialog__submit} type="submit" disabled={busy || !importSecret || !password || !passwordConfirm}>
              {busy ? 'Importing…' : 'Import wallet'}
            </button>
            <button className={styles.emailDialog__link} type="button" onClick={() => setStep('create')} disabled={busy}>
              Back — create a new wallet instead
            </button>
          </form>
        )}

        {step === 'unlock' && (
          <form className={styles.emailDialog__form} onSubmit={submitUnlock}>
            <p className={styles.emailDialog__hint}>
              New device detected. Enter your <strong>recovery password</strong> to unlock your wallet here.
            </p>
            <label className={styles.emailDialog__label} htmlFor="email-login-unlock">
              Recovery password
            </label>
            <input
              id="email-login-unlock"
              className={styles.emailDialog__input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
            <button className={styles.emailDialog__submit} type="submit" disabled={busy || !password}>
              {busy ? 'Unlocking…' : 'Unlock wallet'}
            </button>
            <button className={styles.emailDialog__link} type="button" onClick={() => setStep('reset')} disabled={busy}>
              Forgot your recovery password?
            </button>
          </form>
        )}

        {step === 'reset' && (
          <form className={styles.emailDialog__form} onSubmit={submitReset}>
            <p className={clsx(styles.emailDialog__hint, styles['emailDialog__hint--danger'])}>
              Without the recovery password this wallet <strong>cannot be restored — by anyone</strong>. Resetting abandons the
              old wallet address and everything it holds, permanently, and creates a brand new one for this email.
            </p>
            <label className={styles.emailDialog__label} htmlFor="email-login-reset">
              Type <strong>RESET</strong> to confirm
            </label>
            <input
              id="email-login-reset"
              className={styles.emailDialog__input}
              type="text"
              autoComplete="off"
              placeholder="RESET"
              value={resetPhrase}
              onChange={(e) => setResetPhrase(e.target.value)}
              required
              autoFocus
            />
            <button
              className={clsx(styles.emailDialog__submit, styles['emailDialog__submit--danger'])}
              type="submit"
              disabled={busy || resetPhrase !== 'RESET'}
            >
              {busy ? 'Resetting…' : 'Abandon old wallet and start over'}
            </button>
            <button className={styles.emailDialog__link} type="button" onClick={() => setStep('unlock')} disabled={busy}>
              Back — try the password again
            </button>
          </form>
        )}

        {error && <p className={styles.emailDialog__error}>{error}</p>}
      </div>
    </NativeDialog>
  )
}
