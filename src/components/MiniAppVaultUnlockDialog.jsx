'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { KeyIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import styles from './MiniAppVaultUnlockDialog.module.scss'

/**
 * In-place Security Vault unlock for gasless play. Silent session signing refuses to ask for
 * the PIN on a third-party frame's behalf, so when the vault is locked the host shows THIS —
 * Hup's own UI, the one place the PIN is legitimately asked outside Settings. One PIN + one
 * wallet signature, then the tab stays unlocked and session calls sign silently.
 *
 * The `execute(pin)` callback (unlock master + decrypt burner key) is supplied by the caller;
 * a WRONG_PIN failure keeps the dialog open for another attempt instead of failing the call.
 */
const MiniAppVaultUnlockDialog = forwardRef(function MiniAppVaultUnlockDialog(props, ref) {
  const dialogRef = useRef(null)
  const [request, setRequest] = useState(null)
  const [pin, setPin] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const resolverRef = useRef(null)

  useImperativeHandle(ref, () => ({
    /** Presents the unlock; resolves once the vault opens, rejects with code 4001 on cancel. */
    unlock: (pendingRequest) =>
      new Promise((resolve, reject) => {
        resolverRef.current = { resolve, reject }
        setRequest(pendingRequest)
        setPin('')
        setErrorMsg('')
        setIsBusy(false)
        dialogRef.current?.open()
      }),
    close: () => dialogRef.current?.close(),
  }))

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
    if (!request || pin.length < 6) {
      setErrorMsg('PIN is at least 6 characters.')
      return
    }

    setIsBusy(true)
    setErrorMsg('')
    try {
      await request.execute(pin)
      settle((resolver) => resolver?.resolve(true))
    } catch (err) {
      setIsBusy(false)
      if (err?.code === 'WRONG_PIN') {
        setPin('')
        setErrorMsg(err.message)
        return // stay open for another attempt
      }
      settle((resolver) => resolver?.reject(err))
    }
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.vaultDialog}
      aria-label="Unlock Security Vault"
      onClick={(e) => e.stopPropagation()}
      onCancel={(e) => {
        // Esc is a cancel, not a dismissal — the caller is awaiting an answer either way
        e.preventDefault()
        if (!isBusy) cancel()
      }}
      onClose={(e) => e.stopPropagation()}
    >
      <form className={styles.vaultDialog__body} onSubmit={submit}>
        <header className={styles.vaultDialog__header}>
          <h3>
            <KeyIcon size={18} /> Unlock to play
          </h3>
          <button type="button" onClick={cancel} disabled={isBusy} aria-label="Cancel" className={styles.vaultDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        <p className={styles.vaultDialog__source}>
          <strong>{request?.app?.name || 'This mini app'}</strong> plays through your in-app session key, which is protected by your
          Security Vault. Enter your vault PIN — you&rsquo;ll also confirm one signature in your wallet. This tab then stays unlocked.
        </p>

        <input
          className={styles.vaultDialog__pin}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Security Vault PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          disabled={isBusy}
          autoFocus
        />

        {errorMsg && <p className={styles.vaultDialog__error}>{errorMsg}</p>}

        <div className={styles.vaultDialog__actions}>
          <button type="button" onClick={cancel} disabled={isBusy} className={styles.vaultDialog__cancel}>
            Cancel
          </button>
          <button type="submit" disabled={isBusy || pin.length < 6} className={styles.vaultDialog__unlock}>
            {isBusy ? 'Check your wallet…' : 'Unlock'}
          </button>
        </div>
      </form>
    </NativeDialog>
  )
})

export default MiniAppVaultUnlockDialog
