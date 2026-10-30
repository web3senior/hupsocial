'use client'

import { forwardRef, useId, useImperativeHandle, useRef, useState } from 'react'
import { PlusIcon, TrashIcon } from '@phosphor-icons/react'
import DialogSheet from '@/components/ui/DialogSheet'
import TextField from '@/components/ui/TextField'
import VaultNetworkPicker from './VaultNetworkPicker'
import VaultAttribution from './VaultAttribution'
import { Spinner } from '@/components/Loading'
import { VAULT_SIGNER_LIMITS } from '@/lib/personalVault'
import styles from './VaultDialog.module.scss'

const CreateVaultDialog = forwardRef(function CreateVaultDialog({ address, chain, chains = [], deployments = {}, deployment, busy, pending, error, onSubmit, onConnect, onNetworkChange }, ref) {
  const dialogRef = useRef(null)
  const formId = useId()
  const nextWalletId = useRef(VAULT_SIGNER_LIMITS.min)
  const [wallets, setWallets] = useState(() => Array.from({ length: VAULT_SIGNER_LIMITS.min }, (_, id) => ({ id, value: id === 0 ? null : '' })))
  const [threshold, setThreshold] = useState(String(VAULT_SIGNER_LIMITS.defaultThreshold))
  useImperativeHandle(ref, () => ({ open: () => dialogRef.current?.open(), close: () => dialogRef.current?.close() }), [])
  const close = () => { if (!busy) dialogRef.current?.close() }

  return (
    <DialogSheet ref={dialogRef} aria-label="Create vault" lightDismiss={!busy} swipeDismiss={!busy} onCancel={(event) => {
      event.stopPropagation()
      if (busy) event.preventDefault()
    }} onClose={(event) => event.stopPropagation()}>
      <DialogSheet.Header title="Create vault" description="Choose the wallets that control your funds." onClose={busy ? undefined : close} bordered />
      <DialogSheet.Body>
        <div className={styles.vaultDialog__content}>
          <div className={styles.vaultDialog__networkGroup}><strong>Choose your network</strong><VaultNetworkPicker chains={chains} deployments={deployments} value={chain?.id} onChange={onNetworkChange} disabled={busy} /></div>
          <form id={formId} onSubmit={onSubmit} className={styles.vaultDialog__form}>
            <input type="hidden" name="chainId" value={chain?.id ?? ''} />
            <fieldset className={styles.vaultDialog__wallets} disabled={busy}>
              <legend>Signing wallets</legend>
              <p className={styles.vaultDialog__note}>Add {VAULT_SIGNER_LIMITS.min}–{VAULT_SIGNER_LIMITS.max} different wallet addresses. Include your connected wallet.</p>
              {wallets.map((wallet, index) => <TextField key={wallet.id} name="owners" label={`Wallet ${index + 1}`} aria-label={`Wallet ${index + 1}`} value={wallet.value ?? address ?? ''} onChange={(event) => setWallets((current) => current.map((entry) => entry.id === wallet.id ? { ...entry, value: event.target.value } : entry))} placeholder="0x…" pattern="0x[a-fA-F0-9]{40}" required disabled={busy} spellCheck={false} autoCapitalize="off" autoCorrect="off" trailing={<button type="button" className={styles.vaultDialog__remove} aria-label={`Remove wallet ${index + 1}`} title="Remove wallet" disabled={busy || wallets.length <= VAULT_SIGNER_LIMITS.min} onClick={() => {
                setWallets((current) => current.filter((entry) => entry.id !== wallet.id))
                setThreshold((current) => Number(current) > wallets.length - 1 ? String(wallets.length - 1) : current)
              }}><TrashIcon size={18} /></button>} />)}
              <button type="button" className={styles.vaultDialog__add} disabled={busy || wallets.length >= VAULT_SIGNER_LIMITS.max} onClick={() => {
                const id = nextWalletId.current++
                setWallets((current) => [...current, { id, value: '' }])
              }}><PlusIcon size={17} /> Add wallet</button>
            </fieldset>
            <TextField name="threshold" label="Approvals required" hint={`Choose how many of your ${wallets.length} signing wallets must approve each transaction.`} type="number" min={VAULT_SIGNER_LIMITS.min} max={wallets.length} step="1" value={threshold} onChange={(event) => setThreshold(event.target.value)} required disabled={busy} />
          </form>
          {error && <p className={styles.vaultDialog__error} role="alert">{error}</p>}
          {busy && <p className={styles.vaultDialog__status} role="status"><Spinner size={18} />{pending || 'Preparing your vault…'}</p>}
        </div>
      </DialogSheet.Body>
      <DialogSheet.Footer>
        <p className={styles.vaultDialog__note}>Use wallets with independent keys and keep enough signers available to meet your approval threshold. Hup cannot recover lost keys. Creating a vault and approving transactions require network gas.</p>
        <VaultAttribution />
        <div className={styles.vaultDialog__actions}>
          <button type="button" className={styles.vaultDialog__cancel} onClick={close} disabled={busy}>Cancel</button>
          {address ? <button type="submit" form={formId} className={styles.vaultDialog__submit} disabled={busy || !deployment}>{busy ? 'Creating…' : 'Create vault'}</button> : <button type="button" className={styles.vaultDialog__submit} onClick={onConnect} disabled={busy}>Connect wallet</button>}
        </div>
      </DialogSheet.Footer>
    </DialogSheet>
  )
})

export default CreateVaultDialog
