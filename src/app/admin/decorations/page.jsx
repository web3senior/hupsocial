/* @file app/admin/decorations/page.jsx */
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR, { useSWRConfig } from 'swr'
import clsx from 'clsx'
import { useConnection, useSignMessage } from 'wagmi'
import PageTitle from '@/components/PageTitle'
import { ContentSpinner, Spinner } from '@/components/Loading'
import Avatar from '@/components/ui/Avatar'
import { useProfile } from '@/hooks/useProfile'
import { DECORATION_CATALOG_KEY } from '@/hooks/useDecorationCatalog'
import { requestAuthNonce } from '@/lib/api'
import { shortAddress } from '@/lib/address'
import { DECORATION_SLOTS, SLOT_LABELS } from '@/config/decorations'
import { decorationSettingMessage, MAX_PRICE_USD } from '@/lib/decorationSettings'
import useAdminPass from '../_components/useAdminPass'
import styles from './page.module.scss'

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.toLowerCase()
const ADMIN_KEY = '/api/v1/admin/decorations'

const usd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' })
const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

const FILTERS = [{ value: 'all', label: 'All' }, ...DECORATION_SLOTS.map((slot) => ({ value: slot, label: SLOT_LABELS[slot] }))]

/**
 * The admin's decoration manager: every decoration with its live price, profile-only switch and
 * shop listing, each change signed by the admin wallet; plus what the shop has sold. Changes reach
 * every avatar within the catalog's short cache — no deploy.
 */
export default function DecorationsAdminPage() {
  const { address, isConnected } = useConnection()
  const isAdmin = isConnected && address?.toLowerCase() === ADMIN_WALLET
  const adminPass = useAdminPass(isAdmin ? address : undefined)
  const { profile } = useProfile(isAdmin ? address : undefined)
  const { data, error, mutate } = useSWR(isAdmin && adminPass.unlocked ? ADMIN_KEY : null, adminPass.adminFetch)
  const [filter, setFilter] = useState('all')

  const items = useMemo(() => (data?.items ?? []).filter((item) => filter === 'all' || item.slot === filter), [data, filter])

  const gate = (content) => (
    <>
      <PageTitle name="Decorations" />
      <div className={styles.decorationsAdmin}>
        <div className={styles.decorationsAdmin__gate}>{content}</div>
      </div>
    </>
  )

  if (!isConnected) return gate(<p>Connect your wallet to continue.</p>)
  if (!isAdmin) return gate(<p>You do not have permission to access this page.</p>)
  if (!adminPass.unlocked) {
    return gate(
      <>
        <p>Sign once with the admin wallet to open this page. The pass lasts 8 hours in this tab.</p>
        <button type="button" className={styles.decorationsAdmin__primary} onClick={adminPass.unlock} disabled={adminPass.signing}>
          {adminPass.signing ? 'Signing…' : 'Sign to continue'}
        </button>
        {adminPass.error && <p className={styles.decorationsAdmin__error}>{adminPass.error}</p>}
      </>
    )
  }

  const sales = data?.sales
  const listed = data ? data.items.filter((item) => item.listed).length : 0
  const paid = data ? data.items.filter((item) => item.priceUsd > 0).length : 0

  return (
    <>
      <PageTitle name="Decorations" />
      <div className={styles.decorationsAdmin}>
        <header className={styles.decorationsAdmin__header}>
          <div>
            <Link href="/admin" className={styles.decorationsAdmin__back}>← Admin</Link>
            <h1 className={styles.decorationsAdmin__title}>Avatar decorations</h1>
            <p className={styles.decorationsAdmin__lede}>
              Set prices, keep loud pieces out of feeds, and take decorations in or out of the shop. Each save is signed by the admin wallet and reaches every avatar within a minute.
            </p>
          </div>
        </header>

        {error && <p className={styles.decorationsAdmin__error}>{error.message}</p>}
        {!data && !error && <ContentSpinner />}

        {data && (
          <>
            <section className={styles.decorationsAdmin__stats} aria-label="Shop summary">
              <Stat label="Revenue" value={usd.format(sales.revenueUsd)} />
              <Stat label="Sales" value={sales.orders} />
              <Stat label="Paid decorations" value={`${paid} / ${data.items.length}`} />
              <Stat label="In shop" value={`${listed} / ${data.items.length}`} />
            </section>
            {!sales.migrated && <p className={styles.decorationsAdmin__note}>The shop tables are missing: run 20261104-decoration-shop.sql to start selling.</p>}

            <div className={styles.decorationsAdmin__filters} role="group" aria-label="Slot">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  className={clsx(styles.decorationsAdmin__filter, filter === option.value && styles['decorationsAdmin__filter--active'])}
                  onClick={() => setFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <ul className={styles.decorationsAdmin__list}>
              {items.map((item) => (
                <DecorationRow key={item.id} item={item} sold={sales.counts[item.id] ?? 0} profileImage={profile?.profileImage} onSaved={mutate} />
              ))}
            </ul>

            {sales.recent.length > 0 && (
              <section className={styles.decorationsAdmin__recent}>
                <h2 className={styles.decorationsAdmin__subtitle}>Latest sales</h2>
                <ul>
                  {sales.recent.map((sale) => (
                    <li key={sale.id} className={styles.decorationsAdmin__sale}>
                      <span>{sale.decorationIds.map((id) => data.items.find((item) => item.id === id)?.name ?? id).join(' + ')}</span>
                      <span>{usd.format(sale.priceUsd)}</span>
                      <Link href={`/${sale.recipient}`}>{shortAddress(sale.recipient)}</Link>
                      <span className={styles.decorationsAdmin__muted}>{when.format(new Date(sale.paidAt * 1000))}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </>
  )
}

const Stat = ({ label, value }) => (
  <div className={styles.decorationsAdmin__stat}>
    <span className={styles.decorationsAdmin__muted}>{label}</span>
    <strong>{value}</strong>
  </div>
)

/** One decoration's controls. Edits stay local until Save, which signs exactly what is shown. */
function DecorationRow({ item, sold, profileImage, onSaved }) {
  const { address, chainId } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const { mutate: mutateGlobal } = useSWRConfig()
  const [price, setPrice] = useState(String(item.priceUsd))
  const [profileOnly, setProfileOnly] = useState(item.profileOnly)
  const [listed, setListed] = useState(item.listed)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const priceUsd = Number(price)
  const priceValid = price.trim() !== '' && Number.isFinite(priceUsd) && priceUsd >= 0 && priceUsd <= MAX_PRICE_USD
  const dirty = priceUsd !== item.priceUsd || profileOnly !== item.profileOnly || listed !== item.listed

  const submit = async (change) => {
    setBusy(true)
    setResult(null)
    try {
      const nonce = await requestAuthNonce(address)
      if (!nonce) throw new Error('Could not get a nonce')
      const fields = { decorationId: item.id, ...change }
      const signature = await signMessageAsync({ message: decorationSettingMessage({ ...fields, nonce }) })
      const response = await fetch(ADMIN_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, nonce, signature, chainId }),
      })
      const json = await response.json()
      if (!json.success) throw new Error(json.error)
      setPrice(String(json.data.priceUsd))
      setProfileOnly(json.data.profileOnly)
      setListed(json.data.listed)
      setResult({ ok: true, text: change.reset ? 'Reset to catalog' : 'Saved' })
      onSaved()
      mutateGlobal(DECORATION_CATALOG_KEY)
    } catch (error) {
      setResult({ ok: false, text: error.shortMessage || error.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={clsx(styles.decorationsAdmin__row, !listed && styles['decorationsAdmin__row--unlisted'])}>
      <div className={styles.decorationsAdmin__preview}>
        <Avatar src={profileImage} size={64} decorations={{ [item.slot]: item.id }} className="rounded-full" />
      </div>

      <div className={styles.decorationsAdmin__identity}>
        <strong>{item.name}</strong>
        <span className={styles.decorationsAdmin__muted}>
          {SLOT_LABELS[item.slot]} · {sold} sold{item.overridden ? ' · edited' : ''}
        </span>
      </div>

      <label className={styles.decorationsAdmin__price}>
        <span>Price</span>
        <span className={styles.decorationsAdmin__money}>
          $
          <input
            type="number"
            inputMode="decimal"
            min="0"
            max={MAX_PRICE_USD}
            step="0.5"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            disabled={busy}
            aria-invalid={!priceValid}
          />
        </span>
        <span className={styles.decorationsAdmin__muted}>{priceUsd > 0 ? 'Paid' : 'Free'}</span>
      </label>

      <label className={styles.decorationsAdmin__toggle}>
        <input type="checkbox" checked={profileOnly} onChange={(event) => setProfileOnly(event.target.checked)} disabled={busy} />
        <span>Profile only</span>
      </label>

      <label className={styles.decorationsAdmin__toggle}>
        <input type="checkbox" checked={listed} onChange={(event) => setListed(event.target.checked)} disabled={busy} />
        <span>In shop</span>
      </label>

      <div className={styles.decorationsAdmin__actions}>
        <button
          type="button"
          className={styles.decorationsAdmin__primary}
          onClick={() => submit({ priceUsd, profileOnly, listed })}
          disabled={busy || !dirty || !priceValid}
        >
          {busy ? <><Spinner size={14} color="currentColor" /> Signing…</> : 'Save'}
        </button>
        {item.overridden && (
          <button type="button" className={styles.decorationsAdmin__secondary} onClick={() => submit({ reset: true })} disabled={busy}>
            Reset
          </button>
        )}
        {result && (
          <span className={clsx(styles.decorationsAdmin__result, !result.ok && styles['decorationsAdmin__result--error'])}>{result.text}</span>
        )}
      </div>
    </li>
  )
}
