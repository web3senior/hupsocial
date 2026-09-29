'use client'

import Link from 'next/link'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { CaretRightIcon, QrCodeIcon, WalletIcon } from '@phosphor-icons/react'
import useSWRImmutable from 'swr/immutable'
import { useClientMounted } from '@/hooks/useClientMount'
import { useConnect, useConnection, useConnectors } from 'wagmi'
import { connect as connectTo, switchConnection } from 'wagmi/actions'
import { EMAIL_CONNECTOR_ID, openEmailLogin } from '@/lib/embeddedWallet/connector'
import { heldConnection } from '@/lib/heldConnection'
import { setConnectHandler } from '@/lib/connectDialog'
import { LUKSO_CONNECTOR_ID } from '@/lib/luksoConnector'
import { requestHostAccounts, UP_PROVIDER_RDNS, walletOffer } from '@/lib/upProviderClient'
import { ensureProfile } from '@/lib/api'
import { useProfile } from '@/hooks/useProfile'
import Avatar from '@/components/ui/Avatar'
import DialogSheet from '@/components/ui/DialogSheet'
import ConnectDiagnostics from '@/components/ConnectDiagnostics'
import { Spinner } from '@/components/Loading'
import { setActiveChainId, useActiveChain } from '@/hooks/useActiveChain'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { useSolanaWallet } from '@/hooks/useSolanaWallet'
import { SOLANA_CHAINS, SOLANA_ICON_URL } from '@/config/solana'
import { config, setNetworkColor } from '@/config/wagmi'
import { profilePath } from '@/lib/username'
import { markFirstConnect } from '@/lib/firstConnect'
import styles from './ConnectWallet.module.scss'

function ConnectTrigger(props) {
  return (
    <button type="button" className={`${styles.btnConnect} flex align-items-center gap-025 `} {...props}>
      Connect
    </button>
  )
}

/**
 * Where the wallet is already decided there is no list in between. Inside the LUKSO Grid the
 * host is the wallet: a Universal Profile it has granted connects by itself once wagmi settles,
 * or on Connect. In a browser that injects window.lukso, Connect goes to its prompt; in the chat
 * widget's room, to the prompt of the wallet the page relays. The chooser is the fallback: a
 * refusal, a failure, a second tap while a prompt is out, or an ask only a Solana wallet can meet.
 */
function useDirectConnect(openChooser) {
  const connectors = useConnectors()
  const { status } = useConnection()
  const { chain: activeChain } = useActiveChain()
  const pendingRef = useRef(false)
  const autoTriedRef = useRef(null)

  // Only announced where a Grid wallet is reachable: framed by the Grid, or relayed by the chat widget
  const connector = useMemo(() => connectors.find((item) => item.id === UP_PROVIDER_RDNS) ?? null, [connectors])
  const injectedLukso = useMemo(() => connectors.find((item) => item.id === LUKSO_CONNECTOR_ID) ?? null, [connectors])

  // Resolves false on any failure, and when `granted` asks for accounts the wallet has not handed
  // over. `ask` has the page's wallet prompt first, where the room was offered one that can.
  const connectWith = useCallback(async (target, { granted = false, ask = false } = {}) => {
    if (!target || pendingRef.current) return false

    pendingRef.current = true
    try {
      if (ask && !(await requestHostAccounts()).length) return false
      if (granted && !(await target.getAccounts()).length) return false

      // connect() throws for a wallet wagmi already holds
      if (heldConnection(target)) await switchConnection(config, { connector: target })
      else await connectTo(config, { connector: target })
      return true
    } catch {
      return false
    } finally {
      pendingRef.current = false
    }
  }, [])

  // The Grid never prompts, so it only connects what the host has already granted
  const connectGranted = useCallback(() => connectWith(connector, { granted: true }), [connectWith, connector])

  // wagmi drops the host's grant when it lands mid-reconnect, which is every returning visit.
  // Once per connector: a connect that keeps failing must not loop on its own status change.
  useEffect(() => {
    if (status !== 'disconnected' || !connector || autoTriedRef.current === connector.uid) return

    let isStale = false
    connector
      .getAccounts()
      .then((accounts) => {
        if (isStale || !accounts.length || autoTriedRef.current === connector.uid) return
        autoTriedRef.current = connector.uid
        connectGranted()
      })
      .catch(() => {})

    return () => {
      isStale = true
    }
  }, [status, connector, connectGranted])

  const canQuickConnect = Boolean(connector || injectedLukso) && !activeChain?.isSolana

  const connectOrOpen = async ({ chooser = false } = {}) => {
    if (chooser || !canQuickConnect) return openChooser()
    if (await connectGranted()) return
    if (await connectWith(injectedLukso)) return
    if (!(await connectWith(connector, { granted: true, ask: true }))) openChooser()
  }

  return { connectOrOpen }
}

const memberCount = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

const fetchJson = (url) => fetch(url).then((response) => response.json())

/**
 * Social proof under the title: three random member faces and the live users count. Renders
 * nothing until the numbers exist — an empty claim is worse than none — and since the dialog
 * mounts its content eagerly, the data is warm before it ever opens.
 */
function CommunityProof() {
  const { data } = useSWRImmutable('/api/v1/users/community', fetchJson)
  const proof = data?.success ? data.data : null

  if (!proof?.count || !proof.users?.length) return null

  return (
    <div className={`${styles.proof} flex align-items-center`}>
      <div className={`${styles.proof__avatars} flex`}>
        {proof.users.map((user) => (
          <Avatar key={user.address} src={user.avatar} size={26} />
        ))}
      </div>
      <p className={styles.proof__text}>
        Join <strong>{memberCount.format(proof.count)}+</strong> other users now
      </p>
    </div>
  )
}

export const ConnectWallet = () => {
  const dialogRef = useRef(null)
  const mounted = useClientMounted()

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

    ensureProfile(walletAddress)
      .then((row) => {
        // The one moment a wallet is new: the username prompt reads this to know whether it is
        // part of arriving or an ask made of an account that has been here for months.
        if (row?.is_new_account) markFirstConnect(walletAddress)
      })
      .catch((error) => {
        console.error('Failed to create user profile:', error.message)
        ensuredProfileRef.current = null
      })
  }, [isEvmConnected, evmAddress])

  return !mounted ? null : (
    <>
      {isConnected && <Profile addr={address} />}

      {!isConnected && (
        <>
          <ConnectTrigger onClick={() => dialogRef.current?.connect()} />
          <WalletConnectDialog ref={dialogRef} />
        </>
      )}
    </>
  )
}

/** Centered from sm up, a bottom sheet below it: DialogSheet owns the breakpoint. */
export const WalletConnectDialog = forwardRef(function WalletConnectDialog(_, ref) {
  const dialogRef = useRef(null)
  // Bumped on every close so WalletOptions remounts with fresh mutation state
  // (no stale "connection rejected" error on the next open).
  const [session, setSession] = useState(0)
  const { connectOrOpen } = useDirectConnect(() => dialogRef.current?.open())

  // No deps: connectOrOpen closes over the connector found this render
  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.open(),
    close: () => dialogRef.current?.close(),
    connect: connectOrOpen,
  }))

  // Lets a like, a composer button or a trade card open the chooser instead of only saying no
  useEffect(() => setConnectHandler(connectOrOpen))

  const close = () => dialogRef.current?.close()

  return (
    <DialogSheet ref={dialogRef} lightDismiss aria-label="Connect wallet" onClose={() => setSession((s) => s + 1)}>
      <DialogSheet.Header title="Connect a wallet" onClose={close} />

      <CommunityProof />

      <WalletOptions key={session} onConnected={close} />

      <DialogSheet.Footer>
        <p className={styles.footnote}>
          New to wallets?{' '}
          <a className={styles.footnote__link} href={WALLET_HELP_URL} target="_blank" rel="noopener noreferrer">
            Find a wallet
          </a>
        </p>
        By connecting a wallet, you consent to Hup&rsquo;s <Link href="/privacy-policy">Privacy Policy</Link>.
      </DialogSheet.Footer>

      <ConnectDiagnostics />
    </DialogSheet>
  )
})

/**
 * Labels for connectors whose own name is a term of art rather than something a user would
 * recognise. wagmi calls the generic `window.ethereum` fallback "Injected"; renaming it at the
 * connector would mean handing `injected()` a `target`, and that also switches on the eager
 * connect/accountsChanged listeners it deliberately leaves off — so the fix belongs here, where
 * only the label changes and `connector.id` stays what the ordering and Detected checks key off.
 */
const CONNECTOR_LABELS = { injected: 'Browser wallet' }

// The relayed wallet goes by the name the page gave it, not the Grid client's own "UE Universal Profile"
const connectorLabel = (connector) =>
  (connector.id === UP_PROVIDER_RDNS && walletOffer()?.name) || CONNECTOR_LABELS[connector.id] || connector.name

// Keyed by connector type; a type without an entry shows its name alone
const CONNECTOR_HINTS = { walletConnect: 'Any phone wallet, by link or QR code' }

const PHANTOM_URL = 'https://phantom.com/download'
const WALLET_HELP_URL = 'https://ethereum.org/wallets/find-wallet'

const connecting = <Spinner size={16} label="Connecting" />

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
  // generic rest. The Grid's Universal Profile only exists inside a LUKSO Grid
  // frame or a chat widget it relays to, and the window.lukso one only in a
  // browser that is itself the wallet; there they are the connectors that
  // actually work, so they outrank everything. Array.sort is stable, so ties
  // keep their registration order.
  const rank = (connector) => {
    if (connector.id === UP_PROVIDER_RDNS || connector.id === LUKSO_CONNECTOR_ID) return 0
    if (connector.id === EMAIL_CONNECTOR_ID) return 1
    if (connector.type === 'injected' && connector.id !== 'injected') return 2
    return 3
  }
  const ordered = [...connectors].sort((a, b) => rank(a) - rank(b))

  // The network follows the wallet that just connected: an EVM wallet picked while a Solana
  // cluster was active moves the app onto the wallet's chain, so the header never shows a
  // connected wallet the active network cannot use
  const finishConnect = (chainId) => {
    if (activeChain?.isSolana && chainId) setActiveChainId(chainId)
    onConnected?.()
  }

  const handleConnect = async (connector) => {
    // Email is not a one-click connect: it runs its own dialog (OTP, recovery
    // password) and calls connect() itself once the key is in memory.
    if (connector.id === EMAIL_CONNECTOR_ID) {
      onConnected?.()
      openEmailLogin()
      return
    }

    // This list shows while a wallet is already held — mid-reconnect, or on a Solana network.
    // connect() throws for the current wallet and re-prompts any other, so pick it up instead.
    const held = heldConnection(connector)
    if (held) {
      await switchConnection(config, { connector })
      finishConnect(held.chainId)
      return
    }

    // The relayed wallet hands accounts over only once the page's own wallet has been asked
    if (connector.id === UP_PROVIDER_RDNS) await requestHostAccounts().catch(() => [])

    connect({ connector }, { onSuccess: (data) => finishConnect(data?.chainId) })

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
            meta={solanaPending === wallet.name ? connecting : 'Detected'}
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
              icon={connector.icon ? <img src={connector.icon} alt="" /> : <WalletIcon className={styles.glyph} aria-hidden="true" />}
              name={connectorLabel(connector)}
              description={CONNECTOR_HINTS[connector.type]}
              meta={
                isConnectingThis ? (
                  connecting
                ) : isDetected ? (
                  'Detected'
                ) : connector.type === 'walletConnect' ? (
                  <QrCodeIcon size={18} aria-hidden="true" />
                ) : (
                  <CaretRightIcon size={16} aria-hidden="true" />
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
    <Link href={profilePath(addr, profile.username)} prefetch={false}>
      <figure className={`${styles.pfp} relative d-f-c flex-column grid--gap-050 rounded`} title={profile.name}>
        <Avatar alt={profile.name || `PFP`} src={profile.profileImage} size={38} className={`rounded`} />
      </figure>
    </Link>
  )
}
