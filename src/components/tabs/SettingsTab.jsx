'use client'

import { useCallback, useEffect, useState } from 'react'
import { useConnection, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { getActiveChain, getUserSessions } from '@/lib/communication'
import hupABI from '@/abi/hup.json'
import styles from './SettingsTab.module.scss'
import { RefreshCwIcon } from 'lucide-react'
import { ethers } from 'ethers'
import Balance from '@/app/(user)/[wallet]/_components/balance'
import { toRelativeTime, toRelativeTimestamp } from '@/lib/dateHelper'
import { isSessionActive } from '@/lib/BurnerSession'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const localStorageBurnerAddress = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}burner_address`
const localStorageBurnerKey = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}burner_key`

export default function SettingsTab() {
  const { address } = useConnection()
  const publicClient = usePublicClient()
  const activeChain = getActiveChain()
  const [sessionActive, setSessionActive] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [burnerAddress, setBurnerAddress] = useState(null)
  const [expiresAt, setExpiresAt] = useState(null)

  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const checkStatus = useCallback(async () => {
    try {
      const session = await isSessionActive({
        userAddress: address,
        publicClient,
      })
      console.log(`Session status for ${address}:`, session)
      setSessionActive(session.active)
      setBurnerAddress(session.burnerAddress)
      setExpiresAt(session.expiresAt)
    } catch (err) {
      console.error('Status check failed:', err)
      setSessionActive(false)
    }
  }, [address, publicClient])

  useEffect(() => {
    checkStatus()
    const interval = setInterval(checkStatus, 30000)

    return () => clearInterval(interval)
  }, [checkStatus])

  const handleAuthorizeSession = async () => {
    try {
      setIsLoading(true)

      let burnerAddress
      if (!localStorage.getItem(localStorageBurnerAddress) || !localStorage.getItem(localStorageBurnerKey)) {
        const burner = ethers.Wallet.createRandom()
        localStorage.setItem(localStorageBurnerKey, burner.privateKey)
        localStorage.setItem(localStorageBurnerAddress, burner.address)
        burnerAddress = burner.address
      } else {
        const existingAddress = localStorage.getItem(localStorageBurnerAddress)
        const existingKey = localStorage.getItem(localStorageBurnerKey)
        if (!existingAddress || !existingKey) {
          throw new Error('Existing burner key or address missing')
        }
        burnerAddress = existingAddress
      }

      // Calculate absolute timestamp: Now + 30 days
      const duration = 3600 * 24 * 30
      //const expiryTimestamp = Math.floor(Date.now() / 1000) + duration

      writeContract({
        address: activeChain[1].hup,
        abi: hupABI,
        functionName: 'authorizeSession',
        // Pass the absolute timestamp
        args: [burnerAddress, duration],
      })
    } catch (err) {
      console.error('Session authorization failed:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRevokeSession = async () => {
    try {
      setIsLoading(true)
      writeContract({
        address: activeChain[1].hup,
        abi: hupABI,
        functionName: 'revokeSession',
        // Pass the absolute timestamp
        args: [],
      })
    } catch (err) {
      console.error('Session authorization failed:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={`${styles.tabContent} ${styles.communitiesTab} relative`}>
      <div className="__container" data-width="medium">
        <div className={`card ${styles.section}`}>
          <div className={`card__body ${styles.sectionBody}`}>
            <h4>Set session key on LUKSO</h4>
            <small>Send a small amount of native token to the burner address to sign the transactions.</small>
            {/* TODO: before revoking will force users to withdraw their funds. and an alert about the current device/ they will need to recover their session key and add to another device. a feature to import session keys */}
            {/* TODO: encrypt the private key in localStorage */}
            {/* TODO: Replace signature-based wallet creation with random wallet generation mechanism: so it will be easy to use in other devices instead of adding the PK manually or create a new one */}
            <p>Status: {sessionActive ? '🟢 Active' : 'Not Set'}</p>

            {burnerAddress && (
              <>
                <p>
                  Burner Address: <br />
                  <code>{burnerAddress}</code>
                </p>
                <p>
                  Balance: <Balance addr={burnerAddress} chainId={4201} />
                </p>
                <p>
                  Expires At: <br />
                  <code>
                    {sessionActive ? 'In ' : ''}
                    {sessionActive ? toRelativeTime(expiresAt) : 'N/A'}
                  </code>
                </p>
              </>
            )}
            <button onClick={checkStatus}>
              <RefreshCwIcon size={24} />
            </button>

            <button className="mt-20" onClick={handleAuthorizeSession} disabled={sessionActive || isLoading}>
              Authorize Session
            </button>

            <button className="mt-20" onClick={handleRevokeSession} disabled={!sessionActive || isLoading}>
              Revoke Session
            </button>

            <button>Recover Session (Coming Soon)</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PushNotificationManager() {
  const [isSupported, setIsSupported] = useState(false)
  const [subscription, setSubscription] = useState(null)
  const [message, setMessage] = useState('')
  const { address, isConnected } = useConnection()

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/\\-/g, '+').replace(/_/g, '/')

    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
  }

  async function registerServiceWorker() {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })
    const sub = await registration.pushManager.getSubscription()
    setSubscription(sub)
  }

  async function subscribeToPush() {
    const registration = await navigator.serviceWorker.ready
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    })
    setSubscription(sub)
    await subscribeUser(sub, address)
  }

  async function unsubscribeFromPush() {
    await subscription?.unsubscribe()
    setSubscription(null)
    await unsubscribeUser()
  }

  async function sendTestNotification() {
    if (subscription) {
      await sendNotification(message, address)
      setMessage('')
    }
  }

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true)
      registerServiceWorker()
    }
  }, [])

  if (!isSupported) {
    return <p>Push notifications are not supported in this browser.</p>
  }

  return (
    <div>
      <h3>Push Notifications</h3>
      {subscription ? (
        <>
          <p>You are subscribed to push notifications.</p>
          <button onClick={unsubscribeFromPush}>Unsubscribe</button>
          <input type="text" placeholder="Enter notification message" value={message} onChange={(e) => setMessage(e.target.value)} />
          <button onClick={sendTestNotification}>Send Test</button>
        </>
      ) : (
        <>
          <p>You are not subscribed to push notifications.</p>
          <button onClick={subscribeToPush}>Subscribe</button>
        </>
      )}
    </div>
  )
}

function InstallPrompt() {
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream)

    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches)
  }, [])

  if (isStandalone) {
    return null // Don't show install button if already installed
  }

  return (
    <div>
      <h3>Install App</h3>
      <button>Add to Home Screen</button>
      {isIOS && (
        <p>
          To install this app on your iOS device, tap the share button
          <span role="img" aria-label="share icon">
            {' '}
            ⎋{' '}
          </span>
          and then "Add to Home Screen"
          <span role="img" aria-label="plus icon">
            {' '}
            ➕{' '}
          </span>
          .
        </p>
      )}
    </div>
  )
}
