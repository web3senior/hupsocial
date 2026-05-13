'use client'

import { useState, useEffect } from 'react'
import SplashScreen from '@/components/SplashScreen'
import NextToast from './NextToast'
import WagmiContext from '@/contexts/WagmiContext'
import Header from './Header'
import Footer from './Footer'
import TickerTooltip from './TickerTooltip'
import NewPostButton from './ui/NewPostButton'
import styles from './ClientLayout.module.scss'
import Aside from './Aside'

export default function ClientLayout({ children }) {
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Hide splash screen once the app is mounted
    // A 1000ms-2000ms delay is common to avoid "flicker"
    const timer = setTimeout(() => setIsLoading(false), 1500)
    return () => clearTimeout(timer)
  }, [])

  if (isLoading) return <SplashScreen />

  return (
    <>
      <NextToast />
      <TickerTooltip />
      
      <WagmiContext>
        <Header />
        <Aside />
        <NewPostButton />
        <main className={styles.main}>{children}</main>
        <Footer />
      </WagmiContext>
    </>
  )
}
