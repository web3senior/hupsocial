'use client'

import { useState } from 'react'
import clsx from 'clsx'
import { SOLANA_ICON_URL } from '@/config/solana'
import { shortAddress } from '@/lib/address'
import { useSolanaWallet } from '@/hooks/useSolanaWallet'
import { toast } from '@/components/NextToast'
import NativePopover from '@/components/ui/NativePopover'
import styles from './SolanaConnectButton.module.scss'

const PHANTOM_URL = 'https://phantom.com/download'

/**
 * Connect / account pill for the Solana wallet. Sits beside the EVM wallet UI rather than
 * inside it: both can be connected at once, and only the Solana write paths read this one.
 * Wallets come from the Wallet Standard registry, so any installed Solana wallet is offered.
 *
 * @param {string} [className] extra class for the pill
 * @param {string} [placement] NativePopover placement for the panel
 */
export default function SolanaConnectButton({ className, placement = 'bottom-end' }) {
  const { address, isConnected, status, walletName, wallets, connect, disconnect } = useSolanaWallet()
  const [busy, setBusy] = useState(null)

  const handleConnect = async (name, close) => {
    setBusy(name)
    try {
      await connect(name)
      close?.()
    } catch (error) {
      toast(error.message || 'Could not connect the wallet', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      toast('Address copied', 'success')
    } catch (error) {
      toast('Could not copy the address', 'error')
    }
  }

  if (isConnected) {
    return (
      <NativePopover
        placement={placement}
        className={styles.solanaConnectPanel}
        trigger={
          <button
            type="button"
            className={clsx(styles.solanaConnect, styles['solanaConnect--connected'], className)}
            title={address}
            aria-label={`Solana wallet ${address}`}
          >
            <img src={SOLANA_ICON_URL} alt="" className={styles.solanaConnect__icon} />
            <span className={styles.solanaConnect__label}>{shortAddress(address, { head: 4, tail: 4 })}</span>
          </button>
        }
      >
        {({ close }) => (
          <div className={styles.solanaConnectPanel__container}>
            <p className={styles.solanaConnectPanel__hint}>{walletName}</p>
            <button type="button" className={styles.solanaConnectPanel__address} onClick={handleCopy} title="Copy address">
              {address}
            </button>
            <button
              type="button"
              className={styles.solanaConnectPanel__item}
              onClick={() => {
                disconnect()
                close()
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </NativePopover>
    )
  }

  return (
    <NativePopover
      placement={placement}
      className={styles.solanaConnectPanel}
      trigger={
        <button type="button" className={clsx(styles.solanaConnect, className)} disabled={status === 'connecting'}>
          <img src={SOLANA_ICON_URL} alt="" className={styles.solanaConnect__icon} />
          <span className={styles.solanaConnect__label}>{status === 'connecting' ? 'Connecting…' : 'Connect Solana wallet'}</span>
        </button>
      }
    >
      {({ close }) => (
        <div className={styles.solanaConnectPanel__container}>
          {wallets.length === 0 ? (
            <p className={styles.solanaConnectPanel__hint}>
              No Solana wallet found.{' '}
              <a href={PHANTOM_URL} target="_blank" rel="noopener noreferrer">
                Get Phantom
              </a>
            </p>
          ) : (
            wallets.map((wallet) => (
              <button
                key={wallet.name}
                type="button"
                className={styles.solanaConnectPanel__item}
                onClick={() => handleConnect(wallet.name, close)}
                disabled={busy !== null}
              >
                <img src={wallet.icon} alt="" className={styles.solanaConnectPanel__walletIcon} />
                <span>{wallet.name}</span>
                {busy === wallet.name && <span className={styles.solanaConnectPanel__busy}>…</span>}
              </button>
            ))
          )}
        </div>
      )}
    </NativePopover>
  )
}
