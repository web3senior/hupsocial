'use client'

import clsx from 'clsx'
import { CoinsIcon, LockSimpleIcon, LockSimpleOpenIcon, StackIcon, UsersIcon, UsersThreeIcon } from '@phosphor-icons/react'
import { CONTRACTS } from '@/config/wagmi'
import { DROP_GATES } from '@/lib/drops'
import styles from './DropGatePicker.module.scss'

// The follower and community systems exist per chain, so the gate menu is chain-shaped
export const dropGateOptions = ({ chainId, hasCommunityGate }) => [
  { id: DROP_GATES.OPEN, label: 'Open', icon: <LockSimpleOpenIcon size={13} /> },
  { id: DROP_GATES.ALLOWLIST, label: 'Allowlist', icon: <LockSimpleIcon size={13} /> },
  ...(CONTRACTS[`chain${chainId}`]?.followerSystem ? [{ id: DROP_GATES.FOLLOWERS, label: 'Followers', icon: <UsersIcon size={13} /> }] : []),
  ...(hasCommunityGate ? [{ id: DROP_GATES.COMMUNITY, label: 'Community', icon: <UsersThreeIcon size={13} /> }] : []),
  /* Both gates are a plain balanceOf against a contract the creator names, so unlike the follower
     and community gates they need nothing deployed per chain and are always on offer. */
  { id: DROP_GATES.ASSET_HOLDERS, label: 'Token holders', icon: <CoinsIcon size={13} /> },
  { id: DROP_GATES.ASSET_HOLDERS_1155, label: 'Edition holders', icon: <StackIcon size={13} /> },
]

/**
 * The one "Who can mint" control — the create form and the manage panel's add-stage form both
 * render gate choice through this row, so the two can never drift apart.
 */
export default function DropGatePicker({ chainId, hasCommunityGate, value, onChange, disabled }) {
  return (
    <div className={styles.gatePicker}>
      <span>Who can mint</span>
      <div className={styles.gatePicker__options}>
        {dropGateOptions({ chainId, hasCommunityGate }).map((option) => (
          <button
            key={option.id}
            type="button"
            className={clsx(styles.gatePicker__option, value === option.id && styles['gatePicker__option--active'])}
            onClick={() => onChange(option.id)}
            disabled={disabled}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
