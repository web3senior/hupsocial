'use client'

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { useConnection, useSignMessage } from 'wagmi'
import { createPublicClient, formatEther, isAddress } from 'viem'
import { browserTransport } from '@/config/wagmi'
import { sweepMessage } from '@/lib/relayerSweep'
import styles from '../page.module.scss'

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })

// Balances settle a few seconds after the hash comes back; re-reading sooner shows the old figure
const REREAD_DELAY_MS = 8000

/**
 * The relayer is a hot wallet the server holds the key for. This tab reads what it holds on every
 * chain and lets the admin wallet move it out — one chain, or all of them under one signature.
 * @param {Object} props
 * @param {Object[]} props.chains Every configured chain.
 */
export default function RelayerSweepSection({ chains }) {
  const { address } = useConnection()
  const { signMessageAsync } = useSignMessage()

  const [relayer, setRelayer] = useState(null)
  const [relayerError, setRelayerError] = useState(null)
  const [balances, setBalances] = useState({})
  const [to, setTo] = useState('')
  const [results, setResults] = useState({})
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    fetch('/api/v1/relay/status')
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || 'Relayer is not configured')
        setRelayer(json.data.relayer)
      })
      .catch((err) => setRelayerError(err.message))
  }, [])

  useEffect(() => {
    if (address && !to) setTo(address)
  }, [address, to])

  const readBalance = useCallback(
    async (chain) => {
      if (!relayer) return
      setBalances((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], loading: true, error: null } }))

      try {
        const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
        const value = await client.getBalance({ address: relayer })
        setBalances((prev) => ({ ...prev, [chain.id]: { loading: false, value } }))
      } catch (err) {
        setBalances((prev) => ({ ...prev, [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Read failed' } }))
      }
    },
    [relayer],
  )

  const chainIds = chains.map((chain) => chain.id).join(',')

  useEffect(() => {
    chains.forEach(readBalance)
    // Keyed on the ids: the parent hands a fresh array every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainIds, readBalance])

  const sweep = async (targets) => {
    const ids = targets.map((chain) => chain.id)
    setBusy(ids.length === 1 ? ids[0] : 'all')
    setResults((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, { loading: true }])) }))

    try {
      const nonceRes = await fetch('/api/v1/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: address }),
      })
      const { nonce } = await nonceRes.json()
      if (!nonce) throw new Error('Could not get a nonce')

      const signature = await signMessageAsync({ message: sweepMessage({ to, chainIds: ids, nonce }) })

      const res = await fetch('/api/v1/admin/relayer/sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, nonce, to, chainIds: ids }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Sweep failed')

      setResults((prev) => ({ ...prev, ...json.data.results }))
      setTimeout(() => targets.forEach(readBalance), REREAD_DELAY_MS)
    } catch (err) {
      const error = err.shortMessage || err.message || 'Sweep failed'
      setResults((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, { error }])) }))
    } finally {
      setBusy(null)
    }
  }

  const funded = chains.filter((chain) => (balances[chain.id]?.value ?? 0n) > 0n)
  const toIsValid = isAddress(to) && to.toLowerCase() !== relayer?.toLowerCase()

  return (
    <section className={styles['admin-contracts__section']}>
      <header className={styles['admin-contracts__header']}>
        <h2 className={styles['admin-contracts__title']}>Relayer</h2>
        <p className={styles['admin-contracts__subtitle']}>
          The hot wallet that pays gas for relayed posts, likes and scheduled deliveries. Its key lives on the server; sweeping
          moves everything it holds on a chain to the address below, keeping back only the gas for that one transfer.
          {relayer && (
            <>
              {' '}
              Relayer: <code>{relayer}</code>
            </>
          )}
        </p>
        {relayerError && (
          <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>{relayerError}</div>
        )}
      </header>

      <div className={styles['admin-contracts__edit-form']}>
        <div className={styles['admin-contracts__input-group']}>
          <label className={styles['admin-contracts__detail-label']} htmlFor="relayer-sweep-to">
            Send everything to
          </label>
          <input
            id="relayer-sweep-to"
            type="text"
            className={styles['admin-contracts__input']}
            value={to}
            onChange={(event) => setTo(event.target.value.trim())}
            placeholder="0x…"
            disabled={busy !== null}
          />
        </div>

        <div className={styles['admin-contracts__actions']}>
          <button
            type="button"
            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
            onClick={() => sweep(funded)}
            disabled={!relayer || !toIsValid || funded.length === 0 || busy !== null}
          >
            {busy === 'all' ? 'Sweeping…' : `Sweep all funded chains (${funded.length})`}
          </button>
          <button
            type="button"
            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
            onClick={() => chains.forEach(readBalance)}
            disabled={!relayer}
          >
            Refresh
          </button>
        </div>
        {to && !toIsValid && (
          <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
            {isAddress(to) ? 'That is the relayer itself.' : 'Enter a valid address.'}
          </div>
        )}
      </div>

      <div className={styles['admin-contracts__grid']}>
        {chains.map((chain) => {
          const balance = balances[chain.id]
          const result = results[chain.id] ?? {}
          const symbol = chain.nativeCurrency?.symbol ?? 'ETH'
          const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
          const hasFunds = (balance?.value ?? 0n) > 0n

          return (
            <div
              key={chain.id}
              className={styles['admin-contracts__card']}
              style={{ '--network-color-primary': chain.primaryColor || '#f97316', '--network-color-text': chain.textColor || '#0d0d0d' }}
            >
              <div className={styles['admin-contracts__card-header']}>
                <div className={styles['admin-contracts__network-info']}>
                  <div className={styles['admin-contracts__card-icon']}>
                    <img src={chain.iconUrl} alt="" />
                  </div>
                  <h3 className={styles['admin-contracts__card-title']}>{chain.name}</h3>
                </div>
                <span className={clsx(styles['admin-contracts__badge'], { [styles['admin-contracts__badge--override']]: hasFunds })}>
                  {balance?.loading ? '…' : hasFunds ? 'FUNDED' : 'EMPTY'}
                </span>
              </div>

              <div className={styles['admin-contracts__details']}>
                <div className={styles['admin-contracts__detail-row']}>
                  <span className={styles['admin-contracts__detail-label']}>
                    {explorerUrl && relayer ? (
                      <a href={`${explorerUrl}/address/${relayer}`} target="_blank" rel="noopener noreferrer">
                        Balance ↗
                      </a>
                    ) : (
                      'Balance'
                    )}
                  </span>
                  <span className={styles['admin-contracts__detail-value']}>
                    {balance?.value === undefined ? '—' : amountFormat.format(Number(formatEther(balance.value)))} {symbol}
                  </span>
                </div>

                {balance?.error && (
                  <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>{balance.error}</div>
                )}
                {result.error && (
                  <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>{result.error}</div>
                )}
                {result.skipped === 'empty' && (
                  <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}>Nothing to sweep.</div>
                )}
                {result.skipped === 'gas' && (
                  <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}>
                    Balance is below the gas a transfer costs ({amountFormat.format(Number(result.reserve))} {symbol}).
                  </div>
                )}
                {result.hash && (
                  <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--success'])}>
                    Sent {amountFormat.format(Number(result.value))} {symbol}{' '}
                    {explorerUrl ? (
                      <a href={`${explorerUrl}/tx/${result.hash}`} target="_blank" rel="noopener noreferrer">
                        {result.hash.slice(0, 10)}… ↗
                      </a>
                    ) : (
                      <code>{result.hash.slice(0, 10)}…</code>
                    )}
                  </div>
                )}
              </div>

              <div className={styles['admin-contracts__actions']}>
                <button
                  type="button"
                  className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                  onClick={() => sweep([chain])}
                  disabled={!relayer || !toIsValid || !hasFunds || busy !== null}
                >
                  {busy === chain.id || (busy === 'all' && result.loading) ? 'Sweeping…' : 'Sweep'}
                </button>
                <button
                  type="button"
                  className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                  onClick={() => readBalance(chain)}
                  disabled={!relayer || balance?.loading}
                >
                  Refresh
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
