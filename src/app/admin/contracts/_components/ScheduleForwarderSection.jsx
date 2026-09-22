'use client'

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { createPublicClient } from 'viem'
import { browserTransport, config, CONTRACTS } from '@/config/wagmi'
import styles from '../page.module.scss'

const HUP_TRUST_ABI = [
  {
    inputs: [{ name: 'forwarder', type: 'address' }],
    name: 'isTrustedForwarder',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: '_forwarder', type: 'address' },
      { name: '_trusted', type: 'bool' },
    ],
    name: 'setTrustedForwarder',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

const VERSION_ABI = [{ inputs: [], name: 'version', outputs: [{ name: '', type: 'string' }], stateMutability: 'pure', type: 'function' }]

/**
 * Scheduled posts go live on a chain the moment its Hup trusts the schedule forwarder. One card per
 * chain: whether the forwarder is deployed there, whether Hup trusts it, and the admin call that
 * flips it. The forwarder has the same address everywhere (CREATE2, salt hup-schedule-forwarder).
 * @param {Object} props
 * @param {Object[]} props.chains Chains with a `scheduleForwarder` configured.
 */
export default function ScheduleForwarderSection({ chains }) {
  const [readings, setReadings] = useState({})
  const [txStates, setTxStates] = useState({})
  const { mutateAsync: writeContractAsync } = useWriteContract()

  const read = useCallback(async (chain) => {
    const { hup, scheduleForwarder } = CONTRACTS[`chain${chain.id}`]
    setReadings((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], loading: true, error: null } }))

    try {
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
      const [code, trusted] = await Promise.all([
        client.getCode({ address: scheduleForwarder }),
        client.readContract({ address: hup, abi: HUP_TRUST_ABI, functionName: 'isTrustedForwarder', args: [scheduleForwarder] }),
      ])
      const deployed = Boolean(code && code !== '0x')
      const version = deployed
        ? await client.readContract({ address: scheduleForwarder, abi: VERSION_ABI, functionName: 'version' }).catch(() => null)
        : null

      setReadings((prev) => ({ ...prev, [chain.id]: { loading: false, deployed, trusted, version } }))
    } catch (err) {
      setReadings((prev) => ({ ...prev, [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Read failed' } }))
    }
  }, [])

  const chainIds = chains.map((chain) => chain.id).join(',')

  useEffect(() => {
    chains.forEach(read)
    // Keyed on the ids: the parent hands a fresh array every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainIds, read])

  const setTrust = async (chain, trusted) => {
    const { hup, scheduleForwarder } = CONTRACTS[`chain${chain.id}`]
    setTxStates((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const hash = await writeContractAsync({
        address: hup,
        abi: HUP_TRUST_ABI,
        functionName: 'setTrustedForwarder',
        args: [scheduleForwarder, trusted],
        chainId: chain.id,
      })
      await waitForTransactionReceipt(config, { chainId: chain.id, hash })
      setTxStates((prev) => ({ ...prev, [chain.id]: { hash } }))
      read(chain)
    } catch (err) {
      setTxStates((prev) => ({ ...prev, [chain.id]: { error: err.shortMessage || err.message || 'Transaction failed' } }))
    }
  }

  return (
    <section className={styles['admin-contracts__section']}>
      <header className={styles['admin-contracts__header']}>
        <h2 className={styles['admin-contracts__title']}>Scheduled posts</h2>
        <p className={styles['admin-contracts__subtitle']}>
          HupScheduleForwarder publishes a post its author signed ahead of time, at that time, with nobody online. It has one address on every
          chain; deploy it from deploy.html with the salt label hup-schedule-forwarder, then trust it here. Scheduling goes live on a chain the
          moment its Hup trusts it, and revoking trust stops every pending delivery there.
        </p>
      </header>

      <div className={styles['admin-contracts__grid']}>
        {chains.map((chain) => {
          const { hup, scheduleForwarder } = CONTRACTS[`chain${chain.id}`]
          const reading = readings[chain.id]
          const tx = txStates[chain.id] ?? {}
          const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
          const live = Boolean(reading?.deployed && reading?.trusted)

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
                <span className={clsx(styles['admin-contracts__badge'], { [styles['admin-contracts__badge--override']]: live })}>
                  {reading?.loading ? '…' : live ? 'LIVE' : reading?.deployed ? 'NOT TRUSTED' : 'NOT DEPLOYED'}
                </span>
              </div>

              <div className={styles['admin-contracts__details']}>
                <div className={styles['admin-contracts__detail-row']}>
                  <span className={styles['admin-contracts__detail-label']}>Forwarder</span>
                  <span className={styles['admin-contracts__detail-value']}>
                    {explorerUrl ? (
                      <a href={`${explorerUrl}/address/${scheduleForwarder}`} target="_blank" rel="noopener noreferrer">
                        <code>{scheduleForwarder}</code> ↗
                      </a>
                    ) : (
                      <code>{scheduleForwarder}</code>
                    )}
                  </span>
                </div>

                <div className={styles['admin-contracts__detail-row']}>
                  <span className={styles['admin-contracts__detail-label']}>Hup</span>
                  <span className={styles['admin-contracts__detail-value']}>
                    <code>{hup}</code>
                  </span>
                </div>

                {reading && !reading.loading && !reading.error && (
                  <div className={styles['admin-contracts__detail-row']}>
                    <span className={styles['admin-contracts__detail-label']}>Status</span>
                    <span className={styles['admin-contracts__detail-value']}>
                      {reading.deployed ? `Deployed${reading.version ? `, v${reading.version}` : ''}` : 'Not deployed yet'}
                      {' · '}
                      {reading.trusted ? 'trusted by Hup' : 'not trusted by Hup'}
                    </span>
                  </div>
                )}

                {reading?.error && (
                  <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>{reading.error}</div>
                )}
                {tx.error && <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>{tx.error}</div>}
                {tx.hash && (
                  <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--success'])}>
                    Confirmed{' '}
                    {explorerUrl ? (
                      <a href={`${explorerUrl}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer">
                        {tx.hash.slice(0, 10)}… ↗
                      </a>
                    ) : (
                      <code>{tx.hash.slice(0, 10)}…</code>
                    )}
                  </div>
                )}
              </div>

              <div className={styles['admin-contracts__actions']}>
                {reading?.deployed && !reading.trusted && (
                  <button
                    type="button"
                    className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                    onClick={() => setTrust(chain, true)}
                    disabled={tx.loading}
                  >
                    {tx.loading ? 'Confirming…' : 'Trust on Hup'}
                  </button>
                )}
                {reading?.trusted && (
                  <button
                    type="button"
                    className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                    onClick={() => setTrust(chain, false)}
                    disabled={tx.loading}
                  >
                    {tx.loading ? 'Confirming…' : 'Revoke trust'}
                  </button>
                )}
                <button
                  type="button"
                  className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                  onClick={() => read(chain)}
                  disabled={reading?.loading}
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
