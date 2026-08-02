'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { formatEther, hexToString, isHex } from 'viem'
import { WarningIcon, XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import NativeDialog from './ui/NativeDialog'
import styles from './MiniAppTxDialog.module.scss'

/**
 * Confirmation surface for anything a mini app asks the viewer to sign.
 *
 * The frame is untrusted, so this dialog never renders text the app supplied about what it is
 * doing — only what the request itself contains: the contract being called, the value being
 * moved, and the raw payload. The app names the target; it does not get to narrate the outcome.
 */
const MiniAppTxDialog = forwardRef(function MiniAppTxDialog(props, ref) {
  const dialogRef = useRef(null)
  const [request, setRequest] = useState(null)
  const [isBusy, setIsBusy] = useState(false)
  const resolverRef = useRef(null)

  useImperativeHandle(ref, () => ({
    /**
     * Presents a request and resolves once the user decides. Rejecting with code 4001 is what
     * the bridge translates into a standard EIP-1193 user-rejection.
     */
    confirm: (pendingRequest) =>
      new Promise((resolve, reject) => {
        resolverRef.current = { resolve, reject }
        setRequest(pendingRequest)
        setIsBusy(false)
        dialogRef.current?.open()
      }),
    close: () => dialogRef.current?.close(),
  }))

  const settle = (fn) => {
    const resolver = resolverRef.current
    resolverRef.current = null
    setRequest(null)
    dialogRef.current?.close()
    fn?.(resolver)
  }

  const reject = () => {
    settle((resolver) => {
      const err = new Error('User rejected the request')
      err.code = 4001
      resolver?.reject(err)
    })
  }

  const approve = async () => {
    if (!request) return
    setIsBusy(true)
    try {
      const result = await request.execute()
      settle((resolver) => resolver?.resolve(result))
    } catch (err) {
      setIsBusy(false)
      settle((resolver) => resolver?.reject(err))
    }
  }

  const details = describeRequest(request)

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.txDialog}
      aria-label="Confirm mini app request"
      onClick={(e) => e.stopPropagation()}
      onCancel={(e) => {
        // Esc is a decline, not a dismissal — the caller is awaiting an answer either way
        e.preventDefault()
        if (!isBusy) reject()
      }}
      onClose={(e) => e.stopPropagation()}
    >
      <div className={styles.txDialog__body}>
        <header className={styles.txDialog__header}>
          <h3>{details.title}</h3>
          <button type="button" onClick={reject} disabled={isBusy} aria-label="Reject" className={styles.txDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        <p className={styles.txDialog__source}>
          Requested by <strong>{request?.app?.name || 'a mini app'}</strong>
        </p>

        <dl className={styles.txDialog__facts}>
          {details.rows.map((row) => (
            <div key={row.label} className={styles.txDialog__fact}>
              <dt>{row.label}</dt>
              <dd className={clsx(row.mono && styles['txDialog__fact--mono'], row.emphasis && styles['txDialog__fact--emphasis'])}>{row.value}</dd>
            </div>
          ))}
        </dl>

        {details.payload && (
          <details className={styles.txDialog__payload}>
            <summary>Raw {details.payloadLabel}</summary>
            <pre>{details.payload}</pre>
          </details>
        )}

        <p className={styles.txDialog__warning}>
          <WarningIcon size={14} />
          <span>Mini apps are third-party code. Approve only if you understand what this does — it moves real funds.</span>
        </p>

        <div className={styles.txDialog__actions}>
          <button type="button" onClick={reject} disabled={isBusy} className={styles.txDialog__reject}>
            Reject
          </button>
          <button type="button" onClick={approve} disabled={isBusy} className={styles.txDialog__approve}>
            {isBusy ? 'Confirming...' : details.approveLabel}
          </button>
        </div>
      </div>
    </NativeDialog>
  )
})

/**
 * Turns a raw EIP-1193 request into the facts worth showing. Everything here is derived from the
 * request payload itself so a hostile app cannot dress up what it is asking for.
 */
function describeRequest(request) {
  if (!request) return { title: 'Confirm request', rows: [], approveLabel: 'Approve' }

  const { method, params = [] } = request

  if (method === 'eth_sendTransaction') {
    const tx = params[0] || {}
    const value = tx.value ? BigInt(tx.value) : 0n
    const data = typeof tx.data === 'string' ? tx.data : ''

    return {
      title: 'Confirm transaction',
      approveLabel: 'Approve transaction',
      payloadLabel: 'calldata',
      payload: data && data !== '0x' ? data : null,
      rows: [
        { label: 'To', value: tx.to || 'Contract creation', mono: true },
        {
          label: 'Amount',
          value: `${formatEther(value)} ${request.currencySymbol || ''}`.trim(),
          emphasis: value > 0n,
        },
        { label: 'Network', value: request.networkName || `Chain ${request.chainId}` },
        // The 4-byte selector is the only honest summary available without an ABI
        { label: 'Function', value: data && data.length >= 10 ? `${data.slice(0, 10)} (unverified)` : 'Plain transfer', mono: true },
      ],
    }
  }

  if (method === 'personal_sign') {
    const raw = params[0]
    const text = isHex(raw) ? safeHexToString(raw) : String(raw ?? '')
    return {
      title: 'Confirm signature',
      approveLabel: 'Sign message',
      payloadLabel: 'message',
      payload: text,
      rows: [
        { label: 'Type', value: 'Message signature' },
        { label: 'Signing as', value: request.address || 'your wallet', mono: true },
      ],
    }
  }

  if (method === 'eth_signTypedData_v4' || method === 'eth_signTypedData') {
    const payload = params[1] ?? params[0]
    let parsed = payload
    if (typeof payload === 'string') {
      try {
        parsed = JSON.parse(payload)
      } catch {
        /* leave as the raw string */
      }
    }
    return {
      title: 'Confirm signature',
      approveLabel: 'Sign data',
      payloadLabel: 'typed data',
      payload: typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2),
      rows: [
        { label: 'Type', value: parsed?.primaryType ? `Typed data — ${parsed.primaryType}` : 'Typed data signature' },
        { label: 'Domain', value: parsed?.domain?.name || 'Not specified' },
        { label: 'Signing as', value: request.address || 'your wallet', mono: true },
      ],
    }
  }

  return {
    title: 'Confirm request',
    approveLabel: 'Approve',
    payloadLabel: 'parameters',
    payload: JSON.stringify(params, null, 2),
    rows: [{ label: 'Method', value: method, mono: true }],
  }
}

function safeHexToString(value) {
  try {
    return hexToString(value)
  } catch {
    return value
  }
}

export default MiniAppTxDialog
