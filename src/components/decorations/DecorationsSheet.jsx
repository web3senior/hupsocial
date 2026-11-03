'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import clsx from 'clsx'
import { useConfig, useConnection, useSignMessage } from 'wagmi'
import { sendTransaction, switchChain, waitForTransactionReceipt } from 'wagmi/actions'
import { lukso } from 'wagmi/chains'
import { ArrowCounterClockwiseIcon, CaretDownIcon, LockSimpleIcon, LockSimpleOpenIcon, XIcon } from '@phosphor-icons/react'
import { Spinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import DialogSheet from '@/components/ui/DialogSheet'
import Avatar from '@/components/ui/Avatar'
import { DECORATION_ART } from './Decorations'
import { requestAuthNonce } from '@/lib/api'
import { normalizeAddress } from '@/lib/address'
import { DECORATION_SLOTS, decorationLabel, isPaid, isProfileOnly, normalizeDecorations, SLOT_LABELS } from '@/config/decorations'
import { useDecorationCatalog } from '@/hooks/useDecorationCatalog'
import { userDecorationsMessage } from '@/lib/userDecorations'
import styles from './DecorationsSheet.module.scss'

/* Large enough that every slot draws in the preview — wings start at 64px */
const PREVIEW_SIZE = 104

/* Paid orders whose confirm has not landed yet, kept so the next open can finish them. The money
   has already moved by the time one is written, so losing it would lose a purchase. */
const PENDING_KEY = 'hup:decoration-orders'
// The server reads the transfer through its own RPC, which can trail the wallet's by a few blocks
const CONFIRM_ATTEMPTS = 6
const CONFIRM_RETRY_MS = 2500

const usd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

const sameSet = (a, b) => DECORATION_SLOTS.every((slot) => (a?.[slot] ?? null) === (b?.[slot] ?? null))

/** Names also support pending orders created by the earlier bundled checkout. */
const namesOf = (items) => items.map((item) => item.name).join(' + ')

const readPending = () => {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

const writePending = (list) => {
  try {
    if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list))
    else localStorage.removeItem(PENDING_KEY)
  } catch {
    // Private mode: the purchase still confirms now, it just cannot be resumed later
  }
}

const postJson = async (url, body) => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  return { status: response.status, ok: response.ok && result.success, data: result.data, error: result.error }
}

/**
 * Confirms a paid order, waiting out the server's RPC catching up to the transfer.
 * @returns {Promise<{ok: boolean, retry: boolean, data?: Object, error?: string}>} `retry` when the
 *   transfer simply is not visible yet, so the order should be kept for later.
 */
const confirmOrder = async ({ orderId, txHash }) => {
  let last = null
  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
    last = await postJson('/api/v1/users/decorations/confirm', { orderId, txHash })
    if (last.ok) return { ok: true, retry: false, data: last.data }
    if (last.status !== 404 && last.status < 500) return { ok: false, retry: false, error: last.error }
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_RETRY_MS))
  }
  return { ok: false, retry: true, error: last?.error }
}

/**
 * The sheet where the connected wallet picks its avatar decorations, one per slot, previewed on its
 * own picture. Opened through the ref (`open()`), seeded from `decorations`; `onSaved` receives the
 * stored set. Offchain like Status: the wallet signs the whole set and the server stores it.
 *
 * Priced decorations preview like any other but must be unlocked before saving.
 * A batch unlock is a paid coin transfer to the treasury, confirmed by the server onchain. Like agent
 * credits, any Hup mainnet's own coin pays: the buyer picks the network, starting from the one
 * they are connected to (LUKSO when that one is not accepted).
 */
const DecorationsSheet = forwardRef(function DecorationsSheet({ decorations, profileImage, onSaved }, ref) {
  const dialogRef = useRef(null)
  const [draft, setDraft] = useState({})
  const [owned, setOwned] = useState(() => new Set())
  // null, 'saving', or the purchase step on screen
  const [busy, setBusy] = useState(null)
  const config = useConfig()
  const { address, chain } = useConnection()
  const { signMessageAsync } = useSignMessage()

  /* The catalog as the admin has it (prices, profile-only, in shop). The shop shows what is listed,
     plus anything this wallet owns or already wears — delisting never hides someone's own piece. */
  const catalog = useDecorationCatalog()
  const findDecoration = (id) => catalog.get(id)
  const worn = Object.values(decorations ?? {})
  const shown = [...catalog.values()].filter((item) => item.listed || owned.has(item.id) || worn.includes(item.id))

  /* Every network whose own coin the shop accepts — the server's rule (lib/onchainPayment.js) */
  const payChains = config.chains.filter((item) => !item.testnet)
  const defaultPayChainId = payChains.some((item) => item.id === chain?.id) ? chain.id : lukso.id
  const [payChainId, setPayChainId] = useState(defaultPayChainId)
  const payChain = payChains.find((item) => item.id === payChainId) ?? lukso

  /* Owned decorations, then any purchase a previous visit paid for but never saw confirmed */
  const load = async (owner) => {
    try {
      const response = await fetch(`/api/v1/users/decorations?address=${encodeURIComponent(owner)}`, { cache: 'no-store' })
      const result = await response.json()
      if (result?.success) setOwned(new Set(result.data.owned))
    } catch {
      // The shop being unreachable only hides ownership; free decorations still work
    }

    const pending = readPending()
    if (!pending.length) return
    const remaining = []
    for (const order of pending) {
      const result = await confirmOrder(order)
      if (result.ok) {
        setOwned(new Set(result.data.owned))
        toast(`${namesOf(result.data.decorationIds.map(findDecoration).filter(Boolean))} unlocked`, 'success')
      } else if (result.retry) {
        remaining.push(order)
      }
    }
    writePending(remaining)
  }

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setDraft(normalizeDecorations(decorations))
        setPayChainId(defaultPayChainId)
        if (address) load(normalizeAddress(address))
        dialogRef.current?.open()
      },
      close: () => dialogRef.current?.close(),
    }),
    [decorations, address, defaultPayChainId]
  )

  const close = () => {
    if (!busy) dialogRef.current?.close()
  }

  const pick = (slot, id) => setDraft((current) => {
    const next = { ...current }
    if (id) next[slot] = id
    else delete next[slot]
    return next
  })

  const reset = () => setDraft(normalizeDecorations(decorations))

  const save = async () => {
    if (busy || locked.length > 0) return
    if (!address) {
      toast('Connect your wallet to decorate your avatar', 'error')
      return
    }

    setBusy('saving')
    try {
      const owner = normalizeAddress(address)
      const nonce = await requestAuthNonce(owner)
      if (!nonce) throw new Error('Could not start wallet verification')
      const signed = { address: owner, equipped: draft, nonce, issuedAt: Date.now(), chainId: chain?.id }
      const signature = await signMessageAsync({ account: address, message: userDecorationsMessage(signed) })
      const result = await postJson('/api/v1/users/decorations', { ...signed, signature })
      if (!result.ok) throw new Error(result.error || 'Failed to save decorations')
      onSaved?.(result.data)
      dialogRef.current?.close()
      toast('Avatar decorations saved', 'success')
    } catch (error) {
      toast(error.shortMessage || error.message || 'Failed to save decorations', 'error')
    } finally {
      setBusy(null)
    }
  }

  /* Selected locked decorations share one quote and payment. */
  const unlock = async (items) => {
    if (busy) return
    if (!address) {
      toast('Connect your wallet to unlock decorations', 'error')
      return
    }

    let order = null
    try {
      setBusy('Pricing…')
      const quote = await postJson('/api/v1/users/decorations/quote', {
        buyer: normalizeAddress(address),
        decorationIds: items.map((item) => item.id),
        chainId: payChain.id,
      })
      if (!quote.ok) throw new Error(quote.error || 'Could not price that decoration')
      const { orderId, to, amountWei, chainId } = quote.data

      setBusy('Confirm in wallet…')
      if (chain?.id !== chainId) await switchChain(config, { chainId })
      const txHash = await sendTransaction(config, { account: address, to, value: BigInt(amountWei), chainId })

      // Paid from here on: remember the order before anything else can fail
      order = { orderId, txHash }
      writePending([...readPending(), order])

      setBusy('Confirming…')
      await waitForTransactionReceipt(config, { chainId, hash: txHash })
      const result = await confirmOrder(order)
      if (result.retry) {
        toast('Payment sent. It will be confirmed the next time you open this sheet.', 'info')
        return
      }
      writePending(readPending().filter((entry) => entry.orderId !== orderId))
      if (!result.ok) throw new Error(result.error || 'Could not confirm that unlock')
      setOwned(new Set(result.data.owned))
      toast(`${namesOf(items)} unlocked. Save to wear your selection.`, 'success')
    } catch (error) {
      const declined = /reject|denied|cancel/i.test(`${error?.shortMessage || ''} ${error?.message || ''}`)
      toast(declined ? 'You declined in the wallet' : error.shortMessage || error.message || 'Unlock failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  const locked = DECORATION_SLOTS.map((slot) => findDecoration(draft[slot])).filter((item) => isPaid(item) && !owned.has(item.id))
  const lockedTotal = locked.reduce((total, item) => total + item.priceUsd, 0)
  const unchanged = sameSet(draft, normalizeDecorations(decorations))

  return (
    <DialogSheet
      ref={dialogRef}
      className={styles.decorations__dialog}
      aria-label="Decorate your avatar"
      lightDismiss={!busy}
      swipeDismiss={!busy}
      onCancel={(event) => {
        event.stopPropagation()
        if (busy) event.preventDefault()
      }}
      onClose={(event) => event.stopPropagation()}
    >
      <DialogSheet.Header
        title="Decorate your avatar"
        description="Pick one per category, preview it live, then save to wear it."
        onClose={busy ? undefined : close}
        bordered
      />
      <DialogSheet.Body>
        <div className={styles.decorations__layout}>
          <aside className={styles.decorations__aside} aria-label="Preview">
            <div className={styles.decorations__stage}>
              <Avatar className={styles.decorations__avatar} src={profileImage} size={PREVIEW_SIZE} decorations={draft} loading="eager" />
            </div>
            <div className={styles.decorations__summary}>
              <div className={styles.decorations__summaryHead}>
                <strong>Your look</strong>
                <button type="button" className={styles.decorations__reset} onClick={reset} disabled={Boolean(busy) || unchanged}>
                  <ArrowCounterClockwiseIcon size={12} weight="bold" aria-hidden="true" />
                  Reset
                </button>
              </div>
              <ul className={styles.decorations__equipped}>
                {DECORATION_SLOTS.map((slot) => {
                  const item = findDecoration(draft[slot])
                  return (
                    <li key={slot} className={clsx(styles.decorations__equippedRow, !item && styles['decorations__equippedRow--empty'])}>
                      <span className={styles.decorations__equippedSlot}>{SLOT_LABELS[slot]}</span>
                      <span className={styles.decorations__equippedName}>
                        {item && isPaid(item) && !owned.has(item.id) && <LockSimpleIcon size={11} weight="bold" aria-label="Locked" />}
                        {item?.name ?? 'None'}
                      </span>
                      {item && (
                        <button
                          type="button"
                          className={styles.decorations__remove}
                          onClick={() => pick(slot, null)}
                          disabled={Boolean(busy)}
                          aria-label={`Remove ${item.name}`}
                        >
                          <XIcon size={11} weight="bold" aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
              <p className={styles.decorations__hint}>Profile-only effects appear on your profile and hover card.</p>
            </div>
          </aside>

          <div className={styles.decorations__options}>
            {DECORATION_SLOTS.map((slot) => {
              const items = shown.filter((item) => item.slot === slot)
              if (!items.length) return null
              const labelId = `decorations-${slot}`
              const current = findDecoration(draft[slot])
              return (
                <section key={slot} className={styles.decorations__slot}>
                  <div className={styles.decorations__slotHead}>
                    <span id={labelId} className={styles.decorations__label}>{SLOT_LABELS[slot]}</span>
                    <span className={styles.decorations__current}>{current?.name ?? 'None'}</span>
                  </div>
                  <div className={styles.decorations__chips} role="group" aria-labelledby={labelId}>
                    {[{ id: null, name: 'None' }, ...items].map((item) => {
                      const active = (draft[slot] ?? null) === item.id
                      const forSale = item.id && isPaid(item) && !owned.has(item.id)
                      const notes = [item.id && isPaid(item) && (forSale ? usd.format(item.priceUsd) : 'Unlocked'), item.id && isProfileOnly(item) && 'Profile only'].filter(Boolean)
                      const Art = DECORATION_ART[item.id]
                      return (
                        <div key={item.id ?? 'none'} className={clsx(styles.decorations__card, active && styles['decorations__card--active'])}>
                          <button
                            type="button"
                            aria-pressed={active}
                            className={styles.decorations__chip}
                            onClick={() => pick(slot, item.id)}
                            disabled={Boolean(busy)}
                          >
                            {item.id && <span className={styles.decorations__tier} data-tier={decorationLabel(item).toLowerCase()}>{decorationLabel(item)}</span>}
                            {slot === 'effect' && (
                              <span className={styles.decorations__art} aria-hidden="true">
                                <Avatar className={styles.decorations__avatar} src={profileImage} size={44} decorations={{}} />
                                {Art && <span className={styles.decorations__artLayer}><Art /></span>}
                              </span>
                            )}
                            <span className={styles.decorations__name}>
                              {isPaid(item) && (forSale
                                ? <LockSimpleIcon size={12} weight="bold" aria-hidden="true" />
                                : <LockSimpleOpenIcon size={12} weight="bold" aria-hidden="true" />)}
                              {item.name}
                            </span>
                            {notes.length > 0 && <span className={styles.decorations__scope}>{notes.join(' · ')}</span>}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      </DialogSheet.Body>
      <DialogSheet.Footer>
        <div className={styles.decorations__checkout}>
          {locked.length > 0 && (
            <>
              <div className={styles.decorations__purchase}>
                <div className={styles.decorations__basket} aria-label="Selected decorations to unlock">
                  <span className={styles.decorations__summaryLabel}>Your selection</span>
                  {locked.map((item) => (
                    <span key={item.id} className={styles.decorations__basketItem}>
                      <LockSimpleIcon size={14} aria-hidden="true" />
                      <span>{item.name}</span>
                      <strong>{usd.format(item.priceUsd)}</strong>
                    </span>
                  ))}
                </div>
                <div className={styles.decorations__total}>
                  <span>Total</span>
                  <strong>{usd.format(lockedTotal)} <small>USD</small></strong>
                </div>
                <label className={styles.decorations__payWith}>
                  <span>Pay with</span>
                  <span className={styles.decorations__networkControl}>
                    <select
                      className={styles.decorations__network}
                      value={payChain.id}
                      onChange={(event) => setPayChainId(Number(event.target.value))}
                      disabled={Boolean(busy)}
                      aria-label="Network to pay on"
                    >
                      {payChains.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.nativeCurrency.symbol} · {item.name}
                        </option>
                      ))}
                    </select>
                    <CaretDownIcon size={14} aria-hidden="true" />
                    </span>
                </label>
              </div>
              <p className={styles.decorations__note}>
                One payment in {payChain.nativeCurrency.symbol} on {payChain.name}. Yours to wear for good.
              </p>
            </>
          )}
          {locked.length > 0 ? (
            <button type="button" className={styles.decorations__save} onClick={() => unlock(locked)} disabled={Boolean(busy)}>
              {busy ? <><Spinner size={16} color="currentColor" /> {busy}</> : `Unlock ${locked.length} ${locked.length === 1 ? 'decoration' : 'decorations'} · ${usd.format(lockedTotal)}`}
            </button>
          ) : (
            <button type="button" className={styles.decorations__save} onClick={save} disabled={Boolean(busy) || unchanged}>
              {busy === 'saving' ? <><Spinner size={16} color="currentColor" /> Signing…</> : 'Save'}
            </button>
          )}
        </div>
      </DialogSheet.Footer>
    </DialogSheet>
  )
})

export default DecorationsSheet
