'use client'

import { notFound, useRouter } from 'next/navigation'
import { ConnectWallet } from '@/components/ConnectWallet'
import { MessageSquareMore, Radio, Settings, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import Chat from '@/app/chat/_components/Chat'
import styles from './page.module.scss'

export default function Page() {
  const [activeTab, setActiveTab] = useState('chat')
  const [isAuthorized, setIsAuthorized] = useState(false)
  const router = useRouter()

  // useEffect(() => {
  //   const key = localStorage.getItem('encryptedAppKey')

  //   if (!key) {
  //     router.push('/')
  //   } else {
  //     setIsAuthorized(true)
  //   }
  // }, [router])

  // // Prevent rendering the UI while redirecting or checking
  // if (!isAuthorized) {
  //   return null // or a loading spinner
  // }

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
