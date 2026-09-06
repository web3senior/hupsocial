'use client'

import { useMemo } from 'react'
import clsx from 'clsx'
import { formatEther } from 'viem'
import { useReadContracts, useSwitchChain } from 'wagmi'
import { config, setNetworkColor } from '@/config/wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { setActiveChainId, useActiveChain } from '@/hooks/useActiveChain'
import { networkColorStyle } from '@/lib/networkColors'
import dropsAbi from '@/abis/HupDrops.json'
import { CheckCircleIcon, WalletIcon } from '@phosphor-icons/react'
import styles from './DropChainPicker.module.scss'

const feeFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 4 })

// wagmi's config stamps iconUrl onto the shared chain objects; the inline `icon` SVG is the fallback
const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

/** The chains a drop can actually deploy to — the engine has to be live there. */
export const dropChains = appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.drops)

/**
 * Drop Chain Picker
 * Where the drop will live, chosen before anything else is filled in. Only chains carrying the
 * HupDrops engine are offered, each with what it charges to create — the one number that actually
 * decides this, and the reason the choice comes first rather than being inherited silently.
 *
 * Picking writes through to the app's active chain and switches the wallet with it, so the header,
 * the form's colours and the transaction can never end up naming three different networks.
 *
 * @param {number} props.chainId The chain currently chosen.
 * @param {boolean} [props.disabled] Locked while the form is busy.
 */
export default function DropChainPicker({ chainId, disabled = false }) {
  const { isConnected, chainId: activeChainId } = useActiveChain()
  const switchChain = useSwitchChain({ config })

  // One read per chain, so the fee shown is the one the next transaction will demand
  const { data: fees } = useReadContracts({
    contracts: useMemo(
      () =>
        dropChains.map((chain) => ({
          address: CONTRACTS[`chain${chain.id}`].drops,
          abi: dropsAbi,
          functionName: 'creationFee',
          chainId: chain.id,
        })),
      [],
    ),
  })

  const handleSelect = (chain) => {
    if (disabled || chain.id === chainId) return

    const apply = () => {
      setActiveChainId(chain.id)
      setNetworkColor(chain)
    }

    // Same order as NetworkSelect: the wallet moves first, and the app follows only if it agreed
    if (isConnected) {
      switchChain.mutate({ chainId: chain.id }, { onSuccess: apply, onError: (error) => console.error('Switch chain failed:', error) })
      return
    }
    apply()
  }

  if (dropChains.length === 0) {
    return <p className={styles.chainPicker__empty}>NFT drops aren&rsquo;t live on any network yet.</p>
  }

  return (
    <ul className={styles.chainPicker}>
      {dropChains.map((chain, index) => {
        const icon = chainIconFor(chain)
        const isChosen = chain.id === chainId
        const fee = fees?.[index]?.status === 'success' ? fees[index].result : undefined
        const isSwitchingHere = switchChain.isPending && switchChain.variables?.chainId === chain.id

        return (
          // Colours come from the chain the card offers, not the one currently active
          <li key={chain.id} style={networkColorStyle(chain)}>
            <button
              type="button"
              className={clsx(styles.chainPicker__card, isChosen && styles['chainPicker__card--chosen'])}
              onClick={() => handleSelect(chain)}
              disabled={disabled || switchChain.isPending}
              aria-pressed={isChosen}
            >
              <span className={styles.chainPicker__mark}>
                {icon ? <img src={icon} alt="" /> : <span aria-hidden="true">{chain.name.slice(0, 1)}</span>}
              </span>

              <span className={styles.chainPicker__body}>
                <strong>{chain.name}</strong>
                <small>
                  {isSwitchingHere
                    ? 'Switching your wallet…'
                    : fee === undefined
                      ? chain.nativeCurrency?.symbol
                      : fee === 0n
                        ? `Free to create · ${chain.nativeCurrency?.symbol}`
                        : `${feeFormat.format(Number(formatEther(fee)))} ${chain.nativeCurrency?.symbol} to create`}
                </small>
              </span>

              {isConnected && activeChainId === chain.id && (
                <span className={styles.chainPicker__wallet} title="Your wallet is already on this network">
                  <WalletIcon size={12} weight="fill" />
                  Connected
                </span>
              )}

              {isChosen && <CheckCircleIcon size={18} weight="fill" className={styles.chainPicker__chosenMark} />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
