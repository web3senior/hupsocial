'use client'

import { useRouter } from 'next/navigation'
import { ConnectWallet } from '@/components/ConnectWallet'
import { MessageSquareMore, Radio, Settings, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import Chat from '@/app/chat/_components/Chat'
import styles from './page.module.scss'

export default function Page() {
  const [activeTab, setActiveTab] = useState('chat')
  // Track if we are still checking the local storage
  const [isAuthorized, setIsAuthorized] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const key = localStorage.getItem('encryptedAppKey')

    if (!key) {
      router.push('/')
    } else {
      setIsAuthorized(true)
    }
  }, [router])

  // Prevent rendering the UI while redirecting or checking
  if (!isAuthorized) {
    return null // or a loading spinner
  }

  return (
    <div className={clsx(styles.page)}>
      <nav className={clsx(styles.nav)}>
        <ul className={clsx(styles['nav__list'])}>
          <li title={`Chat`}>
            <button onClick={() => setActiveTab(`chat`)} className={clsx('rounded-full', styles['nav__item'], activeTab === 'chat' && styles['nav__item--active'])}>
              <MessageSquareMore width={21} height={21} strokeWidth={1.75} />
            </button>
          </li>
          <li title={`Communities`}>
            <button onClick={() => setActiveTab(`communities`)} className={clsx('rounded-full', styles['nav__item'], styles['nav__item--disabled'])}>
              <Users width={21} height={21} strokeWidth={1.75} />
            </button>
          </li>
          <li title={`Channels`}>
            <button onClick={() => setActiveTab(`channels`)} className={clsx('rounded-full', styles['nav__item'], styles['nav__item--disabled'])}>
              <Radio width={21} height={21} strokeWidth={1.75} />
            </button>
          </li>
        </ul>

        <ul className={clsx(styles['nav__list'])}>
          <li>
            <button onClick={() => setActiveTab(`settings`)} className={clsx('rounded-full', styles['nav__item'], activeTab === 'settings' && styles['nav__item--active'])}>
              <Settings width={21} height={21} strokeWidth={1.75} />
            </button>
          </li>
          <li>
            <ConnectWallet />
          </li>
        </ul>
      </nav>

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
