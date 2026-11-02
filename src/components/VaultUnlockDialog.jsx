'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnection, useSignMessage, useSignTypedData } from 'wagmi'
import { KeyIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from '@/components/ui/NativeDialog'
import { getBurnerVersion, unlockBurnerFromCachedMasters } from '@/lib/burnerSession'
import { clearMasterSecret, unlockMaster } from '@/lib/securityVault'
import { generatePassphrase, hasDeviceCheck, rejectMasterV2, unlockMasterV2 } from '@/lib/keyVaultV2'
import { PASSPHRASE_MIN_LENGTH, passphraseProblem } from '@/lib/keyDerivationV2.mjs'
import { setVaultUnlockHandler } from '@/lib/vaultUnlockBus'
import styles from './VaultUnlockDialog.module.scss'

const PIN_MIN_LENGTH_V1 = 6

/**
 * The app-wide vault unlock, mounted once in the shell and reached through the same
 * promise-shaped handler bus the embedded wallet's tx confirm uses. Anything that needs the
 * session key — batch like, a sponsored write, a gasless mint — or a Key Vault v2 key — an agent
 * wallet — awaits this when its vault is closed, instead of dead-ending on a key it cannot open.
 *
 * Two modes, picked per request:
 *   v2  Key Vault v2: a passphrase plus the fixed key signature, nothing stored by Hup. Asked for
 *       when the caller says so, or when the session key is v2. A device that has not seen this
 *       wallet's passphrase asks for it twice, and screens a new one for strength.
 *   v1  the original vault: the PIN plus one signature, for session keys not yet upgraded.
 * A wrong PIN or passphrase keeps the dialog open for another try; the bad master is dropped
 * first, or every later vault feature in this tab would quietly use it.
 */
export default function VaultUnlockDialog() {
  const dialogRef = useRef(null)
  const resolverRef = useRef(null)
  const { address } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const { signTypedDataAsync } = useSignTypedData()

  const [request, setRequest] = useState(null)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [isFirstOnDevice, setIsFirstOnDevice] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [shownPassphrase, setShownPassphrase] = useState('')
  const [hasSavedPassphrase, setHasSavedPassphrase] = useState(false)

  const isV2 = request?.version === 'v2'
  const minLength = isV2 ? PASSPHRASE_MIN_LENGTH : PIN_MIN_LENGTH_V1
  const needsConfirm = isV2 && isFirstOnDevice
  const noun = isV2 ? 'passphrase' : 'PIN'

  useEffect(
    () =>
      setVaultUnlockHandler(
        (context) =>
          new Promise((resolve, reject) => {
            resolverRef.current = { resolve, reject }
            // An explicit version wins; otherwise the session key's own vault decides
            const version = context?.version ?? getBurnerVersion()
            setRequest({ ...(context ?? {}), version })
            setPin('')
            setConfirmPin('')
            // First use on this device asks twice: a typo would silently open different keys
            setIsFirstOnDevice(version === 'v2' && !hasDeviceCheck(address))
            setErrorMsg('')
            setShownPassphrase('')
            setHasSavedPassphrase(false)
            setIsBusy(false)
            dialogRef.current?.open()
          }),
      ),
    [address],
  )

  const settle = (fn) => {
    const resolver = resolverRef.current
    resolverRef.current = null
    setRequest(null)
    dialogRef.current?.close()
    fn?.(resolver)
  }

  const cancel = () => {
    settle((resolver) => {
      const err = new Error('Vault unlock cancelled')
      err.code = 4001
      resolver?.reject(err)
    })
  }

  // Opens the session key with whatever is now unlocked. A device with no session key still has
  // an unlocked vault, and vault consumers that want no burner at all (agents, gated-content keys)
  // must not be turned away by its absence; callers that need the burner fail later, by name.
  const openSessionKey = async () => {
    try {
      await unlockBurnerFromCachedMasters()
    } catch (unlockErr) {
      if (['NO_SESSION_KEY', 'VAULT_LOCKED'].includes(unlockErr?.code)) return
      if (unlockErr?.code === 'WRONG_PIN') {
        if (getBurnerVersion() === 'v2') rejectMasterV2()
        else clearMasterSecret()
      }
      throw unlockErr
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    if (pin.length < minLength) {
      setErrorMsg(`Your ${noun} is at least ${minLength} characters.`)
      return
    }
    if (needsConfirm && pin !== confirmPin) {
      setErrorMsg(`The ${noun}s do not match.`)
      return
    }
    if (!address) {
      setErrorMsg('Connect your wallet first.')
      return
    }

    setIsBusy(true)
    setErrorMsg('')
    try {
      if (isV2) await unlockMasterV2({ address, passphrase: pin, signTypedDataAsync, signMessageAsync })
      else await unlockMaster(address, pin, signMessageAsync)
      await openSessionKey()
      settle((resolver) => resolver?.resolve(true))
    } catch (err) {
      setIsBusy(false)
      if (err?.code === 'WRONG_PIN' || err?.code === 'WRONG_PASSPHRASE') {
        setPin('')
        setConfirmPin('')
        // A session key that disagrees with a brand-new device check means the same typo twice
        setIsFirstOnDevice(isV2 && !hasDeviceCheck(address))
        setErrorMsg(`That ${noun} does not open your vault.`)
        return // stay open for another attempt
      }
      if (err?.code === 'NONDETERMINISTIC_SIGNER' || err?.code === 'PASSPHRASE_TOO_SHORT') {
        setErrorMsg(err.message)
        return
      }
      // A rejected signature is the user backing out, not a failure worth reporting upstream
      // any differently than the Cancel button
      if (err?.code === 4001 || err?.name === 'UserRejectedRequestError') {
        cancel()
        return
      }
      settle((resolver) => resolver?.reject(err))
    }
  }

  // Only a new passphrase is screened: one already in use must keep opening its keys
  const weakness = needsConfirm && pin.length > 0 ? passphraseProblem(pin) : null
  // A first setup also waits for the owner to say the passphrase is saved: nothing can recover it
  const ready = pin.length >= minLength && !weakness && (!needsConfirm || (confirmPin.length >= minLength && hasSavedPassphrase))

  const suggest = () => {
    const generated = generatePassphrase()
    setPin(generated)
    setConfirmPin('')
    setShownPassphrase(generated)
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.vaultUnlock}
      aria-label={isV2 ? 'Unlock Key Vault' : 'Unlock original vault'}
      onClick={(e) => e.stopPropagation()}
      onCancel={(e) => {
        // Esc is a cancel, not a dismissal — the caller is awaiting an answer either way
        e.preventDefault()
        if (!isBusy) cancel()
      }}
      onClose={(e) => e.stopPropagation()}
    >
      <form className={styles.vaultUnlock__body} onSubmit={submit}>
        <header className={styles.vaultUnlock__header}>
          <h3>
            <KeyIcon size={18} /> {isV2 ? (needsConfirm ? 'Set up your Key Vault' : 'Unlock your Key Vault') : 'Unlock your original vault'}
          </h3>
          <button type="button" onClick={cancel} disabled={isBusy} aria-label="Cancel" className={styles.vaultUnlock__close}>
            <XIcon size={18} />
          </button>
        </header>

        {isV2 ? (
          <p className={styles.vaultUnlock__reason}>
            {request?.reason ? <strong>{request.reason}</strong> : <strong>This action</strong>} needs your Key Vault.{' '}
            {needsConfirm
              ? 'First time on this device: enter your passphrase twice, or generate one. Your wallet asks for the same signature twice.'
              : 'Enter your passphrase, then confirm one signature in your wallet.'}{' '}
            Your wallet and passphrase are the whole key. Hup stores neither, so nobody can reset a lost passphrase.
          </p>
        ) : (
          <p className={styles.vaultUnlock__reason}>
            {request?.reason ? <strong>{request.reason}</strong> : <strong>This action</strong>} runs on your in-app session key, which
            your original vault protects. Enter your vault PIN — you&rsquo;ll also confirm one signature in your wallet. This tab then
            stays unlocked.
          </p>
        )}

        <input
          className={styles.vaultUnlock__pin}
          type="password"
          autoComplete="off"
          placeholder={isV2 ? 'Key Vault passphrase' : 'Original vault PIN'}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value)
            setShownPassphrase('')
          }}
          disabled={isBusy}
          autoFocus
        />
        {needsConfirm && (
          <input
            className={styles.vaultUnlock__pin}
            type="password"
            autoComplete="off"
            placeholder={isV2 ? 'Confirm passphrase' : 'Confirm PIN'}
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            disabled={isBusy}
          />
        )}

        {needsConfirm && (
          <button type="button" onClick={suggest} disabled={isBusy} className={styles.vaultUnlock__generate}>
            Generate a passphrase
          </button>
        )}
        {shownPassphrase && (
          <p className={styles.vaultUnlock__generated}>
            <code>{shownPassphrase}</code> Write it down somewhere safe, then type it again to confirm.
          </p>
        )}
        {weakness && <p className={styles.vaultUnlock__hint}>{weakness}</p>}

        {needsConfirm && (
          <div className={styles.vaultUnlock__warning} role="note">
            <WarningIcon size={18} weight="fill" aria-hidden="true" />
            <div>
              <strong>We can&rsquo;t recover a lost passphrase.</strong> Hup never stores it, so nobody can reset it. Lose it and your
              agents, their wallets and anything they hold are gone for good.
              <label className={styles.vaultUnlock__ack}>
                <input type="checkbox" checked={hasSavedPassphrase} onChange={(e) => setHasSavedPassphrase(e.target.checked)} disabled={isBusy} />
                I&rsquo;ve written my passphrase down somewhere safe
              </label>
            </div>
          </div>
        )}

        {errorMsg && <p className={styles.vaultUnlock__error}>{errorMsg}</p>}

        <div className={styles.vaultUnlock__actions}>
          <button type="button" onClick={cancel} disabled={isBusy} className={styles.vaultUnlock__cancel}>
            Cancel
          </button>
          <button type="submit" disabled={isBusy || !ready} className={styles.vaultUnlock__unlock}>
            {isBusy ? 'Check your wallet…' : needsConfirm ? 'Set up' : 'Unlock'}
          </button>
        </div>
      </form>
    </NativeDialog>
  )
}
