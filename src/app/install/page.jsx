'use client'

import useInstallPrompt from '@/hooks/useInstallPrompt'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'

function InstallPrompt() {
  const { isReady, canInstall, isStandalone, platform, promptInstall } = useInstallPrompt()

  // Nothing to say before the browser checks are in, or once the app runs in its own window
  if (!isReady) return null

  if (isStandalone) {
    return <p className={styles.success}>Hup is installed — you are already running it as an app.</p>
  }

  return (
    <div className={styles.card}>
      <p className={styles.description}>Install this app on your device for a faster, native-like experience.</p>

      {/* The install button only works while a captured beforeinstallprompt is in hand */}
      {canInstall && (
        <button className={styles.button} onClick={promptInstall}>
          Install App
        </button>
      )}

      {!canInstall && platform === 'ios' && (
        <p className={styles.ios}>
          To install on iOS, tap the share button{' '}
          <span role="img" aria-label="share icon">
            ⎋
          </span>{' '}
          then &quot;Add to Home Screen&quot;{' '}
          <span role="img" aria-label="plus icon">
            ➕
          </span>
          .
        </p>
      )}

      {!canInstall && platform === 'macSafari' && (
        <p className={styles.desktopSafari}>
          To install on Mac, click <strong>File</strong> in the menu bar, then select <strong>Add to Dock</strong>.
        </p>
      )}

      {/* Fallback for Firefox and for Chromium tabs that already used up the prompt */}
      {!canInstall && platform === 'other' && (
        <p className={styles.fallback}>
          To install, look for an install icon in your browser&apos;s address bar, or check the browser menu for &quot;Install&quot; or
          &quot;Add to Home Screen&quot;.
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
