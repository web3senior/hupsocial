'use client'

import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { CheckCircleIcon } from '@phosphor-icons/react'
import { useConnection, useSwitchChain } from 'wagmi'
import { config, setNetworkColor } from '@/config/wagmi'
import styles from './NetworkSwitcher.module.scss'

export default function NetworkSwitcher({ currentNetwork, onChainChange, onSelect }) {
  const { isConnected } = useConnection()
  const switchChain = useSwitchChain({ config })
  const router = useRouter()

  const handleSwitchChain = (chain) => {
    const chainId = chain.id

    if (isConnected) {
      switchChain.mutate(
        { chainId },
        {
          onSuccess: () => {
            localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`, chainId)
            setNetworkColor(chain)
          },
          onError: (error) => {
            console.error('Switch chain failed:', error)
          },
        }
      )
    } else {
      localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`, chainId)
      onChainChange?.(chainId)
    }

    onSelect?.()
  }

  return (
    <div className={styles['network-switcher']}>
      {config.chains.map((chain) => {
        const isCurrent = chain.id.toString() === currentNetwork.toString()

        return (
          <button
            key={chain.id}
            type="button"
            onClick={() => handleSwitchChain(chain)}
            className={clsx(styles['network-switcher__item'], isCurrent && styles['network-switcher__item--current'])}
          >
            <span className={styles['network-switcher__icon']}>
              <img src={chain.iconUrl} alt="" />
            </span>
            <span className={styles['network-switcher__name']}>{chain.name}</span>
            {isCurrent && <CheckCircleIcon size={15} className={styles['network-switcher__check']} />}
          </button>
        )
      })}

      <p className={styles['network-switcher__footer']} onClick={() => router.push('/networks')}>
        View networks
      </p>
    </div>
  )
}
