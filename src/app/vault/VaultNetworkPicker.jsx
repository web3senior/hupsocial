'use client'

import clsx from 'clsx'
import { ChainLogo } from './VaultIllustration'
import styles from './VaultNetworkPicker.module.scss'

export default function VaultNetworkPicker({ chains = [], deployments = {}, value, onChange, disabled = false }) {
  return (
    <div className={styles.networks__list} role="group" aria-label="Choose your network">
      {chains.map((chain) => <button type="button" key={chain.id} className={clsx(styles.networks__option, value === chain.id && styles['networks__option--selected'])} aria-pressed={value === chain.id} disabled={disabled} onClick={() => onChange(chain.id)} title={!deployments[chain.id] ? `${chain.name} · creation unavailable` : chain.name}>
        <ChainLogo chainId={chain.id} size={28} />
        <span>{chain.name}</span>
        <small className={styles.networks__version}>{deployments[chain.id] ? `Safe ${deployments[chain.id].version}` : 'Unavailable'}</small>
      </button>)}
    </div>
  )
}
