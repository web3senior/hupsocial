'use client'

import { useEffect, useState } from 'react'
import { EnvelopeSimpleIcon } from '@phosphor-icons/react'
import { useClientMounted } from '@/hooks/useClientMount'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import { toast } from '@/components/NextToast'
import styles from './EmailNotifications.module.scss'

const postJson = async (url, body, method = 'POST') => {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.success === false) throw new Error(data.error || 'Something went wrong')
  return data
}

/**
 * Attach a verified email to the connected profile and get notifications as
 * digest emails. Verification is the whole point: the cron sweeper only mails
 * addresses that proved ownership with a code, so this card is the sole path
 * to being emailed by Hup.
 */
export default function EmailNotifications() {
  // Wallet connection state differs between SSR and the hydrated client — gate
  // the whole card client-side, matching ConnectWallet
  const mounted = useClientMounted()
  const { address, isConnected } = useConnection()

  // 'loading' | 'input' | 'code' | 'verified'
  const [step, setStep] = useState('loading')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [masked, setMasked] = useState(null)
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isConnected || !address) return
    let stale = false

    fetch(`/api/v1/users/email?address=${address.toLowerCase()}`)
      .then((r) => r.json())
      .then((data) => {
        if (stale) return
        if (data.success && data.email.verified) {
          setMasked(data.email.masked)
          setEnabled(data.email.enabled)
          setStep('verified')
        } else {
          setStep('input')
        }
      })
      .catch(() => !stale && setStep('input'))

    return () => {
      stale = true
    }
  }, [isConnected, address])

  const execute = async (event, work) => {
    event?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const requestCode = (event) =>
    execute(event, async () => {
      await postJson('/api/v1/users/email/request-code', { address, email })
      setStep('code')
    })

  const confirmCode = (event) =>
    execute(event, async () => {
      await postJson('/api/v1/users/email/confirm', { address, email, code })
      setMasked(email)
      setEnabled(true)
      setStep('verified')
      toast(`email verified — notifications on`, `success`)
    })

  const toggle = (next) =>
    execute(null, async () => {
      await postJson('/api/v1/users/email', { address, enabled: next }, 'PATCH')
      setEnabled(next)
    })

  const remove = (event) =>
    execute(event, async () => {
      await postJson('/api/v1/users/email', { address }, 'DELETE')
      setEmail('')
      setCode('')
      setMasked(null)
      setStep('input')
      toast(`email removed`, `success`)
    })

  if (!mounted) return null

  return (
    <div className={styles.emailNotif}>
      <header className={styles.emailNotif__header}>
        <span className={styles.emailNotif__icon}>
          <EnvelopeSimpleIcon size={22} />
        </span>
        <div>
          <h4 className={styles.emailNotif__title}>Email notifications</h4>
          <p className={styles.emailNotif__subtitle}>Get your Hup notifications as email digests.</p>
        </div>
      </header>

      {!isConnected && <p className={styles.emailNotif__hint}>Connect a wallet to set up email notifications.</p>}

      {isConnected && step === 'loading' && <p className={styles.emailNotif__hint}>Loading…</p>}

      {isConnected && step === 'input' && (
        <form className={styles.emailNotif__form} onSubmit={requestCode}>
          <p className={styles.emailNotif__hint}>
            We&rsquo;ll send a code to confirm the address before any notification email goes out.
          </p>
          <input
            className={styles.emailNotif__input}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button className={styles.emailNotif__submit} type="submit" disabled={busy || !email}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      )}

      {isConnected && step === 'code' && (
        <form className={styles.emailNotif__form} onSubmit={confirmCode}>
          <p className={styles.emailNotif__hint}>
            Enter the code sent to <strong>{email}</strong>
          </p>
          <input
            className={clsx(styles.emailNotif__input, styles['emailNotif__input--code'])}
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
            autoFocus
          />
          <button className={styles.emailNotif__submit} type="submit" disabled={busy || code.length !== 6}>
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          <button className={styles.emailNotif__link} type="button" onClick={requestCode} disabled={busy}>
            Resend code
          </button>
        </form>
      )}

      {isConnected && step === 'verified' && (
        <div className={styles.emailNotif__form}>
          <p className={styles.emailNotif__hint}>
            Verified: <strong>{masked}</strong>
          </p>
          <label className={styles.emailNotif__toggleRow}>
            <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
            <span>Send me notification digests</span>
          </label>
          <button className={styles.emailNotif__link} type="button" onClick={remove} disabled={busy}>
            Remove this email
          </button>
        </div>
      )}

      {error && <p className={styles.emailNotif__error}>{error}</p>}
    </div>
  )
}
