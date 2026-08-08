'use client'

import Link from 'next/link'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useClientMounted } from '@/hooks/useClientMount'
import { useConnect, useConnection, useConnectors } from 'wagmi'
import { isFramedByGridHost, UP_PROVIDER_RDNS } from '@/lib/upProviderClient'
import { ensureProfile } from '@/lib/api'
import { useProfile } from '@/hooks/useProfile'
import clsx from 'clsx'
import NativeDialog from '@/components/ui/NativeDialog'
import NetworkSelect from '@/components/ui/NetworkSelect'
import styles from './ConnectWallet.module.scss'

export const ConnectWallet = () => {
  const dialogRef = useRef(null)
  const mounted = useClientMounted()

  const { address, isConnected } = useConnection()

  const ensuredProfileRef = useRef(null)

  useEffect(() => {
    if (!isConnected || !address) return

    const walletAddress = address.toLowerCase()

    if (ensuredProfileRef.current === walletAddress) return
    ensuredProfileRef.current = walletAddress

    ensureProfile(walletAddress).catch((error) => {
      console.error('Failed to create user profile:', error.message)
      ensuredProfileRef.current = null
    })
  }, [isConnected, address])

  return !mounted ? null : (
    <>
      <NetworkSelect />

      {isConnected && <Profile addr={address} />}

      {!isConnected && (
        <button className={`${styles.btnConnect} flex align-items-center gap-025 `} onClick={() => dialogRef.current?.open()}>
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#fff">
            <path d="M224.62-160q-27.62 0-46.12-18.5Q160-197 160-224.62v-510.76q0-27.62 18.5-46.12Q197-800 224.62-800h510.76q27.62 0 46.12 18.5Q800-763 800-735.38V-680H544.62q-47.93 0-76.27 28.35Q440-623.31 440-575.38v190.76q0 47.93 28.35 76.27Q496.69-280 544.62-280H800v55.38q0 27.62-18.5 46.12Q763-160 735.38-160H224.62Zm320-160q-27.62 0-46.12-18.5Q480-357 480-384.62v-190.76q0-27.62 18.5-46.12Q517-640 544.62-640h230.76q27.62 0 46.12 18.5Q840-603 840-575.38v190.76q0 27.62-18.5 46.12Q803-320 775.38-320H544.62ZM640-420q26 0 43-17t17-43q0-26-17-43t-43-17q-26 0-43 17t-17 43q0 26 17 43t43 17Z" />
          </svg>
          Connect
        </button>
      )}

      <WalletConnectDialog ref={dialogRef} />
    </>
  )
}

/**
 * Top-layer connect-wallet modal built on the shared NativeDialog primitive.
 * The previous fixed-position div lived inside the fixed header and lost the
 * stacking-context battle with the page content, so it never showed.
 */
export const WalletConnectDialog = forwardRef(function WalletConnectDialog(_, ref) {
  const dialogRef = useRef(null)
  // Bumped on every close so WalletOptions remounts with fresh mutation state
  // (no stale "connection rejected" error on the next open).
  const [session, setSession] = useState(0)

  useImperativeHandle(
    ref,
    () => ({
      open: () => dialogRef.current?.open(),
      close: () => dialogRef.current?.close(),
    }),
    []
  )

  const close = () => dialogRef.current?.close()

  return (
    <NativeDialog ref={dialogRef} lightDismiss className={styles.dialog} aria-label="Connect wallet" onClose={() => setSession((s) => s + 1)}>
      <header className={styles.dialog__header}>
        <h2 className={styles.dialog__title}>Connect wallet</h2>
        <button type="button" className={styles.dialog__close} onClick={close} aria-label="Close">
          <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
            <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
          </svg>
        </button>
      </header>

      <p className={styles.dialog__hint}>Choose a wallet to continue.</p>

      <WalletOptions key={session} onConnected={close} />
    </NativeDialog>
  )
})

export function WalletOptions({ onConnected }) {
  const connectors = useConnectors()
  const { mutate: connect, isPending, variables, error } = useConnect()

  // Inside a LUKSO Grid frame the host's Universal Profile is the connector that actually works
  // (extensions don't inject into cross-origin iframes), so it leads the list there
  const ordered = isFramedByGridHost() ? [...connectors].sort((a, b) => (b.id === UP_PROVIDER_RDNS) - (a.id === UP_PROVIDER_RDNS)) : connectors

  return (
    <div className={styles.options}>
      {ordered.map((connector) => {
        const isConnectingThis = isPending && variables?.connector?.uid === connector.uid

        return (
          <button
            key={connector.uid}
            type="button"
            className={clsx(styles.options__item, isConnectingThis && styles['options__item--pending'])}
            onClick={() => connect({ connector }, { onSuccess: () => onConnected?.() })}
            disabled={isPending}
          >
            {connector.icon ? (
              <img className={styles.options__icon} src={connector.icon} alt="" />
            ) : (
              <span className={clsx(styles.options__icon, styles['options__icon--fallback'])}>{connector.name.charAt(0)}</span>
            )}

            <span className={styles.options__name}>{connector.name}</span>

            {isConnectingThis ? (
              <span className={styles.options__spinner} aria-label="Connecting" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor" className={styles.options__chevron}>
                <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z" />
              </svg>
            )}
          </button>
        )
      })}

      {error && <p className={styles.options__error}>{error.shortMessage || error.message}</p>}
    </div>
  )
}

export function Profile({ addr }) {
  const { profile, isLoading } = useProfile(addr)

  if (isLoading || !profile)
    return (
      <div className={`${styles.profileShimmer} flex align-items-center`}>
        <div className={`shimmer rounded`} style={{ width: `36px`, height: `36px` }} />
      </div>
    )

  return (
    <Link href={`/${addr}`}>
      <figure className={`${styles.pfp} relative d-f-c flex-column grid--gap-050 rounded`} title={profile.name}>
        <img alt={profile.name || `PFP`} src={profile.profileImage} className={`rounded`} />
      </figure>
    </Link>
  )
}
