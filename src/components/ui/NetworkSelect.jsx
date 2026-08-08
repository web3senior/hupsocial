'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { CaretDownIcon, CheckCircleIcon } from '@phosphor-icons/react'
import { useSwitchChain } from 'wagmi'
import { config, setNetworkColor } from '@/config/wagmi'
import { useClientMounted } from '@/hooks/useClientMount'
import { setActiveChainId, useActiveChain } from '@/hooks/useActiveChain'
import NativePopover from '@/components/ui/NativePopover'
import styles from './NetworkSelect.module.scss'

/**
 * The one network switcher. Drop `<NetworkSelect />` anywhere a chain can be
 * changed — the chains come from the wagmi config, so adding a chain there adds
 * it here with no edit to this file.
 *
 * @param {string} [className] extra class for the trigger pill
 * @param {string} [placement] NativePopover placement for the list
 * @param {number} [maxIcons] how many chain icons the closed pill stacks before it collapses the rest into "+N"
 * @param {(chainId: number) => void} [onChange] fires after the chain actually changes
 */
export default function NetworkSelect({ className, placement = 'bottom-end', maxIcons = 4, onChange }) {
  const mounted = useClientMounted()
  const { chain, chainId, isConnected } = useActiveChain()
  const switchChain = useSwitchChain({ config })
  const router = useRouter()

  const [isOpen, setIsOpen] = useState(false)

  // Stable so NativePopover doesn't tear down and re-bind its listeners every render
  const handleToggle = useCallback((event) => setIsOpen(event.newState === 'open'), [])

  const handleSelect = (target, close) => {
    const apply = () => {
      setActiveChainId(target.id)
      setNetworkColor(target)
      onChange?.(target.id)
    }

    if (isConnected) {
      switchChain.mutate(
        { chainId: target.id },
        {
          onSuccess: apply,
          onError: (error) => {
            console.error('Switch chain failed:', error)
          },
        }
      )
    } else {
      apply()
    }

    close?.()
  }

  if (!mounted || !chain) return null

  // The active chain leads the stack; the rest trail it in config order
  const stack = [...config.chains].sort((a, b) => (b.id === chainId) - (a.id === chainId)).slice(0, maxIcons)
  const overflow = config.chains.length - stack.length

  return (
    <NativePopover
      placement={placement}
      className={styles['network-select-panel']}
      onToggle={handleToggle}
      trigger={
        <button
          type="button"
          title={chain.name}
          aria-label={`Network: ${chain.name}`}
          aria-expanded={isOpen}
          className={clsx(styles['network-select'], isOpen && styles['network-select--open'], className)}
        >
          <span className={styles['network-select__stack']}>
            {stack.map((item, index) => (
              <span
                key={item.id}
                style={{ zIndex: stack.length - index }}
                className={clsx(styles['network-select__icon'], item.id === chainId && styles['network-select__icon--active'])}
              >
                {item.iconUrl ? <img src={item.iconUrl} alt="" /> : item.name.charAt(0)}
              </span>
            ))}
          </span>

          {overflow > 0 && <span className={styles['network-select__more']}>+{overflow}</span>}

          <CaretDownIcon size={14} weight="bold" className={styles['network-select__caret']} />
        </button>
      }
    >
      {({ close }) => (
        <>
          {config.chains.map((item) => {
            const isCurrent = item.id === chainId

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item, close)}
                className={clsx(styles['network-select-panel__item'], isCurrent && styles['network-select-panel__item--current'])}
              >
                <span className={styles['network-select-panel__icon']}>{item.iconUrl ? <img src={item.iconUrl} alt="" /> : item.name.charAt(0)}</span>
                <span className={styles['network-select-panel__name']}>{item.name}</span>
                {isCurrent && <CheckCircleIcon size={15} className={styles['network-select-panel__check']} />}
              </button>
            )
          })}

          <p
            className={styles['network-select-panel__footer']}
            onClick={() => {
              close()
              router.push('/networks')
            }}
          >
            View networks
          </p>
        </>
      )}
    </NativePopover>
  )
}
