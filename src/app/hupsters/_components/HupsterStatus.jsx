'use client'

import { useState } from 'react'
import clsx from 'clsx'
import { useConnection, useSignMessage } from 'wagmi'
import { useProfile } from '@/hooks/useProfile'
import { openConnect } from '@/lib/connectDialog'
import { referralLink } from '@/lib/referral'
import { APPLICATION_MAX_LINKS, APPLICATION_MESSAGE_MAX, applicationMessage, HUPSTER_TAG, parseProofLinks, ROLES } from '@/lib/roles'
import styles from './HupstersIntro.module.scss'

/**
 * The viewer's own place in the program: connect, apply, wait, or — once in — the referral link
 * to share. EVM wallets only: applying is signed, and verifyWalletSignature reads EVM accounts.
 * @param {{isHupster: boolean, application: object|null}|null} props.viewer From /api/v1/hupsters.
 * @param {boolean} props.migrated Whether the roles table exists at all.
 * @param {() => void} props.onChange Re-reads the page data after an application.
 */
export default function HupsterStatus({ viewer, migrated, onChange }) {
  const { address, chainId } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const { profile } = useProfile(address)

  const [links, setLinks] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  const { label } = ROLES.ambassador

  if (!address) {
    return (
      <section className={styles.hupsters__panel}>
        <p>Connect your wallet to apply, or to get your referral link if you are already a {label}.</p>
        <button type="button" className={styles.hupsters__button} onClick={() => openConnect()}>
          Connect wallet
        </button>
      </section>
    )
  }

  if (!viewer) return null

  if (viewer.isHupster) {
    const link = referralLink(window.location.origin, { username: profile?.username, address })
    const copy = () =>
      navigator.clipboard.writeText(link).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })

    return (
      <section className={clsx(styles.hupsters__panel, styles['hupsters__panel--member'])}>
        <strong>You&apos;re a {label}. Share this link — everyone who joins through it and posts counts toward your rank.</strong>
        <div className={styles.hupsters__share}>
          <code className={styles['hupsters__share-link']}>{link}</code>
          <button type="button" className={styles.hupsters__button} onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <span className={styles.hupsters__note}>
          After you post somewhere else, post the link on Hup with #{HUPSTER_TAG} so the community can tip it.
        </span>
      </section>
    )
  }

  const application = viewer.application
  if (application?.status === 'pending') {
    return (
      <section className={styles.hupsters__panel}>
        <strong>Your application is in.</strong>
        <span className={styles.hupsters__note}>The team reviews every one by hand. You&apos;ll get a notification when you&apos;re in.</span>
      </section>
    )
  }

  // The server only sends reopensAt while the wait is still running
  if (application?.reopensAt) {
    return (
      <section className={styles.hupsters__panel}>
        <strong>Not this time.</strong>
        <span className={styles.hupsters__note}>
          Keep posting about Hup — you can apply again on {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(application.reopensAt)}.
        </span>
      </section>
    )
  }

  if (!migrated) return null

  const proof = parseProofLinks(links)

  const apply = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const nonceRes = await fetch('/api/v1/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: address }),
      })
      const { nonce } = await nonceRes.json()
      if (!nonce) throw new Error('Could not get a nonce')

      const signature = await signMessageAsync({ message: applicationMessage({ wallet: address, nonce }) })

      const res = await fetch('/api/v1/hupsters/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, links: proof, message, signature, nonce, chainId }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not send your application')

      onChange()
    } catch (err) {
      setError(err.shortMessage || err.message || 'Could not send your application')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={styles.hupsters__panel} onSubmit={apply}>
      <strong>Apply to be a {label}</strong>
      <span className={styles.hupsters__note}>Show us you&apos;re already doing it: link up to {APPLICATION_MAX_LINKS} posts you made about Hup.</span>

      <label className={styles.hupsters__field}>
        <span>Links, one per line</span>
        <textarea
          className={styles.hupsters__input}
          rows={3}
          value={links}
          onChange={(event) => setLinks(event.target.value)}
          placeholder="https://x.com/you/status/…"
          disabled={busy}
        />
      </label>

      <label className={styles.hupsters__field}>
        <span>Why you? (optional)</span>
        <textarea
          className={styles.hupsters__input}
          rows={2}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={APPLICATION_MESSAGE_MAX}
          disabled={busy}
        />
      </label>

      {error && <span className={clsx(styles.hupsters__note, styles['hupsters__note--error'])}>{error}</span>}

      <button type="submit" className={styles.hupsters__button} disabled={busy || proof.length === 0}>
        {busy ? 'Signing…' : 'Sign and apply'}
      </button>
    </form>
  )
}
