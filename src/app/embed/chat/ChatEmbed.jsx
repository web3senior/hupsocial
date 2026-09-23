'use client'

import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import ChatDock from '@/components/chat/ChatDock'

/** @param {{theme: 'light'|'dark'|null}} props null follows the visitor's system theme */
export default function ChatEmbed({ theme }) {
  const { setTheme } = useTheme()

  useEffect(() => {
    setTheme(theme ?? 'system')
  }, [theme, setTheme])

  return <ChatDock embedded />
}
