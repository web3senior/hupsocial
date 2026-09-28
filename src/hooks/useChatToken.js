'use client'

import { useSyncExternalStore } from 'react'
import { readChatToken, subscribeChatToken } from '@/lib/chatApi'

/** The wallet's chat bearer token, or null until it has signed in. */
export const useChatToken = (address) =>
  useSyncExternalStore(
    subscribeChatToken,
    () => readChatToken(address),
    () => null,
  )

export default useChatToken
