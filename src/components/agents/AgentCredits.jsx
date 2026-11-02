'use client'

import { useEffect, useState } from 'react'
import { ContentSpinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import { agentBillingAddress, agentModelLabel, creditsToUsd } from '@/config/agentModels'
import { fetchCredits, topUpAgent } from '@/lib/agentWallet'
import AgentWalletActions from './AgentWalletActions'
import styles from './AgentCredits.module.scss'

const usd = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const isCancel = (error) => error?.code === 4001 || error?.name === 'UserRejectedRequestError'

/**
 * What an agent has to spend on its model, what it spent it on, and topping it up from its own
 * wallet. Charges are exactly what AIML API reported each run cost; top-ups are credited at the
 * LYX price of the moment, so the balance itself never moves with LYX.
 */
export default function AgentCredits({ token, agent, onBalance }) {
  const [billing, setBilling] = useState(null)
  const [amount, setAmount] = useState('')
  const [isToppingUp, setIsToppingUp] = useState(false)
  const topUpsOn = Boolean(agentBillingAddress())

  useEffect(() => {
    let live = true
    fetchCredits(token, agent.address)
      .then((data) => live && setBilling(data))
      .catch((error) => live && toast(error.message, 'error'))
    return () => {
      live = false
    }
  }, [token, agent.address])

  const topUp = async (event) => {
    event.preventDefault()
    setIsToppingUp(true)
    try {
      const result = await topUpAgent({ token, agent, amount })
      setAmount('')
      toast(`Added ${usd.format(creditsToUsd(result.credits))} of credits`, 'success')
      onBalance?.(result.balance)
      setBilling(await fetchCredits(token, agent.address))
    } catch (error) {
      if (!isCancel(error)) toast(error.txHash ? `${error.message}. Your transfer is onchain; try again shortly.` : error.message, 'error')
    } finally {
      setIsToppingUp(false)
    }
  }

  if (!billing) return <ContentSpinner />

  return (
    <div className={styles.credits}>
      <div className={styles.credits__balance}>
        <span className={styles.credits__amount}>{usd.format(creditsToUsd(billing.balance))}</span>
        <span className={styles.credits__muted}>in credits · charged at exactly what each run costs</span>
      </div>

      {topUpsOn ? (
        <form className={styles.credits__topUp} onSubmit={topUp}>
          <input
            className={styles.credits__input}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="LYX amount"
            disabled={isToppingUp}
            aria-label="LYX amount"
          />
          <button type="submit" className={styles.credits__button} disabled={isToppingUp || !amount}>
            {isToppingUp ? 'Topping up…' : 'Top up from agent wallet'}
          </button>
        </form>
      ) : (
        <p className={styles.credits__muted}>Top-ups are not set up on this deployment yet.</p>
      )}
      <p className={styles.credits__muted}>
        Paid in LYX on LUKSO from {agent.name}&rsquo;s own wallet, so fund that wallet first. Credited at the LYX price of the moment.
      </p>

      {billing.usage.length > 0 && (
        <section>
          <h4 className={styles.credits__heading}>Recent runs</h4>
          <ul className={styles.credits__list}>
            {billing.usage.map((row, index) => (
              <li key={index} className={styles.credits__row}>
                <span>
                  {row.kind === 'task' ? 'Task' : 'Chat'} · {agentModelLabel(row.model)}
                </span>
                <span className={styles.credits__muted}>{dateTime.format(new Date(row.createdAt))}</span>
                <span>{usd.format(creditsToUsd(row.credits))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {billing.topups.length > 0 && (
        <section>
          <h4 className={styles.credits__heading}>Top-ups</h4>
          <ul className={styles.credits__list}>
            {billing.topups.map((row) => (
              <li key={row.txHash} className={styles.credits__row}>
                <span>{row.amount} LYX</span>
                <span className={styles.credits__muted}>{dateTime.format(new Date(row.createdAt))}</span>
                <span>+{usd.format(creditsToUsd(row.credits))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AgentWalletActions agent={agent} />
    </div>
  )
}
