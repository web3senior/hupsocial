/**
 * @file app/admin/broadcast/page.jsx
 * @description Admin-only broadcast page. Redirects non-admin wallets away.
 */
'use client'

import { useState } from 'react'
import { useSignMessage, useConnection } from 'wagmi'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.toLowerCase()

export default function Page() {
  const { address, isConnected } = useConnection()
  const { signMessageAsync } = useSignMessage()

  const [message, setMessage] = useState('')
  const [status, setStatus] = useState(null) // null | 'loading' | 'success' | 'error'
  const [result, setResult] = useState(null)

  const isAdmin = isConnected && address?.toLowerCase() === ADMIN_WALLET

  async function fetchNonce() {
    const res = await fetch('/api/v1/auth/nonce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_address: address }),
    })
    const { nonce } = await res.json()
    return nonce
  }

  async function handleBroadcast() {
    if (!message.trim()) return

    try {
      setStatus('loading')
      setResult(null)

      const nonce = await fetchNonce()
      const signature = await signMessageAsync({
        message: `Broadcast notification.\nNonce: ${nonce}`,
      })

      const res = await fetch('/api/v1/notifications/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, nonce, message }),
      })

      const data = await res.json()

      if (res.ok) {
        setStatus('success')
        setResult(data)
        setMessage('')
      } else {
        setStatus('error')
        setResult(data)
      }
    } catch (err) {
      console.error('[BROADCAST_PAGE_ERROR]:', err)
      setStatus('error')
      setResult({ error: 'Signing cancelled or request failed.' })
    }
  }

  if (!isConnected) {
    return (
      <>
        <PageTitle name="Broadcast" />
        <div className={`${styles.page} ms-motion-slideDownIn`}>
          <div className={`__container ${styles.page__container}`} data-width="medium">
            <p className={styles.gate}>Connect your wallet to continue.</p>
          </div>
        </div>
      </>
    )
  }

  if (!isAdmin) {
    return (
      <>
        <PageTitle name="Broadcast" />
        <div className={`${styles.page} ms-motion-slideDownIn`}>
          <div className={`__container ${styles.page__container}`} data-width="medium">
            <p className={styles.gate}>You do not have permission to access this page.</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle name="Broadcast" />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <div className={styles.card}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="message">
                Message
              </label>
              <textarea
                id="message"
                className={styles.textarea}
                placeholder="Write your announcement..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
              />
            </div>

            <button
              className={styles.button}
              onClick={handleBroadcast}
              disabled={!message.trim() || status === 'loading'}
            >
              {status === 'loading' ? 'Sending...' : 'Send to all'}
            </button>

            {status === 'success' && result && (
              <p className={styles.success}>
                Sent to {result.sent} of {result.total} subscribers.
                {result.failed > 0 && ` ${result.failed} failed.`}
              </p>
            )}

            {status === 'error' && result && (
              <p className={styles.error}>{result.error}</p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}