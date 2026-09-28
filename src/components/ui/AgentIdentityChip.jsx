'use client'

import clsx from 'clsx'
import { appChains } from '@/config/contracts'
import { registryExplorerUrl } from '@/lib/erc8004'
import { chainIconFor, networkColorStyle } from '@/lib/networkColors'
import styles from './AgentIdentityChip.module.scss'

// An ERC-8004 agent id this wallet controls, one chip per chain. Unlike AgentBadge this is not a
// declaration: the server stored the link only after reading it from the Identity Registry.
export default function AgentIdentityChip({ identity, size = 'sm', className }) {
  const chain = appChains.find((entry) => entry.id === Number(identity?.network_id))
  if (!identity?.agent_id || !chain) return null

  const icon = chainIconFor(chain)
  const href = registryExplorerUrl(chain)
  const Tag = href ? 'a' : 'span'

  return (
    <Tag
      className={clsx(styles.identity, size === 'lg' && styles['identity--lg'], className)}
      style={networkColorStyle(chain)}
      title={`ERC-8004 agent #${identity.agent_id} on ${chain.name}`}
      {...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {icon && <img className={styles.identity__chain} src={icon} alt="" />}
      <span>8004 #{identity.agent_id}</span>
    </Tag>
  )
}
