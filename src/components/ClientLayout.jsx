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
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    const exitTimer = setTimeout(() => setIsExiting(true), 1200)
    const doneTimer = setTimeout(() => setIsLoading(false), 1500)
    return () => {
      clearTimeout(exitTimer)
      clearTimeout(doneTimer)
    }
  }, [])

  if (isLoading)
    return (
      <Providers>
        <SplashScreen isExiting={isExiting} />
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
        <Footer />
      </WagmiContext>
    </Providers>
  )
}
