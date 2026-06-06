'use client'

import { useState, useEffect } from 'react'
import SplashScreen from '@/components/SplashScreen'
import NextToast from './NextToast'
import WagmiContext from '@/contexts/WagmiContext'
import TickerTooltip from './TickerTooltip'
import Header from './Header'
import Aside from './Aside'
import Footer from './Footer'
import { Providers } from '@/app/providers'
import styles from './ClientLayout.module.scss'

export default function ClientLayout({ children }) {
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Hide splash screen once the app is mounted
    // A 1000ms-2000ms delay is common to avoid "flicker"
    const timer = setTimeout(() => setIsLoading(false), 1500)
    return () => clearTimeout(timer)
  }, [])

  if (isLoading)
    return (
      <Providers>
        <SplashScreen />
      </Providers>
    )

  return (
    <Providers>
      <NextToast />
      <TickerTooltip />

      <WagmiContext>
        <Header />
        <Aside />
        <main className={styles.main}>{children}</main>
        {/* <Footer /> */}
      </WagmiContext>
    </Providers>
  )
}
