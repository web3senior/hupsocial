'use client'

import { forwardRef } from 'react'
import useSWRImmutable from 'swr/immutable'
import QRCode from 'qrcode'
import { WarningIcon } from '@phosphor-icons/react'
import DialogSheet from '@/components/ui/DialogSheet'
import CopyButton from '@/components/ui/CopyButton'
import Shimmer from '@/components/ui/Shimmer'
import styles from './DepositDialog.module.scss'

// Dark on white whatever the theme: phone scanners read inverted codes poorly
const renderQr = ([, address]) =>
  QRCode.toDataURL(address, { margin: 0, width: 320, color: { dark: '#191B1A', light: '#ffffff' } })

/**
 * The wallet's own address as text and as a QR code, for funding it from an exchange or another
 * wallet. Nothing moves through Hup — this only says where to send. An EVM address is the same
 * on every EVM chain, so the warning names the one thing that does lose funds: sending from a
 * network of the other kind.
 * @param {{address: string|null, isSolana: boolean}} props
 */
const DepositDialog = forwardRef(function DepositDialog({ address, isSolana }, ref) {
  const { data: qr } = useSWRImmutable(address ? ['deposit-qr', address] : null, renderQr)
  const network = isSolana ? 'Solana' : 'EVM'

  return (
    <DialogSheet ref={ref} lightDismiss aria-label="Deposit" className={styles.deposit}>
      <DialogSheet.Header
        title="Deposit"
        description={isSolana ? 'Send any Solana asset to your wallet address.' : 'Send any EVM asset to your wallet address.'}
        onClose={() => ref?.current?.close()}
      />

      <DialogSheet.Body className={styles.deposit__body}>
        <div className={styles.deposit__main}>
          <div className={styles.deposit__details}>
            <p className={styles.deposit__label}>Your {network} deposit address</p>
            <p className={styles.deposit__address}>{address}</p>
            <CopyButton
              value={address ?? ''}
              label="Copy address"
              title="Copy address"
              copiedTitle="Copied"
              size={16}
              variant="chip"
              className={styles.deposit__copy}
            />
          </div>

          <div className={styles.deposit__qr}>
            {qr ? <img src={qr} alt={`QR code for ${address}`} /> : <Shimmer />}
          </div>
        </div>
      </DialogSheet.Body>

      <DialogSheet.Footer className={styles.deposit__footer}>
        <WarningIcon size={16} aria-hidden="true" />
        <span>
          {isSolana ? (
            <>
              Only send assets on the <strong>Solana</strong> network. Assets sent on any other network may be permanently lost.
            </>
          ) : (
            <>
              This address works on every <strong>EVM</strong> network. Never send from Solana, Bitcoin or another non-EVM network.
            </>
          )}
        </span>
      </DialogSheet.Footer>
    </DialogSheet>
  )
})

export default DepositDialog
