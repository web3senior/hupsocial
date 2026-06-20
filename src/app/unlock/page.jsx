'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import styles from './page.module.scss'
import { APP_PASSWORD_SESSION_STORAGE, ENCRYPTED_APP_KEY_STORAGE, unlockAppKeyFromStorage, unlockAppKeyWithPassword } from '@/lib/appVault'

export default function Page() {
  const [password, setPassword] = useState('')
  const [isUnlocking, setIsUnlocking] = useState(false)
  const router = useRouter()

  const unlock = async () => {
    if (!password) {
      alert('Please enter your password.')
      return
    }

    try {
      setIsUnlocking(true)
      await unlockAppKeyWithPassword(password)
      router.push('/chat')
    } catch (error) {
      console.error('Unlock failed:', error)
      alert('Incorrect password or invalid local vault.')
    } finally {
      setIsUnlocking(false)
    }
  }

  useEffect(() => {
    const encryptedAppKey = localStorage.getItem(ENCRYPTED_APP_KEY_STORAGE)
    if (!encryptedAppKey) {
      router.push('/setup')
      return
    }

    const sessionPassword = sessionStorage.getItem(APP_PASSWORD_SESSION_STORAGE)
    if (!sessionPassword) return

    unlockAppKeyFromStorage()
      .then((unlocked) => {
        if (unlocked) router.push('/chat')
      })
      .catch(() => {
        sessionStorage.removeItem(APP_PASSWORD_SESSION_STORAGE)
      })
  }, [router])

  return (
    <>
      <div className={`${styles.page} d-f-c`}>
        <div className={`__container ${styles.page__container} d-f-c flex-column`} data-width={`medium`}>
          {/* Tour Content */}
          <div className={`${styles.tour} flex flex-column align-items-center justify-content-center gap-025`}>
            <b className={`${styles.tour__title}`}>Welcome back!</b>
            <p className={`${styles.tour__description}`}>
              This password will unlock your {process.env.NEXT_PUBLIC_NAME} account only on this device. {process.env.NEXT_PUBLIC_NAME} can
              not recover this password.
            </p>
          </div>

          {/* Action buttons */}
          <div className={`flex flex-column align-items-center gap-1 mt-30 w-100`}>
            <div className={`flex flex-column gap-025`}>
              <label htmlFor="password">Password</label>
              <input type="password" name="password" id="password" onChange={(e) => setPassword(e.target.value)} />
            </div>

            <button className={`${styles.actionButton} ${styles.createButton}`} disabled={!password || isUnlocking} onClick={unlock}>
              {isUnlocking ? 'Unlocking...' : 'Unlock'}
            </button>

            <span>Forgot password?</span>
          </div>
        </div>
      </div>
    </>
  )
}
