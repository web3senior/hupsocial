'use client'

import clsx from 'clsx'
import { isAddress } from 'viem'
import { PlusIcon, XIcon } from '@phosphor-icons/react'
import Profile from '@/components/Profile'
import { MAX_SPLIT_PAYEES, SPLIT_TOTAL_BPS } from '@/lib/drops'
import styles from './DropPayeeTable.module.scss'

const percentFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })

export const emptyPayee = () => ({ address: '', percent: '' })

/** The typed shares in basis points, so 33.33 + 33.33 + 33.34 lands on exactly 10,000. */
export const payeeTotalBps = (rows) => rows.reduce((total, row) => total + Math.round(Number(row.percent || 0) * 100), 0)

/**
 * Drop Payee Table
 * The rows a payment split is made of: a wallet and its percentage, as many as the splitter takes.
 * Every valid address resolves to a profile chip, so a creator sees who they are paying rather
 * than a hex string, and the footer says how far the shares are from the 100% the contract insists on.
 *
 * @param {Object[]} props.rows `{ address, percent }` as typed.
 * @param {Function} props.onChange Receives the next rows.
 * @param {number} props.chainId For the profile chips.
 * @param {boolean} [props.disabled]
 */
export default function DropPayeeTable({ rows, onChange, chainId, disabled = false }) {
  const update = (index, patch) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const remove = (index) => onChange(rows.filter((_, i) => i !== index))
  const add = () => onChange([...rows, emptyPayee()])

  const remaining = SPLIT_TOTAL_BPS - payeeTotalBps(rows)

  return (
    <div className={styles.payees}>
      <ul className={styles.payees__list}>
        {rows.map((row, index) => {
          const value = row.address.trim()
          const valid = isAddress(value)
          const duplicate = valid && rows.some((other, i) => i !== index && other.address.trim().toLowerCase() === value.toLowerCase())

          return (
            <li key={index} className={styles.payees__row}>
              <div className={styles.payees__who}>
                <input
                  type="text"
                  value={row.address}
                  placeholder="0x…"
                  onChange={(e) => update(index, { address: e.target.value.trim() })}
                  disabled={disabled}
                  spellCheck={false}
                  aria-label={`Payee ${index + 1} address`}
                />
                {valid && !duplicate && (
                  <span className={styles.payees__profile}>
                    <Profile creator={value} networkId={chainId} variant="compact" size={20} hoverCard={false} />
                  </span>
                )}
                {duplicate && <small className={styles.payees__error}>Listed twice</small>}
              </div>
              <label className={styles.payees__share}>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={row.percent}
                  placeholder="0"
                  onChange={(e) => update(index, { percent: e.target.value })}
                  disabled={disabled}
                  aria-label={`Payee ${index + 1} share`}
                />
                <span>%</span>
              </label>
              <button
                type="button"
                className={styles.payees__remove}
                onClick={() => remove(index)}
                disabled={disabled || rows.length <= 1}
                aria-label="Remove payee"
              >
                <XIcon size={13} weight="bold" />
              </button>
            </li>
          )
        })}
      </ul>

      <div className={styles.payees__foot}>
        <button type="button" className={styles.payees__add} onClick={add} disabled={disabled || rows.length >= MAX_SPLIT_PAYEES}>
          <PlusIcon size={13} weight="bold" aria-hidden="true" />
          Add a wallet
        </button>
        <span className={clsx(styles.payees__total, remaining !== 0 && styles['payees__total--off'])}>
          {remaining === 0
            ? 'Shares total 100%'
            : remaining > 0
              ? `${percentFormat.format(remaining / 100)}% still unassigned`
              : `${percentFormat.format(-remaining / 100)}% over 100%`}
        </span>
      </div>
    </div>
  )
}
