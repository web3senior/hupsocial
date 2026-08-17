'use client'

import { useState, useEffect } from 'react'
import SplashScreen from '@/components/SplashScreen'
import NextToast from './NextToast'
import WagmiContext from '@/contexts/WagmiContext'
import TickerTooltip from './TickerTooltip'
import Header from './Header'
import Aside from './Aside'
import Footer from './Footer'
import InstallAppDialog from './InstallAppDialog'
import EmailLoginDialog from './EmailLoginDialog'
import EmbeddedTxConfirm from './EmbeddedTxConfirm'
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
  const [isBooting, setIsBooting] = useState(true)

  useEffect(() => {
    const doneTimer = setTimeout(() => setIsBooting(false), SPLASH_FADE_MS)
    return () => clearTimeout(doneTimer)
  }, [])

  return (
    <Providers>
      <NextToast />
      <TickerTooltip />
      <OfflineBanner />

      <WagmiContext>
        <Header />
        <Aside />
        <main className={styles.main}>{children}</main>
        {/* <Footer /> */}
        <InstallAppDialog />
        {/* Email embedded wallet surfaces: the login flow and its extension-popup stand-in */}
        <EmailLoginDialog />
        <EmbeddedTxConfirm />
      </WagmiContext>

      {isBooting && <SplashScreen />}
    </Providers>
  )
}
