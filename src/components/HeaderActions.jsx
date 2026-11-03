'use client'

import { useRef } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { CaretDownIcon, CoinsIcon, PencilSimpleLineIcon, PlusIcon } from '@phosphor-icons/react'
import { useClientMounted } from '@/hooks/useClientMount'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { useSolanaWallet } from '@/hooks/useSolanaWallet'
import { useWalletPortfolio } from '@/hooks/useWalletPortfolio'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { CHAIN_ICONS } from '@/config/chainIcons'
import { SOLANA_ICON_URL, isSolanaNetworkId, solanaChainFor } from '@/config/solana'
import { appChains } from '@/config/contracts'
import { shortAddress } from '@/lib/address'
import NativePopover from '@/components/ui/NativePopover'
import CopyButton from '@/components/ui/CopyButton'
import TokenIcon from '@/components/ui/TokenIcon'
import Shimmer from '@/components/ui/Shimmer'
import DepositDialog from '@/components/DepositDialog'
import styles from './HeaderActions.module.scss'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
// The pill has room for "$12.4K", not "$12,431.07"
const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 })
const amount = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 })

const formatPill = (value) => (value >= 10_000 ? usdCompact.format(value) : usd.format(value))

// Native coins carry no address for TokenIcon to look up, so they get their chain's own mark
const nativeLogo = (chainId) => {
  if (isSolanaNetworkId(chainId)) return SOLANA_ICON_URL
  const svg = CHAIN_ICONS[Number(chainId)]
  return svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : null
}

// The same coin on several chains (ETH on mainnet, Arbitrum, Base) needs the chain to tell rows apart
const chainName = (chainId) =>
  isSolanaNetworkId(chainId) ? solanaChainFor(chainId)?.name : appChains.find((chain) => chain.id === Number(chainId))?.name

/**
 * What a signed-in header carries beside the avatar: Deposit, a create menu, and the wallet's
 * dollar balance with the positions behind it. Renders nothing signed out — Connect is the only
 * thing that header needs.
 *
 * The figures come from the same server-cached portfolio read the profile card uses, so the
 * header costs one request per wallet, not a sweep of every chain from the browser.
 */
export default function HeaderActions() {
  const mounted = useClientMounted()
  const { address, isConnected, kind } = useActiveWallet()
  const { connector } = useConnection()
  const solana = useSolanaWallet()
  const { portfolio, isLoading } = useWalletPortfolio(isConnected ? address : null)
  const setIsComponentOpen = useSidebarStore((state) => state.setIsComponentOpen)
  const depositRef = useRef(null)

  if (!mounted || !isConnected || !address) return null

  const isSolana = kind === 'solana'
  const total = portfolio?.totalUsd ?? 0
  const holdings = portfolio?.holdings ?? []
  const walletName = isSolana ? solana.walletName : connector?.name
  const walletIcon = isSolana ? null : connector?.icon

  const openDeposit = () => depositRef.current?.open()

  return (
    <div className={styles.actions}>
      <button type="button" className={clsx(styles.actions__button, styles['actions__button--primary'])} onClick={openDeposit}>
        Deposit
      </button>

      <NativePopover
        placement="bottom-end"
        className={styles.menu}
        trigger={
          <button type="button" className={clsx(styles.actions__button, styles['actions__button--icon'], styles['actions__button--create'])} aria-label="Create">
            <PlusIcon size={18} />
          </button>
        }
      >
        {({ close }) => (
          <>
            <button
              type="button"
              className={styles.menu__item}
              onClick={() => {
                close()
                setIsComponentOpen(true)
              }}
            >
              <PencilSimpleLineIcon size={20} aria-hidden="true" />
              New post
            </button>
            <Link href="/launchpad/launch" prefetch={false} className={styles.menu__item} onClick={close}>
              <CoinsIcon size={20} aria-hidden="true" />
              New coin
            </Link>
          </>
        )}
      </NativePopover>

      {isLoading && !portfolio ? (
        <div className={clsx(styles.actions__button, styles['actions__button--loading'])} aria-label="Loading balance">
          <Shimmer as="span" className={styles.actions__shimmer} />
        </div>
      ) : (
        <NativePopover
          placement="bottom-end"
          className={styles.balance}
          trigger={
            <button type="button" className={clsx(styles.actions__button, styles['actions__button--balance'])} aria-label="Your balance">
              {formatPill(total)}
              <CaretDownIcon size={14} aria-hidden="true" />
            </button>
          }
        >
          {({ close }) => (
            <>
              <header className={styles.balance__header}>
                <p className={styles.balance__title}>Your balance</p>
                <span className={styles.balance__address}>
                  {shortAddress(address)}
                  <CopyButton value={address} title="Copy address" size={14} />
                </span>
              </header>

              <p className={styles.balance__total}>{usd.format(total)}</p>

              {holdings.length > 0 ? (
                <ul className={styles.balance__list}>
                  {holdings.map((holding) => (
                    <li key={`${holding.chainId}:${holding.address ?? 'native'}`} className={styles.balance__row}>
                      <TokenIcon
                        token={{ address: holding.address, symbol: holding.symbol, logo: holding.address ? null : nativeLogo(holding.chainId) }}
                        chainId={holding.chainId}
                        size="md"
                      />
                      <span className={styles.balance__name}>
                        <span className={styles.balance__symbol}>{holding.symbol}</span>
                        {chainName(holding.chainId) && <span className={styles.balance__chain}>{chainName(holding.chainId)}</span>}
                      </span>
                      <span className={styles.balance__amount}>
                        {amount.format(holding.amount)} {holding.symbol}
                      </span>
                      <span className={styles.balance__usd}>{usd.format(holding.usd)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.balance__empty}>Nothing here yet. Deposit to fund this wallet.</p>
              )}

              <div className={styles.balance__actions}>
                <button
                  type="button"
                  className={clsx(styles.actions__button, styles['actions__button--primary'])}
                  onClick={() => {
                    close()
                    openDeposit()
                  }}
                >
                  Deposit
                </button>
              </div>

              {walletName && (
                <footer className={styles.balance__wallet}>
                  {walletIcon && <img src={walletIcon} alt="" width={28} height={28} />}
                  <span>
                    <span className={styles['balance__wallet-hint']}>Connected with</span>
                    <strong>{walletName}</strong>
                  </span>
                </footer>
              )}
            </>
          )}
        </NativePopover>
      )}

      <DepositDialog ref={depositRef} address={address} isSolana={isSolana} />
    </div>
  )
}
