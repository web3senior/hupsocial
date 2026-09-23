'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import SplashScreen from '@/components/SplashScreen'
import NextToast from './NextToast'
import WagmiContext from '@/contexts/WagmiContext'
import TickerTooltip from './TickerTooltip'
import Header from './Header'
import Aside from './Aside'
import Footer from './Footer'
import InstallAppDialog from './InstallAppDialog'
import EmailLoginDialog from './EmailLoginDialog'
import UsernameGate from './UsernameGate'
import EmbeddedTxConfirm from './EmbeddedTxConfirm'
import VaultUnlockDialog from './VaultUnlockDialog'
import ComposerRecovery from './ComposerRecovery'
import TaskFundingHost from './TaskFundingHost'
import ScheduledPostsRunner from './ScheduledPostsRunner'
import ChatDock from './chat/ChatDock'
import { WalletConnectDialog } from './ConnectWallet'
import OfflineBanner from './ui/OfflineBanner'
import { Providers } from '@/app/providers'
import styles from './ClientLayout.module.scss'

// Hold + fade of the splash-out animation in SplashScreen.module.scss. Only governs when the
// (already transparent, non-interactive) element leaves the tree.
const SPLASH_FADE_MS = 900

/**
 * The shell renders unconditionally, including on the server, so the served HTML already
 * contains the header, the sidebar's reserved column and the route's skeletons. That is what
 * lets a cached document paint something useful with no network at all — gating the tree behind
 * the splash meant the HTML was nothing but a logo, and an offline visitor sat on it.
 *
 * The splash is now a decorative overlay (it was already position:fixed/inset:0) that fades
 * itself out in CSS, so the shell appears on schedule even if hydration is slow or never
 * arrives. This state only takes the faded-out element back out of the tree.
 */
export default function ClientLayout({ children }) {
  const pathname = usePathname()
  const [isBooting, setIsBooting] = useState(true)

  useEffect(() => {
    const doneTimer = setTimeout(() => setIsBooting(false), SPLASH_FADE_MS)
    return () => clearTimeout(doneTimer)
  }, [])

  if (pathname?.startsWith('/embed/')) return <EmbedShell>{children}</EmbedShell>

  return (
    <Providers>
      <NextToast />
      <TickerTooltip />
      <OfflineBanner />

      <WagmiContext>
        <Header />
        <Aside />
        <main className={styles.main}>{children}</main>
        <Footer />
        <InstallAppDialog />
        {/* A connected wallet with no handle is asked for one here — required on a first
            connect, an ask with a Later for the accounts that predate handles */}
        <UsernameGate />
        {/* Email embedded wallet surfaces: the login flow and its extension-popup stand-in */}
        <EmailLoginDialog />
        <EmbeddedTxConfirm />
        {/* Session-key writes reach this when the vault is closed — the one PIN surface
            outside Settings, so a locked vault is never a dead end mid-action */}
        <VaultUnlockDialog />
        {/* Composers close on the transaction, not the receipt — this is where one comes back
            if the chain rejects it after the author has already returned to the feed */}
        <ComposerRecovery />
        {/* A task post publishes first and is funded once indexed; the composer is gone by then */}
        <TaskFundingHost />
        {/* Asks the relayer for a due scheduled post the moment its author is online */}
        <ScheduledPostsRunner />
        {/* Offchain messenger docked on the right edge; the onchain /chat page hides it */}
        <ChatDock />
      </WagmiContext>

      {isBooting && <SplashScreen />}
    </Providers>
  )
}

/**
 * Documents framed by other sites (/embed/*): the wallet and the surfaces a signed-out or
 * email-wallet visitor needs, none of the app's chrome and no splash.
 */
function EmbedShell({ children }) {
  // The page scroller's always-on track would show as a bar down the frame's edge. A rule, not
  // inline style: lib/scrollLock.js clears html's inline overflow-y when a dialog closes.
  useEffect(() => {
    const sheet = document.createElement('style')
    sheet.textContent = 'html { overflow: hidden !important; scrollbar-gutter: auto !important; }'
    document.head.appendChild(sheet)
    return () => sheet.remove()
  }, [])

  return (
    <Providers>
      <NextToast />
      <WagmiContext>
        {children}
        <WalletConnectDialog />
        <EmailLoginDialog />
        <EmbeddedTxConfirm />
      </WagmiContext>
    </Providers>
  )
}
