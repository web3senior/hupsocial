'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDisconnect } from 'wagmi'
import { AtIcon } from '@phosphor-icons/react'
import NativeDialog from '@/components/ui/NativeDialog'
import UsernameField from '@/components/UsernameField'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { useProfile } from '@/hooks/useProfile'
import { isEvmAddress } from '@/lib/address'
import { isFramedByGridHost } from '@/lib/upProviderClient'
import { suggestUsername } from '@/lib/username'
import { readFirstConnect, clearFirstConnect } from '@/lib/firstConnect'
import styles from './UsernameGate.module.scss'

/* How long "Later" holds for an account that already existed before handles did. Long enough not
   to nag, short enough that the namespace fills. A wallet's first ever connect is not offered it. */
const SNOOZE_MS = 24 * 60 * 60 * 1000
const snoozeKey = (address) => `hup:username-later:${address.toLowerCase()}`

const isSnoozed = (address) => {
  try {
    return Number(window.localStorage.getItem(snoozeKey(address)) || 0) > Date.now()
  } catch {
    /* Private windows and blocked storage both land here: ask again rather than never. */
    return false
  }
}

const snooze = (address) => {
  try {
    window.localStorage.setItem(snoozeKey(address), String(Date.now() + SNOOZE_MS))
  } catch {
    /* Nothing to remember it with — the modal simply opens again next time. */
  }
}

/**
 * Username Gate
 * The one place a wallet is asked for a handle. On a first connect it is part of arriving and the
 * dialog does not offer a way past it; for the accounts that predate handles it is an ask, with
 * Later remembered for a day.
 *
 * EVM only: the claim is proven by an EVM signature, so a Solana session has nothing to sign with.
 */
export default function UsernameGate() {
  const dialogRef = useRef(null)
  const { address, isConnected, kind } = useActiveWallet()
  const { disconnect } = useDisconnect()
  /* Never inside the grid: a mini app frame is somebody else's page, where the wallet connects on
     its own and a modal demanding something would be Hup interrupting a host it is a guest on. */
  const [isEmbedded, setIsEmbedded] = useState(false)
  useEffect(() => setIsEmbedded(isFramedByGridHost()), [])

  const canHoldHandle = isConnected && kind === 'evm' && isEvmAddress(address) && !isEmbedded
  const { profile, isLoading, mutate } = useProfile(canHoldHandle ? address : null)

  const [isOpen, setIsOpen] = useState(false)
  const [isRequired, setIsRequired] = useState(false)
  /* One wallet, one prompt per session — claiming or dismissing must not reopen on the next render. */
  const settledRef = useRef(null)

  useEffect(() => {
    if (!canHoldHandle || isLoading || !profile) return
    if (settledRef.current === address) return
    if (profile.username) {
      settledRef.current = address
      clearFirstConnect(address)
      return
    }

    const isNew = readFirstConnect(address)
    if (!isNew && isSnoozed(address)) {
      settledRef.current = address
      return
    }

    settledRef.current = address
    setIsRequired(isNew)
    setIsOpen(true)
  }, [canHoldHandle, address, isLoading, profile])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (isOpen) dialog.open()
    else dialog.close()
  }, [isOpen])

  /* A wallet that disconnects mid-prompt has nothing left to claim with. */
  useEffect(() => {
    if (!canHoldHandle) setIsOpen(false)
  }, [canHoldHandle])

  const handleClaimed = useCallback(() => {
    clearFirstConnect(address)
    setIsOpen(false)
    mutate?.()
  }, [address, mutate])

  const handleLater = useCallback(() => {
    if (address) snooze(address)
    setIsOpen(false)
  }, [address])

  const handleDisconnect = useCallback(() => {
    clearFirstConnect(address)
    setIsOpen(false)
    disconnect()
  }, [address, disconnect])

  if (!canHoldHandle) return null

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.gate}
      aria-label="Choose your username"
      /* Esc and the backdrop are both ways past a required prompt, so a required one takes neither */
      onCancel={(event) => {
        event.stopPropagation()
        event.preventDefault()
        if (!isRequired) handleLater()
      }}
      onClose={(event) => {
        event.stopPropagation()
        setIsOpen(false)
      }}
    >
      <div className={styles.gate__icon} aria-hidden="true">
        <AtIcon size={22} weight="bold" />
      </div>

      <h2 className={styles.gate__title}>{isRequired ? 'Pick your username' : 'Claim your username'}</h2>
      {/* No promises about permanence: handles live in Hup's own database, not onchain. */}
      <p className={styles.gate__copy}>
        {isRequired
          ? 'How people find and mention you. Your profile lives at hup.social/@yourname.'
          : 'Your profile answers to its address. A username makes it something people can type.'}
      </p>

      <UsernameField
        address={address}
        username={profile?.username}
        suggestion={suggestUsername(profile?.name)}
        autoFocus
        label=""
        onClaimed={handleClaimed}
      />

      <p className={styles.gate__note}>Claiming asks your wallet for a signature. It costs no gas.</p>

      <div className={styles.gate__actions}>
        {isRequired ? (
          <button type="button" className={styles.gate__quiet} onClick={handleDisconnect}>
            Disconnect
          </button>
        ) : (
          <button type="button" className={styles.gate__quiet} onClick={handleLater}>
            Later
          </button>
        )}
      </div>
    </NativeDialog>
  )
}
