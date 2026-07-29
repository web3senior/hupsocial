'use client'

import { useEffect, useRef } from 'react'
import useInstallPrompt from '@/hooks/useInstallPrompt'
import NativeDialog from './ui/NativeDialog'
import styles from './InstallAppDialog.module.scss'

const APP_NAME = process.env.NEXT_PUBLIC_NAME || 'Hup'
const APP_DESCRIPTION = process.env.NEXT_PUBLIC_DESCRIPTION || 'Fully onchain social network'

const SCREENSHOTS = [
  { src: '/screenshots/narrow.png', alt: `${APP_NAME} on mobile`, width: 195, height: 422 },
  { src: '/screenshots/wide.png', alt: `${APP_NAME} on desktop`, width: 375, height: 211 },
]

export default function InstallAppDialog() {
  const { isReady, canInstall, isStandalone, platform, isDismissed, promptInstall, dismiss } = useInstallPrompt()
  const dialogRef = useRef(null)
  const hasOpened = useRef(false)

  // iOS Safari never fires beforeinstallprompt, so it gets the same card with
  // Add to Home Screen instructions standing in for the Install button
  const isOfferable = canInstall || platform === 'ios'
  const shouldOpen = isReady && !isStandalone && !isDismissed && isOfferable

  useEffect(() => {
    if (!shouldOpen || hasOpened.current) return
    hasOpened.current = true
    dialogRef.current?.open()
  }, [shouldOpen])

  const handleInstall = async () => {
    await promptInstall()
    dialogRef.current?.close()
  }

  // Closing by any route — button, Esc, backdrop — counts as an answer, so the
  // offer stays gone until localStorage is cleared or the app is reinstalled
  const handleClose = () => dismiss()

  if (!shouldOpen && !hasOpened.current) return null

  const origin = typeof window === 'undefined' ? '' : window.location.hostname

  return (
    <NativeDialog ref={dialogRef} className={styles.installDialog} lightDismiss onClose={handleClose}>
      <h2 className={styles.installDialog__title}>Install app</h2>

      <div className={styles.installDialog__identity}>
        <img className={styles.installDialog__icon} src="/icon-192x192.png" alt="" width={48} height={48} />
        <div className={styles.installDialog__names}>
          <span className={styles.installDialog__name}>{APP_NAME}</span>
          <span className={styles.installDialog__origin}>{origin}</span>
        </div>
      </div>

      <div className={styles.installDialog__about}>
        <h3 className={styles.installDialog__aboutTitle}>From the app</h3>
        <p className={styles.installDialog__description}>{APP_DESCRIPTION}</p>
      </div>

      <div className={styles.installDialog__screenshots}>
        {SCREENSHOTS.map((shot) => (
          <img
            key={shot.src}
            className={styles.installDialog__screenshot}
            src={shot.src}
            alt={shot.alt}
            width={shot.width}
            height={shot.height}
            loading="lazy"
          />
        ))}
      </div>

      {!canInstall && platform === 'ios' && (
        <p className={styles.installDialog__manual}>
          Tap the share button in Safari, then choose <strong>Add to Home Screen</strong>.
        </p>
      )}

      <div className={styles.installDialog__actions}>
        <button type="button" className={styles.installDialog__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        {canInstall && (
          <button type="button" className={styles.installDialog__install} onClick={handleInstall}>
            Install
          </button>
        )}
      </div>
    </NativeDialog>
  )
}
