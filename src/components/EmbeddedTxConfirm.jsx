'use client'

import { useEffect, useRef, useState } from 'react'
import { SealCheckIcon, XIcon } from '@phosphor-icons/react'
import { formatEther } from 'viem'
import NativeDialog from '@/components/ui/NativeDialog'
import { setTxConfirmHandler } from '@/lib/embeddedWallet/connector'
import styles from './EmbeddedTxConfirm.module.scss'

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—')

// Intl per project convention; six fractional digits covers dust without noise
const amountFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 })

/**
 * The embedded wallet's stand-in for a wallet extension popup. MetaMask users
 * approve spends in the extension; email users approve them here. Wired to the
 * connector through the same promise-shaped handler bus the mini app session
 * dialog uses — the connector awaits a boolean, Esc means no.
 */
export default function EmbeddedTxConfirm() {
  const dialogRef = useRef(null)
  const [request, setRequest] = useState(null)
  const resolverRef = useRef(null)

  useEffect(
    () =>
      setTxConfirmHandler(
        (details) =>
          new Promise((resolve) => {
            resolverRef.current = resolve
            setRequest(details)
            dialogRef.current?.open()
          }),
      ),
    [],
  )

  const settle = (approved) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setRequest(null)
    dialogRef.current?.close()
    resolve?.(approved)
  }

  const isTx = request?.kind === 'transaction'
  const value = isTx && request.tx?.value ? BigInt(request.tx.value) : 0n
  const symbol = request?.chain?.nativeCurrency?.symbol || 'ETH'

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.txConfirm}
      aria-label="Confirm with your email wallet"
      onClick={(e) => e.stopPropagation()}
      onCancel={(e) => {
        // Esc is a rejection, not a dismissal — the connector is awaiting an answer
        e.preventDefault()
        settle(false)
      }}
      onClose={(e) => e.stopPropagation()}
    >
      <div className={styles.txConfirm__body}>
        <header className={styles.txConfirm__header}>
          <h3>
            <SealCheckIcon size={18} weight="fill" /> {isTx ? 'Confirm transaction' : 'Confirm signature'}
          </h3>
          <button type="button" onClick={() => settle(false)} aria-label="Reject" className={styles.txConfirm__close}>
            <XIcon size={18} />
          </button>
        </header>

        {request && (
          <ul className={styles.txConfirm__facts}>
            <li>
              Network: <strong>{request.chain?.name || 'Unknown'}</strong>
            </li>
            {isTx ? (
              <>
                <li>
                  To: <code>{shortAddress(request.tx?.to)}</code>
                </li>
                <li>
                  Amount:{' '}
                  <strong>
                    {amountFormat.format(Number(formatEther(value)))} {symbol}
                  </strong>
                </li>
                {request.tx?.data && request.tx.data !== '0x' && (
                  <li>
                    Contract call: <code>{request.tx.data.slice(0, 10)}</code> · {Math.max((request.tx.data.length - 2) / 2, 0)} bytes
                  </li>
                )}
              </>
            ) : (
              <>
                <li>
                  Message type: <strong>{request.typedData?.primaryType || 'Typed data'}</strong>
                </li>
                {request.typedData?.domain?.name && (
                  <li>
                    From app: <strong>{request.typedData.domain.name}</strong>
                  </li>
                )}
                {request.typedData?.domain?.verifyingContract && (
                  <li>
                    Contract: <code>{shortAddress(request.typedData.domain.verifyingContract)}</code>
                  </li>
                )}
              </>
            )}
          </ul>
        )}

        <p className={styles.txConfirm__hint}>
          {isTx
            ? 'This will be signed with your email wallet and sent onchain.'
            : 'Signed permissions can authorize token movements — approve only actions you started.'}
        </p>

        <div className={styles.txConfirm__actions}>
          <button type="button" className={styles.txConfirm__reject} onClick={() => settle(false)}>
            Reject
          </button>
          <button type="button" className={styles.txConfirm__approve} onClick={() => settle(true)}>
            Confirm
          </button>
        </div>
      </div>
    </NativeDialog>
  )
}
