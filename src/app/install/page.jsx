'use client'
import { useState, useEffect } from 'react'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'

function InstallPrompt() {
  const [isIOS, setIsIOS] = useState(false)
  const [isMacSafari, setIsMacSafari] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    // Flag the component as mounted on the client to safely render browser-specific UI
    setIsClient(true)

    const userAgent = window.navigator.userAgent

    // Determine if the user is on an iOS mobile device
    const iosCheck = /iPad|iPhone|iPod/.test(userAgent) && !window.MSStream
    setIsIOS(iosCheck)

    // Determine if the user is on Desktop Safari to provide Mac-specific instructions
    const macSafariCheck = userAgent.includes('Macintosh') && userAgent.includes('Safari') && !userAgent.includes('Chrome')
    setIsMacSafari(macSafariCheck)

    // Check if the app is already installed and running in its own window
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches)

    // Capture the install prompt event for Chromium browsers on desktop and Android
    const handleBeforeInstallPrompt = (e) => {
      // Prevent the default mini-infobar from appearing
      e.preventDefault()
      // Save the event so it can be triggered by the user clicking a button
      setDeferredPrompt(e)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    
    // Clean up the event listener when the component unmounts
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  }, [])

  const handleInstallClick = async () => {
    if (!deferredPrompt) return

    // Trigger the native browser installation prompt
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    
    // Discard the deferred prompt since it can only be used once
    setDeferredPrompt(null)

    if (outcome === 'accepted') {
      console.log('User accepted the PWA installation')
    } else {
      console.log('User dismissed the PWA installation')
    }
  }

  // Prevent rendering on the server or if the app is already installed
  if (!isClient || isStandalone) return null

  return (
    <div className={styles.card}>
      <p className={styles.description}>
        Install this app on your device for a faster, native-like experience.
      </p>

      {/* Render the install button automatically for compatible desktop/mobile browsers */}
      {deferredPrompt && (
        <button className={styles.button} onClick={handleInstallClick}>
          Install App
        </button>
      )}

      {/* Render manual instructions specific to iOS devices */}
      {isIOS && !deferredPrompt && (
        <p className={styles.ios}>
          To install on iOS, tap the share button{' '}
          <span role="img" aria-label="share icon">⎋</span>{' '}
          then "Add to Home Screen"{' '}
          <span role="img" aria-label="plus icon">➕</span>.
        </p>
      )}

      {/* Render manual instructions specific to Desktop Mac Safari */}
      {isMacSafari && !deferredPrompt && (
        <p className={styles.desktopSafari}>
          To install on Mac, click <strong>File</strong> in the menu bar, then select <strong>Add to Dock</strong>.
        </p>
      )}

      {/* Render a fallback for desktop browsers like Firefox or missed prompts */}
      {!deferredPrompt && !isIOS && !isMacSafari && (
        <p className={styles.fallback}>
          To install, look for an install icon in your browser's address bar, or check the browser menu for "Install" or "Add to Home Screen".
        </p>
      )}
    </div>
  )
}

export default function Page() {
  return (
    <>
      <PageTitle name="Install" />
      <div className={`${styles.page}`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <InstallPrompt />
        </div>
      </div>
    </>
  )
}