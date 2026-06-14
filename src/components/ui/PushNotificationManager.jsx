/**
 * @file components/PushNotificationManager.jsx
 * @description Manages push subscription lifecycle. Wallet ownership is verified
 * server-side via signed nonce — walletAddress is never trusted from the client.
 */
'use client'

// ■■■ [Imports] ■■■
import { useState, useEffect } from 'react'
import { useSignMessage, useConnection } from 'wagmi'
import clsx from 'clsx'
import styles from './PushNotificationManager.module.scss'

export default function PushNotificationManager() {
  // ■■■ [State] ■■■
  const [isSupported, setIsSupported] = useState(false)
  const [subscription, setSubscription] = useState(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // ■■■ [Hooks] ■■■
  const { address, isConnected } = useConnection()
  const { signMessageAsync } = useSignMessage()

  // ■■■ [Lifecycle] ■■■
  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true)
      registerServiceWorker()
    }
  }, [])

  // ■■■ [Internal Methods] ■■■
  async function registerServiceWorker() {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })
    const sub = await registration.pushManager.getSubscription()
    setSubscription(sub)
  }

  async function fetchNonce() {
    const res = await fetch('/api/v1/auth/nonce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_address: address }),
    })
    const { nonce } = await res.json()
    return nonce
  }

  // ■■■ [Handlers] ■■■
  async function subscribeToPush() {
    try {
      setIsProcessing(true)
      const registration = await navigator.serviceWorker.ready
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
      })

      const nonce = await fetchNonce()
      const signature = await signMessageAsync({
        message: `Subscribe to ${process.env.NEXT_PUBLIC_NAME} push notifications.\nNonce: ${nonce}`,
      })

      const res = await fetch('/api/v1/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, nonce, subscription: sub }),
      })

      if (res.ok) setSubscription(sub)
    } catch (error) {
      console.error('Subscription failed:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  async function unsubscribeFromPush() {
    try {
      setIsProcessing(true)
      const nonce = await fetchNonce()
      const signature = await signMessageAsync({
        message: `Unsubscribe from ${process.env.NEXT_PUBLIC_NAME} push notifications.\nNonce: ${nonce}`,
      })

      const res = await fetch('/api/v1/notifications/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, nonce }),
      })

      if (res.ok) {
        await subscription?.unsubscribe()
        setSubscription(null)
      }
    } catch (error) {
      console.error('Unsubscribe failed:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  // ■■■ [Render] ■■■
  if (!isConnected) {
    return (
      <div className={styles['notification-manager']}>
        <p className={clsx(styles['notification-manager__status'], styles['notification-manager__status--warning'])}>
          Connect your wallet to manage notifications.
        </p>
      </div>
    )
  }

  if (!isSupported) {
    return (
      <div className={styles['notification-manager']}>
        <p className={clsx(styles['notification-manager__status'], styles['notification-manager__status--error'])}>
          Push notifications are not supported in this browser.
        </p>
      </div>
    )
  }

  return (
    <div className={styles['notification-manager']}>
      <div className={styles['notification-manager__header']}>
        <h3 className={styles['notification-manager__title']}>Push Notifications</h3>
      </div>

      {subscription ? (
        <>
          <p className={clsx(styles['notification-manager__status'], styles['notification-manager__status--success'])}>
            System active. Receiving encrypted updates.
          </p>
          <button 
            className={clsx(styles['notification-manager__action'], styles['notification-manager__action--unsubscribe'])}
            onClick={unsubscribeFromPush}
            disabled={isProcessing}
          >
            {isProcessing ? 'Processing...' : 'Unsubscribe'}
          </button>
        </>
      ) : (
        <>
          <p className={styles['notification-manager__status']}>
            Enable to receive real-time protocol updates.
          </p>
          <button 
            className={clsx(styles['notification-manager__action'], styles['notification-manager__action--subscribe'])}
            onClick={subscribeToPush}
            disabled={isProcessing}
          >
            {isProcessing ? 'Awaiting Signature...' : 'Subscribe'}
          </button>
        </>
      )}
    </div>
  )
}

// ■■■ [Utils] ■■■
function urlBase64ToUint8Array(base64String) {
  if (!base64String) throw new Error('VAPID public key is missing or undefined.')

  const cleanString = base64String.trim().replace(/^"|"$/g, '')
  const padding = '='.repeat((4 - (cleanString.length % 4)) % 4)
  const base64 = (cleanString + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  
  return outputArray
}