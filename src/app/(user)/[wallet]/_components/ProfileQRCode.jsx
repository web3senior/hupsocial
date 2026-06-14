import React from 'react'
import useSWR from 'swr'
import QRCode from 'qrcode'
import clsx from 'clsx'
import { QrCode } from 'lucide-react'
import NativePopover from '@/components/ui/NativePopover'
import styles from './ProfileQRCode.module.scss'

const qrCodeFetcher = async ([_, profileUrl]) => {
  if (!profileUrl) return ''

  return await QRCode.toDataURL(profileUrl, {
    margin: 0,
    width: 240,
    color: {
      dark: '#191B1A',
      light: '#ffffff',
    },
  })
}

export function ProfileQRCode({ profileUrl }) {
  // Execute async QR canvas calculation inside cached hook pipeline
  const { data: qrCodeDataUri, isValidating } = useSWR(profileUrl ? ['profile-qrcode', profileUrl] : null, qrCodeFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 3600000,
  })

  return (
    <NativePopover
      trigger={
        <button type="button" className={clsx(styles.link, styles.qrButton)} aria-label="QR Code">
          <div className={styles.iconWrapper}>
            <QrCode size={14} />
          </div>
        </button>
      }
      placement="center"
      type="auto"
    >
      {({ close }) => (
        <div className={styles.popoverContent}>
          <div className={styles.qrContainer}>
            {isValidating && !qrCodeDataUri && <div className={styles.qrContainer__skeleton} aria-hidden="true" />}

            {qrCodeDataUri && (
              <div className={styles.qrContainer__wrapper}>
                <img src={qrCodeDataUri} alt="Profile QR Code" className={styles.qrContainer__image} loading="lazy" />
              </div>
            )}
          </div>
        </div>
      )}
    </NativePopover>
  )
}
