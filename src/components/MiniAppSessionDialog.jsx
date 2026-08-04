'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { LightningIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import styles from './MiniAppSessionDialog.module.scss'

/**
 * One-time consent surface for hup_sessionCall — shown the first time a mini app asks to play
 * through the viewer's burner session key. After consent, calls to the allowlisted contract sign
 * silently; that is exactly what the viewer is agreeing to here, so this dialog spells out the
 * scope (one contract, gas only, no funds) rather than the app's own pitch. The frame is
 * untrusted: nothing it supplies beyond its registered name is rendered.
 */
const MiniAppSessionDialog = forwardRef(function MiniAppSessionDialog(props, ref) {
  const dialogRef = useRef(null)
  const [request, setRequest] = useState(null)
  const resolverRef = useRef(null)

  useImperativeHandle(ref, () => ({
    /** Presents the consent request; resolves on allow, rejects with code 4001 on decline. */
    confirm: (pendingRequest) =>
      new Promise((resolve, reject) => {
        resolverRef.current = { resolve, reject }
        setRequest(pendingRequest)
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

  const decline = () => {
    settle((resolver) => {
      const err = new Error('User declined gasless play')
      err.code = 4001
      resolver?.reject(err)
    })
  }

  const allow = () => {
    settle((resolver) => resolver?.resolve(true))
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.sessionDialog}
      aria-label="Enable gasless play"
      onClick={(e) => e.stopPropagation()}
      onCancel={(e) => {
        // Esc is a decline, not a dismissal — the caller is awaiting an answer either way
        e.preventDefault()
        decline()
      }}
      onClose={(e) => e.stopPropagation()}
    >
      <div className={styles.sessionDialog__body}>
        <header className={styles.sessionDialog__header}>
          <h3>
            <LightningIcon size={18} weight="fill" /> Enable gasless play?
          </h3>
          <button type="button" onClick={decline} aria-label="Decline" className={styles.sessionDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        <p className={styles.sessionDialog__source}>
          <strong>{request?.app?.name || 'This mini app'}</strong> wants to act through your in-app session key so you can play without
          confirming every move.
        </p>

        <ul className={styles.sessionDialog__facts}>
          <li>
            Only this contract can be called: <code>{request?.to}</code>
          </li>
          <li>It can never move funds — session calls carry zero value, they only spend gas.</li>
          <li>Your main wallet is never touched; signing uses the session key from Settings → In App Wallet.</li>
          <li>Revoke anytime by revoking the session in Settings.</li>
        </ul>

        <div className={styles.sessionDialog__actions}>
          <button type="button" onClick={decline} className={styles.sessionDialog__decline}>
            Not now
          </button>
          <button type="button" onClick={allow} className={styles.sessionDialog__allow}>
            Allow gasless play
          </button>
        </div>
      </div>
    </NativeDialog>
  )
})

export default MiniAppSessionDialog
