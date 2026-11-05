'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import { useConnection, useSignMessage } from 'wagmi'
import { ACHIEVEMENTS, achievementById } from '@/config/achievements'
import { POINTS_SEASONS } from '@/config/points'
import { achievementAdminMessage } from '@/lib/achievements'
import { requestAuthNonce } from '@/lib/api'
import { shortAddress } from '@/lib/address'
import { Spinner } from '@/components/Loading'
import { useSWRConfig } from 'swr'
import { achievementSettingMessage } from '@/lib/achievementSettings'
import AchievementSettingsEditor from './AchievementSettingsEditor'
import styles from './AchievementsSection.module.scss'

export default function AchievementsSection() {
  const { address, chainId } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const { mutate } = useSWRConfig()
  const [catalog, setCatalog] = useState(ACHIEVEMENTS)
  const [id, setId] = useState('early-tester')
  const [season, setSeason] = useState(String(POINTS_SEASONS[0].id))
  const [wallet, setWallet] = useState('')
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [holders, setHolders] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [revision, setRevision] = useState(0)
  const item = catalog.find((entry) => entry.id === id)
  const scope = item.perSeason ? season : ''

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    fetch(`/api/v1/admin/achievements?${new URLSearchParams({ id, scope })}`, { cache: 'no-store', signal })
      .then(async (response) => {
        const json = await response.json()
        if (!response.ok || !json.success) throw new Error(json.error || 'Could not read holders')
        if (!signal.aborted) { setHolders(json.data.holders); setCatalog(json.data.catalog); setError(null) }
      })
      .catch((err) => { if (!signal.aborted) { setError(err.message); setHolders([]) } })
      .finally(() => { if (!signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, scope, revision])

  const submit = async (action, target = '', all = false, setting = null) => {
    setBusy(true)
    setResult(null)
    try {
      const nonce = await requestAuthNonce(address)
      if (!nonce) throw new Error('Could not get a nonce')
      const claim = setting ? { ...setting, nonce, chainId } : { action, wallet: target, id: all ? null : id, scope: action === 'run' ? '' : scope, note: action === 'grant' ? note : '', notify, nonce, chainId }
      const signature = await signMessageAsync({ message: setting ? achievementSettingMessage(claim, nonce) : achievementAdminMessage(claim) })
      const response = await fetch('/api/v1/admin/achievements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...claim, signature }) })
      const json = await response.json()
      if (!response.ok || !json.success) throw new Error(json.error || 'Could not update achievements')
      if (setting) {
        setCatalog(json.data.catalog)
        await mutate('achievements:catalog')
      }
      const text = setting ? 'Achievement settings saved.' : action === 'run' ? `New awards: ${Object.entries(json.data).map(([key, count]) => `${catalog.find((entry) => entry.id === key)?.name || achievementById(key)?.name}: ${count}`).join(', ')}`
        : action === 'grant' ? (json.data.inserted.length ? 'Achievement granted.' : 'Wallet already holds this achievement.')
          : (json.data.revoked ? 'Achievement revoked.' : 'Wallet did not hold this achievement.')
      setResult(text)
      setError(null)
      setLoading(true)
      setRevision((value) => value + 1)
    } catch (err) {
      setError(err.shortMessage || err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.achievementsAdmin}>
      <h2>Achievements</h2>
      <p>Permanent milestones. Only admin-granted awards can be revoked. Rule awards remain with their holders.</p>
      <fieldset disabled={busy} className={styles.achievementsAdmin__form}>
        <label htmlFor="achievement-id">Achievement</label>
        <select id="achievement-id" value={id} onChange={(event) => { setLoading(true); setId(event.target.value) }}>{catalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.kind}{entry.listed === false ? ' · hidden' : ''}</option>)}</select>
        {item.perSeason && <><label htmlFor="achievement-season">Season</label><select id="achievement-season" value={season} onChange={(event) => { setLoading(true); setSeason(event.target.value) }}>{POINTS_SEASONS.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></>}
        <label htmlFor="achievement-wallet">Wallet address</label>
        <input id="achievement-wallet" value={wallet} onChange={(event) => setWallet(event.target.value)} placeholder="0x…" />
        <label htmlFor="achievement-note">Note (optional)</label>
        <input id="achievement-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={255} />
        <label className={styles.achievementsAdmin__checkbox}><input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />Send notifications</label>
        {/* The scheduler keeps a rule's first run silent on its own; a run from here does what the
            box says, so a manual backfill has to be unticked to stay quiet. */}
        <p className={styles.achievementsAdmin__hint}>Running a rule for the first time awards everyone who already qualifies. Untick this to backfill without notifying them.</p>
        <div className={styles.achievementsAdmin__actions}>
          <button type="button" disabled={!wallet.trim() || !address} onClick={() => submit('grant', wallet.trim())}>Grant achievement</button>
          {item.kind === 'auto' && <button type="button" disabled={!address} onClick={() => submit('run')}>Run this rule now</button>}
          <button type="button" disabled={!address} onClick={() => submit('run', '', true)}>Run all rules now</button>
        </div>
      </fieldset>
      {!loading && <AchievementSettingsEditor key={JSON.stringify(item)} item={item} disabled={busy || !address}
        onSave={(setting) => submit(setting.action, '', false, setting)} />}
      {busy && <Spinner size={20} label="Signing and updating achievements" />}
      {error && <p role="alert" className={styles.achievementsAdmin__error}>{error}</p>}
      {result && <p role="status">{result}</p>}
      <h3>Holders {holders.length ? `(${holders.length}${holders.length === 500 ? '+' : ''})` : ''}</h3>
      {loading ? <Spinner size={20} /> : !holders.length ? <p>No holders in this scope.</p> : <ul className={styles.achievementsAdmin__holders}>
        {holders.map((holder) => <li key={holder.wallet} className={styles.achievementsAdmin__holder}>
          <Link href={`/${holder.username ? `@${holder.username}` : holder.wallet}`}>{holder.name || shortAddress(holder.wallet)}</Link>
          <span>{holder.source} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(holder.awardedAt))}</span>
          {holder.grantedBy && <span title={holder.grantedBy}>Granted by {shortAddress(holder.grantedBy)}</span>}
          {holder.note && <span>{holder.note}</span>}
          <button type="button" className={clsx(styles.achievementsAdmin__revoke)} disabled={busy || holder.source !== 'admin'} onClick={() => submit('revoke', holder.wallet)}>Revoke</button>
        </li>)}
      </ul>}
    </section>
  )
}
