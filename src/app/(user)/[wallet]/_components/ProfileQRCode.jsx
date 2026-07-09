import React, { useRef } from 'react'
import useSWR from 'swr'
import QRCode from 'qrcode'
import clsx from 'clsx'
import { QrCodeIcon } from '@phosphor-icons/react'
import NativeDialog from '@/components/ui/NativeDialog'
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
  const dialogRef = useRef(null)

  // Execute async QR canvas calculation inside cached hook pipeline
  const { data: qrCodeDataUri, isValidating } = useSWR(profileUrl ? ['profile-qrcode', profileUrl] : null, qrCodeFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 3600000,
  })

  return (
    <>
      <button
        type="button"
        className={clsx(styles.link, styles.qrButton)}
        aria-label="QR Code"
        onClick={() => dialogRef.current?.open()}
      >
        <div className={styles.iconWrapper}>
          <QrCodeIcon size={14} />
        </div>
      </button>

      <NativeDialog ref={dialogRef} lightDismiss className={styles.qrDialog} aria-label="Profile QR code">
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
      </NativeDialog>
    </>
  )
}
