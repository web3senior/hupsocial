'use client'

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { CoinIcon, MegaphoneIcon, SealCheckIcon, SparkleIcon } from '@phosphor-icons/react'
import { useConnection } from 'wagmi'
import ambassadorMark from '@/../public/ambassadors.webp'
import Profile from '@/components/Profile'
import { profileFallbackFromRow } from '@/hooks/useProfile'
import { HUPSTER_PERKS, HUPSTER_TAG, ROLES } from '@/lib/roles'
import HupsterStatus from './HupsterStatus'
import styles from './HupstersIntro.module.scss'

const countFormat = new Intl.NumberFormat('en')

// Keyed by HUPSTER_PERKS ids; a perk added there without an icon here falls back to a sparkle.
// The coin is the tip button's own glyph, so the perk and the button read as one thing.
const PERK_ICONS = { mark: MegaphoneIcon, premium: SealCheckIcon, tips: CoinIcon }

const TIP_STEPS = [
  'Post about Hup on X or any other network.',
  `Post on Hup with the link to that post and #${HUPSTER_TAG}.`,
  'The community opens the link, checks it, and tips your Hup post.',
]

/**
 * Everything above the proof feed on /hupsters: the pitch, the perks, how tipping works, the
 * viewer's own place in the program, the ranking and the roster.
 */
export default function HupstersIntro() {
  const { address } = useConnection()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const { label } = ROLES.ambassador

  const read = useCallback(() => {
    const query = address ? `?viewer=${address}` : ''
    return fetch(`/api/v1/hupsters${query}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || 'Could not load Hupsters')
        setData(json.data)
        setError(null)
      })
      .catch((err) => setError(err.message))
  }, [address])

  useEffect(() => {
    read()
  }, [read])

  return (
    <div className={styles.hupsters}>
      <header className={styles.hupsters__hero}>
        <img className={styles['hupsters__hero-mark']} src={ambassadorMark.src || ambassadorMark} alt="" width={56} height={56} />
        <div>
          <h1 className={styles.hupsters__title}>{label}s</h1>
          <p className={styles.hupsters__lead}>
            Hup&apos;s ambassadors. Tell people about Hup wherever you post, bring friends in with your link, and get tipped for it.
          </p>
        </div>
      </header>

      <section className={styles.hupsters__section} aria-labelledby="hupsters-perks">
        <h2 id="hupsters-perks" className={styles.hupsters__heading}>
          What you get
        </h2>
        <ul className={styles.hupsters__perks}>
          {HUPSTER_PERKS.map((perk) => {
            const Icon = PERK_ICONS[perk.id] ?? SparkleIcon
            return (
              <li key={perk.id} className={styles.hupsters__perk}>
                <span className={styles['hupsters__perk-icon']} aria-hidden="true">
                  <Icon size={20} weight="fill" />
                </span>
                <strong>{perk.title}</strong>
                <span>{perk.body}</span>
              </li>
            )
          })}
        </ul>
      </section>

      <section className={styles.hupsters__section} aria-labelledby="hupsters-tips">
        <h2 id="hupsters-tips" className={styles.hupsters__heading}>
          How tips work
        </h2>
        <ol className={styles.hupsters__steps}>
          {TIP_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className={styles.hupsters__note}>
          Your proof posts appear in the feed below. Only posts by {label}s that carry #{HUPSTER_TAG} are listed, so anyone can find them and tip.
        </p>
      </section>

      <HupsterStatus viewer={data?.viewer ?? null} migrated={data?.migrated ?? true} onChange={read} />

      {error && <p className={clsx(styles.hupsters__note, styles['hupsters__note--error'])}>{error}</p>}

      <section className={styles.hupsters__section} aria-labelledby="hupsters-ranking">
        <h2 id="hupsters-ranking" className={styles.hupsters__heading}>
          Top {label}s
        </h2>
        <p className={styles.hupsters__note}>
          Ranked by people who joined through a {label}&apos;s link and went on to post — the last 30 days first, then all time.
        </p>
        {data?.ranking?.length ? (
          <ol className={styles.hupsters__ranking}>
            {data.ranking.map((row, index) => (
              <li key={row.wallet_address} className={styles.hupsters__rank}>
                <span className={styles['hupsters__rank-place']}>{index + 1}</span>
                <Profile creator={row.wallet_address} variant="fullWithoutTime" size={32} hoverCard={false} fallback={profileFallbackFromRow(row)} />
                <span className={styles['hupsters__rank-score']}>
                  <strong>{countFormat.format(row.recent)}</strong> this month · {countFormat.format(row.total)} all time
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.hupsters__note}>No referrals yet. The first {label} to bring someone in takes the top spot.</p>
        )}
      </section>

      {data?.holders?.length > 0 && (
        <section className={styles.hupsters__section} aria-labelledby="hupsters-roster">
          <h2 id="hupsters-roster" className={styles.hupsters__heading}>
            {label}s · {countFormat.format(data.holders.length)}
          </h2>
          <ul className={styles.hupsters__roster}>
            {data.holders.map((holder) => (
              <li key={holder.wallet_address}>
                <Profile creator={holder.wallet_address} variant="imageOnly" size={40} fallback={profileFallbackFromRow(holder)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className={clsx(styles.hupsters__heading, styles['hupsters__heading--feed'])}>Proof posts</h2>
    </div>
  )
}
