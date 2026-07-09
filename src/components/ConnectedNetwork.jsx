'use client'

import { useState } from 'react'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { CaretDownIcon } from '@phosphor-icons/react'
import { config } from '@/config/wagmi'
import { useClientMounted } from '@/hooks/useClientMount'
import { getActiveChain } from '@/lib/communication'
import NativePopover from '@/components/ui/NativePopover'
import NetworkSwitcher from '@/components/NetworkSwitcher'
import styles from './ConnectedNetwork.module.scss'

export default function ConnectedNetwork({ className }) {
  const mounted = useClientMounted()
  const { isConnected, chain: walletChain } = useConnection()

  const [activeChainId, setActiveChainId] = useState(() => getActiveChain()[0]?.id)

  const effectiveChainId = isConnected && walletChain ? walletChain.id : activeChainId
  const chain = config.chains.find((c) => c.id === effectiveChainId)

  if (!mounted || !chain) return null

  return (
    <div className={clsx(styles['connected-network'], className)}>
      <span className={styles['connected-network__logo']}>
        <img src={chain.iconUrl} alt="" />
      </span>

      <div className={styles['connected-network__meta']}>
        <span className={styles['connected-network__name']}>{chain.name}</span>
        <span className={styles['connected-network__sub']}>
          {chain.id}
          <span className={styles['connected-network__dot']}>&middot;</span>
          {chain.nativeCurrency?.symbol}
        </span>
      </div>

      <NativePopover
        placement="bottom-end"
        trigger={
          <button type="button" className={styles['connected-network__switch']}>
            Switch
            <CaretDownIcon size={14} className={styles['connected-network__chevron']} />
          </button>
        }
      >
        {({ close }) => <NetworkSwitcher currentNetwork={effectiveChainId} onChainChange={setActiveChainId} onSelect={close} />}
      </NativePopover>
    </div>
  )
}
