'use client'

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { useConnection, useSignMessage } from 'wagmi'
import Profile from '@/components/Profile'
import { PageLoader } from '@/components/Loading'
import { profileFallbackFromRow } from '@/hooks/useProfile'
import { formatRelativeTime } from '@/lib/collectionAuditFormat'
import { ROLES, roleMessage } from '@/lib/roles'
import styles from '../page.module.scss'

const ROLE = 'ambassador'

/**
 * Who wears the Hupster mark, and the form that gives or takes it. Roles live in the database,
 * not onchain, so every change is one admin signature and shows on the holder's next profile read.
 */
export default function RolesSection() {
  const { address, chainId } = useConnection()
  const { signMessageAsync } = useSignMessage()

  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [wallet, setWallet] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)

  const { label, description } = ROLES[ROLE]

  const read = useCallback(
    () =>
      fetch(`/api/v1/admin/roles?role=${ROLE}`, { cache: 'no-store' })
        .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
        .then(({ ok, json }) => {
          if (!ok || !json.success) throw new Error(json.error || 'Could not read role holders')
          setState(json.data)
          setError(null)
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false)),
    [],
  )

  useEffect(() => {
    read()
  }, [read])

  /**
   * Signs and sends one grant or revoke. `target` is sent exactly as signed — the server checks the
   * signature against it before resolving a handle to a wallet.
   */
  const submit = async (action, target) => {
    setBusy(`${action}:${target}`)
    setResult(null)

    try {
      const nonceRes = await fetch('/api/v1/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: address }),
      })
      const { nonce } = await nonceRes.json()
      if (!nonce) throw new Error('Could not get a nonce')

      const signature = await signMessageAsync({ message: roleMessage({ action, wallet: target, role: ROLE, nonce }) })

      const res = await fetch('/api/v1/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, wallet: target, role: ROLE, note: action === 'grant' ? note : undefined, signature, nonce, chainId }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not update the role')

      setResult({ ok: true, text: action === 'grant' ? `${label} given to ${json.data.wallet}.` : `${label} taken from ${json.data.wallet}.` })
      if (action === 'grant') {
        setWallet('')
        setNote('')
      }
      read()
    } catch (err) {
      setResult({ ok: false, text: err.shortMessage || err.message || 'Could not update the role' })
    } finally {
      setBusy(null)
    }
  }

  const target = wallet.trim()

  return (
    <section className={styles['admin-contracts__section']}>
      <header className={styles['admin-contracts__header']}>
        <h2 className={styles['admin-contracts__title']}>{label}s</h2>
        <p className={styles['admin-contracts__subtitle']}>
          {description}s wear a small megaphone beside their name. It is given here by hand and kept in the database, not onchain:
          taking it away removes the mark on the holder&apos;s next profile load.
        </p>
        {error && <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>{error}</div>}
      </header>

      {loading && !state ? (
        <PageLoader />
      ) : state && !state.migrated ? (
        <p className={styles['admin-contracts__empty']}>
          This database has no roles table yet. Run <code>cidex/scripts/add-user-roles.sql</code> first.
        </p>
      ) : state ? (
        <>
          <div className={styles['admin-contracts__edit-form']}>
            <div className={styles['admin-contracts__input-group']}>
              <label className={styles['admin-contracts__detail-label']} htmlFor="role-wallet">
                Wallet or @handle
              </label>
              <input
                id="role-wallet"
                type="text"
                className={styles['admin-contracts__input']}
                value={wallet}
                onChange={(event) => setWallet(event.target.value)}
                placeholder="0x… or @bouzu"
                disabled={busy !== null}
              />
            </div>
            <div className={styles['admin-contracts__input-group']}>
              <label className={styles['admin-contracts__detail-label']} htmlFor="role-note">
                Note (optional, only admins see it)
              </label>
              <input
                id="role-note"
                type="text"
                className={styles['admin-contracts__input']}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why — e.g. daily posts on X"
                maxLength={255}
                disabled={busy !== null}
              />
            </div>
            <div className={styles['admin-contracts__actions']}>
              <button
                type="button"
                className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                onClick={() => submit('grant', target)}
                disabled={!target || !address || busy !== null}
              >
                {busy === `grant:${target}` ? 'Signing…' : `Give ${label}`}
              </button>
            </div>
            {result && (
              <div
                className={clsx(
                  styles['admin-contracts__validation'],
                  result.ok ? styles['admin-contracts__validation--success'] : styles['admin-contracts__validation--error'],
                )}
              >
                {result.text}
              </div>
            )}
          </div>

          <div className={styles['admin-contracts__card']}>
            <div className={styles['admin-contracts__card-header']}>
              <h3 className={styles['admin-contracts__card-title']}>Current {label}s</h3>
              <span className={styles['admin-contracts__badge']}>{state.holders.length}</span>
            </div>

            {state.holders.length === 0 ? (
              <p className={styles['admin-contracts__empty']}>Nobody has the mark yet.</p>
            ) : (
              <ul className={styles['admin-contracts__list']}>
                {state.holders.map((holder) => (
                  <li key={holder.wallet_address} className={styles['admin-contracts__list-row']}>
                    <Profile creator={holder.wallet_address} variant="fullWithoutTime" size={32} hoverCard={false} fallback={profileFallbackFromRow(holder)} />
                    <span className={styles['admin-contracts__detail-label']} title={holder.note ?? undefined}>
                      {holder.note ? `${holder.note} · ` : ''}
                      {formatRelativeTime(holder.grantedAt) ?? '—'}
                    </span>
                    <button
                      type="button"
                      className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                      onClick={() => submit('revoke', holder.wallet_address)}
                      disabled={!address || busy !== null}
                    >
                      {busy === `revoke:${holder.wallet_address}` ? 'Signing…' : 'Revoke'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}
