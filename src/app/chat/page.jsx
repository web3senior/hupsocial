'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import Chat from '@/app/chat/_components/Chat'
import { APP_PASSWORD_SESSION_STORAGE, ENCRYPTED_APP_KEY_STORAGE, unlockAppKeyFromStorage } from '@/lib/appVault'
import styles from './page.module.scss'

export default function Page() {
  const [activeTab] = useState('chat')
  const [isAuthorized, setIsAuthorized] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const key = localStorage.getItem(ENCRYPTED_APP_KEY_STORAGE)
    const sessionPassword = sessionStorage.getItem(APP_PASSWORD_SESSION_STORAGE)

    if (!key) {
      router.push('/register')
      return
    }

    if (!sessionPassword) {
      router.push('/unlock')
      return
    }

    unlockAppKeyFromStorage()
      .then((unlocked) => {
        if (!unlocked) {
          sessionStorage.removeItem(APP_PASSWORD_SESSION_STORAGE)
          router.push('/unlock')
          return
        }
        setIsAuthorized(true)
      })
      .catch(() => {
        sessionStorage.removeItem(APP_PASSWORD_SESSION_STORAGE)
        router.push('/unlock')
      })
  }, [router])

  if (!isAuthorized) {
    return null
  }

  return (
    <div className={clsx(styles.page)}>
      {activeTab === 'chat' && <Chat />}
      {activeTab === 'communities' && <NoData name={`Communities`} />}
      {activeTab === 'channels' && <NoData name={`Channels`} />}
      {activeTab === 'settings' && <NoData name={`Settings`} />}
    </div>
  )
}

//
// NoData Component
//
const NoData = ({ name }) => {
  return (
    <div className={clsx(styles['no-data'], 'd-f-c')}>
      <p className={clsx(styles['no-data__message'])}>{name} coming soon.</p>
    </div>
  )
}
