'use client'

import clsx from 'clsx'
import { isAddress } from 'viem'
import { CheckCircleIcon, WarningIcon } from '@phosphor-icons/react'
import { usePaymentToken } from '@/hooks/usePaymentToken'
import InfoHint from './ui/InfoHint'
import styles from './DropTokenIdentity.module.scss'

/**
 * Drop Token Identity
 * What is actually deployed at a pasted payment-token address, read live from the drop's chain.
 *
 * A phase priced in a token is priced in that token's own decimals, so a wrong address does not
 * fail loudly — it deploys a drop that charges a thousand times too much, or nothing at all. This
 * turns the address into a name and a decimal count before that can happen, and catches a kind
 * toggle set the wrong way while it is still free to fix.
 *
 * @param {number} props.chainId The drop's chain — where the token has to exist.
 * @param {string} props.token The address as typed. Anything but a valid address renders nothing.
 * @param {boolean} [props.isLsp7] What the creator says the token is, for the mismatch warning.
 */
export default function DropTokenIdentity({ chainId, token, isLsp7 = false }) {
  const { symbol, decimals, exists, looksLsp7, isLoading } = usePaymentToken(chainId, token)

  if (!isAddress(token ?? '')) return null
  if (isLoading) return <span className={styles.tokenIdentity}>Reading the token…</span>

  if (!exists) {
    return (
      <span className={clsx(styles.tokenIdentity, styles['tokenIdentity--bad'])}>
        <WarningIcon size={13} weight="fill" />
        Nothing answers as a token at this address on this network.
      </span>
    )
  }

  const mismatch = looksLsp7 !== Boolean(isLsp7)
  const label = symbol || 'Unnamed token'

  return (
    <span className={clsx(styles.tokenIdentity, mismatch && styles['tokenIdentity--warn'])}>
      {mismatch ? <WarningIcon size={13} weight="fill" /> : <CheckCircleIcon size={13} weight="fill" />}
      <strong>{label}</strong>
      {/* The decimal count is what makes a price mean what it says, but it is not what a creator
          reads the line for — so it sits behind the dot rather than in front of the name */}
      <InfoHint label={label}>
        {decimals} decimals. The price you type is in {label}&rsquo;s own units, so 1 means one whole{' '}
        {label}, not one of its smallest pieces.
      </InfoHint>
      {mismatch && <em>reads as {looksLsp7 ? 'an LSP7' : 'an ERC20'} — switch the kind below</em>}
    </span>
  )
}
