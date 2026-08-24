'use client'

import Link from 'next/link'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import useSWRImmutable from 'swr/immutable'
import { useClientMounted } from '@/hooks/useClientMount'
import { useConnect, useConnection, useConnectors } from 'wagmi'
import { EMAIL_CONNECTOR_ID, openEmailLogin } from '@/lib/embeddedWallet/connector'
import { isFramedByGridHost, UP_PROVIDER_RDNS } from '@/lib/upProviderClient'
import { ensureProfile } from '@/lib/api'
import { useProfile } from '@/hooks/useProfile'
import { handleBrokenAvatar } from '@/lib/utils'
import DialogSheet from '@/components/ui/DialogSheet'
import NativePopover from '@/components/ui/NativePopover'
import NetworkSelect from '@/components/ui/NetworkSelect'
import { setActiveChainId, useActiveChain } from '@/hooks/useActiveChain'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { useSolanaWallet } from '@/hooks/useSolanaWallet'
import { SOLANA_CHAINS, SOLANA_ICON_URL } from '@/config/solana'
import { setNetworkColor } from '@/config/wagmi'
import styles from './ConnectWallet.module.scss'

// Matches the sm breakpoint in styles/components/_responsive.scss
const COMPACT_QUERY = '(max-width: 639px)'

/**
 * Below sm the wallet list is a bottom sheet — a modal, since it covers the page. At wider
 * widths it hangs off the Connect button as a panel that leaves the page live behind it,
 * which per AGENTS.md makes it a popover rather than a dialog.
 */
function useCompactViewport() {
  const [isCompact, setIsCompact] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(COMPACT_QUERY)
    setIsCompact(mql.matches)

    const handleChange = (event) => setIsCompact(event.matches)
    mql.addEventListener('change', handleChange)

    return () => mql.removeEventListener('change', handleChange)
  }, [])

  return isCompact
}

/** Shared between both surfaces; NativePopover clones it to attach its popovertarget. */
const ConnectTrigger = forwardRef(function ConnectTrigger(props, ref) {
  return (
    <button ref={ref} type="button" className={`${styles.btnConnect} flex align-items-center gap-025 `} {...props}>
      Connect
    </button>
  )
})

const memberCount = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

const fetchJson = (url) => fetch(url).then((response) => response.json())

/**
 * Social proof under the title: three random member faces and the live users count. Renders
 * nothing until the numbers exist — an empty claim is worse than none — and since both popup
 * surfaces mount their content eagerly, the data is warm before the popup ever opens.
 */
function CommunityProof() {
  const { data } = useSWRImmutable('/api/v1/users/community', fetchJson)
  const proof = data?.success ? data.data : null

  if (!proof?.count || !proof.users?.length) return null

  return (
    <div className={`${styles.proof} flex align-items-center`}>
      <div className={`${styles.proof__avatars} flex`}>
        {proof.users.map((user) => (
          <img
            key={user.address}
            src={user.avatar}
            alt=""
            width="26"
            height="26"
            onError={handleBrokenAvatar}
          />
        ))}
      </div>
      <p className={styles.proof__text}>
        Join <strong>{memberCount.format(proof.count)}+</strong> other users now
      </p>
    </div>
  )
}

/** Title, connector list and footnote — identical in the sheet and the anchored panel. */
function WalletPanelContent({ onConnected, onClose, session }) {
  return (
    <>
      <DialogSheet.Header title="Connect a wallet" onClose={onClose} />

      <CommunityProof />

      <WalletOptions key={session} onConnected={onConnected} />

      <DialogSheet.Footer>
        By connecting a wallet, you consent to Hup&rsquo;s <Link href="/privacy-policy">Privacy Policy</Link>.
      </DialogSheet.Footer>
    </>
  )
}

export const ConnectWallet = () => {
  const dialogRef = useRef(null)
  const mounted = useClientMounted()
  const isCompact = useCompactViewport()

  const { address: evmAddress, isConnected: isEvmConnected } = useConnection()
  // What the header shows follows the active network: the Solana wallet on a Solana cluster,
  // the EVM wallet everywhere else — one Connect button, one profile chip
  const { address, isConnected } = useActiveWallet()

  const ensuredProfileRef = useRef(null)

  // EVM only — the Solana bootstrap ensures its own profile on connect
  useEffect(() => {
    if (!isEvmConnected || !evmAddress) return

    const walletAddress = evmAddress.toLowerCase()

    if (ensuredProfileRef.current === walletAddress) return
    ensuredProfileRef.current = walletAddress

    ensureProfile(walletAddress).catch((error) => {
      console.error('Failed to create user profile:', error.message)
      ensuredProfileRef.current = null
    })
  }, [isEvmConnected, evmAddress])

  return !mounted ? null : (
    <>
      {isConnected && (
        <>
          <NetworkSelect />
          <Profile addr={address} />
        </>
      )}

      {!isConnected &&
        (isCompact ? (
          <>
            <ConnectTrigger onClick={() => dialogRef.current?.open()} />
            <WalletConnectDialog ref={dialogRef} />
          </>
        ) : (
          <WalletConnectPanel />
        ))}
    </>
  )
}

/**
 * Wide-viewport surface: a panel hanging off the Connect button, with the page still visible
 * and usable behind it. No close button — popover=auto light-dismisses on an outside click
 * or Esc, and a dismiss affordance on unblocking UI is just clutter.
 */
export function WalletConnectPanel() {
  // Bumped on every close so WalletOptions remounts with fresh mutation state
  // (no stale "connection rejected" error on the next open).
  const [session, setSession] = useState(0)

  // Stable identity: NativePopover re-subscribes its listeners whenever this changes
  const handleToggle = useCallback((event) => {
    if (event.newState === 'closed') setSession((s) => s + 1)
  }, [])

  return (
    <NativePopover trigger={<ConnectTrigger />} placement="bottom-end" className={styles.walletPanel} onToggle={handleToggle}>
      {({ close }) => <WalletPanelContent session={session} onConnected={close} />}
    </NativePopover>
  )
}

/**
 * Compact-viewport surface: the bottom sheet. Modal, because it covers the page — so it keeps
 * the backdrop, the scroll lock and a close button.
 */
export const WalletConnectDialog = forwardRef(function WalletConnectDialog(_, ref) {
  const dialogRef = useRef(null)
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
    <DialogSheet ref={dialogRef} lightDismiss aria-label="Connect wallet" onClose={() => setSession((s) => s + 1)}>
      <WalletPanelContent session={session} onConnected={close} onClose={close} />
    </DialogSheet>
  )
})

/** Scannable-code glyph for connectors that pair by QR rather than by an installed provider. */
function QrGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3.5v3.5H14zM19.5 19.5H21V21h-1.5z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * Labels for connectors whose own name is a term of art rather than something a user would
 * recognise. wagmi calls the generic `window.ethereum` fallback "Injected"; renaming it at the
 * connector would mean handing `injected()` a `target`, and that also switches on the eager
 * connect/accountsChanged listeners it deliberately leaves off — so the fix belongs here, where
 * only the label changes and `connector.id` stays what the ordering and Detected checks key off.
 */
const CONNECTOR_LABELS = { injected: 'Browser wallet' }

const connectorLabel = (connector) => CONNECTOR_LABELS[connector.id] || connector.name

const PHANTOM_URL = 'https://phantom.com/download'

export function WalletOptions({ onConnected }) {
  const connectors = useConnectors()
  const { mutate: connect, isPending, variables, error } = useConnect()
  const { chain: activeChain } = useActiveChain()
  // Solana wallets come from the Wallet Standard registry and sit in the same list: one
  // Connect flow whichever chain the wallet is for
  const solana = useSolanaWallet()
  const [solanaPending, setSolanaPending] = useState(null)
  const [solanaError, setSolanaError] = useState(null)

  // List order: Email leads (the no-extension path), then wallets provably
  // installed (EIP-6963 announced — Universal Profile, MetaMask, ...), then the
  // generic rest. Inside a LUKSO Grid frame the host's Universal Profile is the
  // connector that actually works (extensions don't inject into cross-origin
  // iframes), so it outranks everything there. Array.sort is stable, so ties
  // keep their registration order.
  const inGridFrame = isFramedByGridHost()
  const rank = (connector) => {
    if (inGridFrame && connector.id === UP_PROVIDER_RDNS) return 0
    if (connector.id === EMAIL_CONNECTOR_ID) return 1
    if (connector.type === 'injected' && connector.id !== 'injected') return 2
    return 3
  }
  const ordered = [...connectors].sort((a, b) => rank(a) - rank(b))

  const handleConnect = (connector) => {
    // Email is not a one-click connect: it runs its own dialog (OTP, recovery
    // password) and calls connect() itself once the key is in memory.
    if (connector.id === EMAIL_CONNECTOR_ID) {
      onConnected?.()
      openEmailLogin()
      return
    }

    // The network follows the wallet that just connected: an EVM wallet picked while a Solana
    // cluster was active moves the app onto the wallet's chain, so the header never shows a
    // connected wallet the active network cannot use
    connect(
      { connector },
      {
        onSuccess: (data) => {
          if (activeChain?.isSolana && data?.chainId) setActiveChainId(data.chainId)
          onConnected?.()
        },
      },
    )

    // WalletConnect draws its QR sheet as a <w3m-modal> inside the page, but this list lives in
    // the top layer either way (showModal() sheet, or popover), and the top layer paints above
    // every z-index — the QR sheet opens buried underneath and the row just spins forever. Hand
    // the screen over to any connector that brings its own UI; the rest resolve in place.
    if (connector.type === 'walletConnect') onConnected?.()
  }

  // Same rule the other way round: connecting a Solana wallet moves the app onto Solana
  const handleConnectSolana = async (name) => {
    setSolanaPending(name)
    setSolanaError(null)
    try {
      await solana.connect(name)
      if (!activeChain?.isSolana && SOLANA_CHAINS[0]) {
        setActiveChainId(SOLANA_CHAINS[0].id)
        setNetworkColor(SOLANA_CHAINS[0])
      }
      onConnected?.()
    } catch (connectError) {
      setSolanaError(connectError.message || 'Could not connect the wallet')
    } finally {
      setSolanaPending(null)
    }
  }

  // Always the second box, right after the EVM wallets
  const solanaGroup = (
    <DialogSheet.Group>
      {solana.wallets.length === 0 ? (
        <DialogSheet.Row
          icon={<img src={SOLANA_ICON_URL} alt="" />}
          name="Phantom (Solana)"
          meta="Install"
          onClick={() => window.open(PHANTOM_URL, '_blank', 'noopener,noreferrer')}
        />
      ) : (
        solana.wallets.map((wallet) => (
          <DialogSheet.Row
            key={wallet.name}
            icon={<img src={wallet.icon} alt="" />}
            name={`${wallet.name} (Solana)`}
            meta={solanaPending === wallet.name ? <span className={styles.spinner} aria-label="Connecting" /> : 'Detected'}
            onClick={() => handleConnectSolana(wallet.name)}
            disabled={isPending || solanaPending !== null}
          />
        ))
      )}
    </DialogSheet.Group>
  )

  return (
    <DialogSheet.Body>
      <DialogSheet.Group>
        {ordered.map((connector) => {
          const isConnectingThis = isPending && variables?.connector?.uid === connector.uid
          // EIP-6963 discovery gives an announced wallet its rdns as the id, so anything
          // injected under an id other than the generic fallback is provably installed —
          // wagmi's own `injected()` connector is always listed whether or not it resolves.
          const isDetected = connector.type === 'injected' && connector.id !== 'injected'

          return (
            <DialogSheet.Row
              key={connector.uid}
              // A string icon falls back to the connector's initial in a tinted tile
              icon={connector.icon ? <img src={connector.icon} alt="" /> : connectorLabel(connector)}
              name={connectorLabel(connector)}
              meta={
                isConnectingThis ? (
                  <span className={styles.spinner} aria-label="Connecting" />
                ) : isDetected ? (
                  'Detected'
                ) : connector.type === 'walletConnect' ? (
                  <QrGlyph />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                    <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z" />
                  </svg>
                )
              }
              onClick={() => handleConnect(connector)}
              disabled={isPending}
            />
          )
        })}
      </DialogSheet.Group>
      {solanaGroup}

      {(error || solanaError) && <p className={styles.error}>{solanaError || error?.shortMessage || error?.message}</p>}
    </DialogSheet.Body>
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
        <img alt={profile.name || `PFP`} src={profile.profileImage} className={`rounded`} onError={handleBrokenAvatar} />
      </figure>
    </Link>
  )
}
