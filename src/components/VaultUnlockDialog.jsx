'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnection, useSignMessage } from 'wagmi'
import { KeyIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from '@/components/ui/NativeDialog'
import { unlockBurnerWithMaster } from '@/lib/burnerSession'
import { clearMasterSecret, unlockMaster } from '@/lib/securityVault'
import { setVaultUnlockHandler } from '@/lib/vaultUnlockBus'
import styles from './VaultUnlockDialog.module.scss'

/**
 * The app-wide Security Vault unlock, mounted once in the shell and reached through the same
 * promise-shaped handler bus the embedded wallet's tx confirm uses. Anything that needs the
 * session key — batch like, a sponsored write, a gasless mint — awaits this when the vault is
 * closed, instead of dead-ending on a key it cannot decrypt.
 *
 * One PIN plus one wallet signature reproduces the vault master, which decrypts the session key
 * for the rest of the tab. A wrong PIN keeps the dialog open for another try; the bad master is
 * dropped first, or every later vault feature in this tab would quietly use it.
 */
export default function VaultUnlockDialog() {
  const dialogRef = useRef(null)
  const resolverRef = useRef(null)
  const { address } = useConnection()
  const { signMessageAsync } = useSignMessage()

  const [request, setRequest] = useState(null)
  const [pin, setPin] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(
    () =>
      setVaultUnlockHandler(
        (context) =>
          new Promise((resolve, reject) => {
            resolverRef.current = { resolve, reject }
            setRequest(context ?? {})
            setPin('')
            setErrorMsg('')
            setIsBusy(false)
            dialogRef.current?.open()
          }),
      ),
    [],
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

  const submit = async (event) => {
    event.preventDefault()
    if (pin.length < 6) {
      setErrorMsg('PIN is at least 6 characters.')
      return
    }
    if (!address) {
      setErrorMsg('Connect your wallet first.')
      return
    }

    setIsBusy(true)
    setErrorMsg('')
    try {
      const masterHex = await unlockMaster(address, pin, signMessageAsync)
      try {
        await unlockBurnerWithMaster(masterHex)
      } catch (unlockErr) {
        if (unlockErr?.code === 'WRONG_PIN') clearMasterSecret()
        throw unlockErr
      }
      settle((resolver) => resolver?.resolve(true))
    } catch (err) {
      setIsBusy(false)
      if (err?.code === 'WRONG_PIN') {
        setPin('')
        setErrorMsg(err.message)
        return // stay open for another attempt
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

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.vaultUnlock}
      aria-label="Unlock Security Vault"
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
            <KeyIcon size={18} /> Unlock your Security Vault
          </h3>
          <button type="button" onClick={cancel} disabled={isBusy} aria-label="Cancel" className={styles.vaultUnlock__close}>
            <XIcon size={18} />
          </button>
        </header>

        <p className={styles.vaultUnlock__reason}>
          {request?.reason ? <strong>{request.reason}</strong> : <strong>This action</strong>} runs on your in-app session key, which
          your Security Vault protects. Enter your vault PIN — you&rsquo;ll also confirm one signature in your wallet. This tab then
          stays unlocked.
        </p>

        <input
          className={styles.vaultUnlock__pin}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Security Vault PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          disabled={isBusy}
          autoFocus
        />

        {errorMsg && <p className={styles.vaultUnlock__error}>{errorMsg}</p>}

        <div className={styles.vaultUnlock__actions}>
          <button type="button" onClick={cancel} disabled={isBusy} className={styles.vaultUnlock__cancel}>
            Cancel
          </button>
          <button type="submit" disabled={isBusy || pin.length < 6} className={styles.vaultUnlock__unlock}>
            {isBusy ? 'Check your wallet…' : 'Unlock'}
          </button>
        </div>
      </form>
    </NativeDialog>
  )
}
