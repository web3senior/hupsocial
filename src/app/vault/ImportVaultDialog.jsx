'use client'

import { forwardRef, useId, useImperativeHandle, useRef } from 'react'
import DialogSheet from '@/components/ui/DialogSheet'
import TextField from '@/components/ui/TextField'
import { Spinner } from '@/components/Loading'
import VaultNetworkPicker from './VaultNetworkPicker'
import VaultAttribution from './VaultAttribution'
import styles from './VaultDialog.module.scss'

const ImportVaultDialog = forwardRef(function ImportVaultDialog({ chainId, chains = [], deployments = {}, busy, error, onNetworkChange, onSubmit }, ref) {
  const dialogRef = useRef(null)
  const formId = useId()
  useImperativeHandle(ref, () => ({ open: () => dialogRef.current?.open(), close: () => dialogRef.current?.close() }), [])
  const close = () => { if (!busy) dialogRef.current?.close() }
  return (
    <DialogSheet ref={dialogRef} aria-label="Import vault" lightDismiss={!busy} swipeDismiss={!busy} onCancel={(event) => {
      event.stopPropagation()
      if (busy) event.preventDefault()
    }} onClose={(event) => event.stopPropagation()}>
      <DialogSheet.Header title="Import vault" description="Open an existing Safe vault using its public address." onClose={busy ? undefined : close} bordered />
      <DialogSheet.Body>
        <div className={styles.vaultDialog__content}>
          <div className={styles.vaultDialog__networkGroup}><strong>Choose your network</strong><VaultNetworkPicker chains={chains} deployments={deployments} value={chainId} onChange={onNetworkChange} disabled={busy} /></div>
          <form id={formId} onSubmit={onSubmit} className={styles.vaultDialog__form}>
            <input type="hidden" name="chainId" value={chainId ?? ''} />
            <TextField name="address" label="Vault address" placeholder="0x…" pattern="0x[a-fA-F0-9]{40}" required disabled={busy} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} hint="Choose the network where this vault is deployed." />
          </form>
          {error && <p className={styles.vaultDialog__error} role="alert">{error}</p>}
          {busy && <p className={styles.vaultDialog__status} role="status"><Spinner size={18} />Verifying and saving your vault…</p>}
        </div>
      </DialogSheet.Body>
      <DialogSheet.Footer>
        <p className={styles.vaultDialog__note}>Your vault’s signers and approval rules stay the same. Importing requires no onchain transaction.</p>
        <VaultAttribution />
        <div className={styles.vaultDialog__actions}><button type="button" className={styles.vaultDialog__cancel} onClick={close} disabled={busy}>Cancel</button><button type="submit" form={formId} className={styles.vaultDialog__submit} disabled={busy || !deployments[chainId]}>{busy ? 'Importing…' : 'Import vault'}</button></div>
      </DialogSheet.Footer>
    </DialogSheet>
  )
})

export default ImportVaultDialog
