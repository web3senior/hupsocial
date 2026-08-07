'use client'

import Link from 'next/link'
import { useConnection } from 'wagmi'
import { useClientMounted } from '@/hooks/useClientMount'
import { useProfile } from '@/hooks/useProfile'
import { WalletOptions } from '@/components/ConnectWallet'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'

export default function Page() {
  const mounted = useClientMounted()
  const { address, isConnected } = useConnection()

  return (
    <>
      <PageTitle name={`connect`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width={`medium`}>
          <section className={styles.card}>{!mounted ? <CardShimmer /> : isConnected && address ? <Connected addr={address} /> : <ChooseWallet />}</section>
        </div>
      </div>
    </>
  )
}

/**
 * Mirrors the WalletConnectDialog body so the standalone page and the modal
 * read as the same surface - same header, same hint, same option rows.
 */
function ChooseWallet() {
  return (
    <>
      <header className={styles.card__header}>
        <span className={styles.card__badge} aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" height="28px" viewBox="0 -960 960 960" width="28px" fill="currentColor">
            <path d="M224.62-160q-27.62 0-46.12-18.5Q160-197 160-224.62v-510.76q0-27.62 18.5-46.12Q197-800 224.62-800h510.76q27.62 0 46.12 18.5Q800-763 800-735.38V-680H544.62q-47.93 0-76.27 28.35Q440-623.31 440-575.38v190.76q0 47.93 28.35 76.27Q496.69-280 544.62-280H800v55.38q0 27.62-18.5 46.12Q763-160 735.38-160H224.62Zm320-160q-27.62 0-46.12-18.5Q480-357 480-384.62v-190.76q0-27.62 18.5-46.12Q517-640 544.62-640h230.76q27.62 0 46.12 18.5Q840-603 840-575.38v190.76q0 27.62-18.5 46.12Q803-320 775.38-320H544.62ZM640-420q26 0 43-17t17-43q0-26-17-43t-43-17q-26 0-43 17t-17 43q0 26 17 43t43 17Z" />
          </svg>
        </span>
        <h1 className={styles.card__title}>Connect wallet</h1>
        <p className={styles.card__hint}>Choose a wallet to continue.</p>
      </header>

      <WalletOptions />

      <p className={styles.card__note}>Connecting only shares your public address. Every onchain action still needs your approval in the wallet.</p>
    </>
  )
}

/**
 * Landing on /connect while already connected used to show the wallet list
 * again - a dead end. Confirm the session and point at the profile instead.
 */
function Connected({ addr }) {
  const { profile, isLoading } = useProfile(addr)
  const shortAddress = `${addr.slice(0, 6)}…${addr.slice(-4)}`

  return (
    <>
      <header className={styles.card__header}>
        <span className={styles.connected__avatar}>
          {isLoading || !profile ? <span className={`shimmer rounded`} style={{ width: `64px`, height: `64px` }} /> : <img src={profile.profileImage} alt="" className={`rounded`} />}
          <span className={styles.connected__check} aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor">
              <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
            </svg>
          </span>
        </span>
        <h1 className={styles.card__title}>{profile?.name ? profile.name : `Wallet connected`}</h1>
        <p className={styles.card__hint} title={addr}>
          {shortAddress}
        </p>
      </header>

      <div className={styles.connected__actions}>
        <Link href={`/${addr}`} className={styles.connected__primary}>
          View profile
        </Link>
        <Link href={`/`} className={styles.connected__secondary}>
          Go to feed
        </Link>
      </div>
    </>
  )
}

function CardShimmer() {
  return (
    <div className={styles.card__shimmer} aria-hidden="true">
      <span className={`shimmer rounded`} style={{ width: `56px`, height: `56px` }} />
      <span className={`shimmer`} style={{ width: `160px`, height: `20px` }} />
      <span className={`shimmer`} style={{ width: `100%`, height: `56px` }} />
      <span className={`shimmer`} style={{ width: `100%`, height: `56px` }} />
    </div>
  )
}
