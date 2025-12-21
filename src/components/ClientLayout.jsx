'use client'

import { useState, useEffect } from 'react'
import SplashScreen from '@/components/SplashScreen'
import NextToast from './NextToast'
import WagmiContext from '@/contexts/WagmiContext'
import Header from './Header'
import Aside from './Aside'
import Footer from './Footer'
import styles from './ClientLayout.module.scss'

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
      <WagmiContext>
        <Header />
        <Aside />
        <main className={styles.main}>{children}</main>
        <Footer />
      </WagmiContext>
    </>
  )
}
