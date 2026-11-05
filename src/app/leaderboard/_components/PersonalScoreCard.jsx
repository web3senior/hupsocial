'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { Rise } from 'cube-motion/react'
import { ArrowUpRightIcon, ArrowsClockwiseIcon, CrownSimpleIcon, SparkleIcon, TrophyIcon } from '@phosphor-icons/react'
import { useProfile } from '@/hooks/useProfile'
import Profile from '@/components/Profile'
import Shimmer from '@/components/ui/Shimmer'
import { profilePath } from '@/lib/username'
import styles from './PersonalScoreCard.module.scss'

const numbers = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const dates = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** A season's SQL datetime (UTC) as a readable date. */
const seasonDate = (value) => dates.format(new Date(`${value.replace(' ', 'T')}Z`))

const fetchScore = async (url) => {
  const response = await fetch(url)
  // Not on the board yet is an answer, not a failure
  if (response.status === 404) return { data: null, meta: {} }
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error('Your score could not be loaded')
  return result
}

/**
 * Your Hup card: the connected wallet's place in the points season — rank, points and how they
 * split — beside the season's own totals. Nothing renders without a wallet.
 */
export default function PersonalScoreCard() {
  const { address } = useConnection()
  if (!address) return null
  return <ScoreCard key={address} address={address} />
}

function ScoreCard({ address }) {
  const [revealed, setRevealed] = useState(false)
  const { profile } = useProfile(address)
  const { data, error, isLoading, mutate } = useSWR(`/api/v1/points?${new URLSearchParams({ wallet: address, limit: '1' })}`, fetchScore)

  const mine = data?.meta?.mine
  const season = data?.meta?.season
  const totals = data?.meta?.totals
  const total = totals?.participants
  const value = mine?.points ?? 0
  const rank = mine?.rank
  const percentile = rank && total ? Math.max(1, Math.ceil((rank / total) * 100)) : null
  // Share of the other ranked wallets this one is ahead of: first place fills the meter
  const ahead = rank && total ? total - rank : 0
  const meter = total > 1 ? Math.round((ahead / (total - 1)) * 100) : 100
  const scope = season?.name || 'Current season'
  const ready = !isLoading && !error

  return (
    <section className={styles.score} aria-label="Your Hup card">
      <div className={styles.score__intro}>
        <span className={styles.score__eyebrow}>
          <SparkleIcon size={16} aria-hidden="true" />
          Your Hup card
        </span>
        <h2 className={styles.score__title}>
          {rank ? <>You&rsquo;re #{numbers.format(rank)}{percentile && <span className={styles.score__titleSub}> · top {percentile}%</span>}</> : <>Your activity.<br />Your place in Hup.</>}
        </h2>
        <p className={styles.score__lede}>
          {isLoading
            ? 'Checking where you stand…'
            : rank && season
              ? `${scope} · live since ${seasonDate(season.startsAt)}.`
              : unrankedHint(mine)}
        </p>

        {/* The season's own totals: how many are in it, how much is earned, and how long it runs */}
        {totals && (
          <ul className={styles.score__totals} aria-label={`${scope} totals`}>
            <li>
              <strong>{numbers.format(totals.participants)}</strong> ranked wallets
            </li>
            <li>
              <strong>{compact.format(totals.points)}</strong> points earned
            </li>
            <li>{season?.endsAt ? `Ends ${seasonDate(season.endsAt)}` : 'Runs until the token launch · snapshot announced 2 weeks ahead'}</li>
          </ul>
        )}

        <div className={styles.score__actions}>
          {error ? (
            <button type="button" className={styles.score__button} onClick={() => mutate()}>
              <ArrowsClockwiseIcon size={18} aria-hidden="true" />
              Retry
            </button>
          ) : (
            <button type="button" className={styles.score__button} onClick={() => setRevealed(!revealed)} aria-expanded={revealed} disabled={!ready}>
              <ArrowsClockwiseIcon size={18} aria-hidden="true" />
              {revealed ? 'Show my score' : 'Show breakdown'}
            </button>
          )}
          <Link href={rank ? profilePath(address, profile?.username) : '/'} className={styles.score__link}>
            {rank ? 'View profile' : 'Start posting'}
            <ArrowUpRightIcon size={16} aria-hidden="true" />
          </Link>
        </div>
        {error && <p className={styles.score__error}>{error.message}</p>}
      </div>

      <div className={styles.score__stage}>
        <div className={styles.score__halo} aria-hidden="true" />
        <Rise
          key={revealed ? 'back' : 'front'}
          className={clsx(styles.score__card, ready && styles['score__card--ready'])}
        >
          <div className={clsx(styles.score__face, revealed && styles['score__face--back'])} aria-live="polite" aria-busy={isLoading}>
            <div className={styles.score__head}>
              <Profile creator={address} variant="fullWithoutTime" size={48} />
            </div>

            {isLoading ? (
              <div className={styles.score__placeholder}>
                <Shimmer style={{ width: '60%', height: 22 }} />
                <Shimmer style={{ width: '80%', height: 48 }} />
                <Shimmer style={{ width: '100%', height: 64 }} />
              </div>
            ) : revealed ? (
              <dl className={styles.score__stats}>
                <Stat icon={SparkleIcon} label="Social" value={mine?.social_points} />
                <Stat icon={CrownSimpleIcon} label="Achievements" value={mine?.achievement_points} />
              </dl>
            ) : (
              <div className={styles.score__body}>
                <span className={clsx(styles.score__rank, !rank && styles['score__rank--muted'])}>
                  <TrophyIcon size={16} weight="fill" aria-hidden="true" />
                  {rank ? `Rank #${numbers.format(rank)}` : 'Not ranked yet'}
                  {percentile && <span className={styles.score__badge}>Top {percentile}%</span>}
                </span>
                <strong className={styles.score__value} title={numbers.format(value)}>
                  {value >= 1e6 ? compact.format(value) : numbers.format(value)}
                </strong>
                <span className={styles.score__unit}>Season points</span>
                {percentile && (
                  <div className={styles.score__meter} role="img" aria-label={`Ahead of ${numbers.format(ahead)} ranked wallets`}>
                    <span style={{ '--score-meter': `${meter}%` }} />
                  </div>
                )}
              </div>
            )}

            <span className={styles.score__foot}>
              <span>Hup · Leaderboard</span>
              <span>{scope}</span>
            </span>
          </div>
        </Rise>
        <div className={styles.score__pedestal} aria-hidden="true" />
      </div>
    </section>
  )
}

function Stat({ icon: Icon, label, value = 0 }) {
  return (
    <div className={styles.score__stat} title={`${label}: ${numbers.format(value)}`}>
      <dt>
        <Icon size={14} aria-hidden="true" />
        {label}
      </dt>
      <dd>{compact.format(value)}</dd>
    </div>
  )
}

function unrankedHint(mine) {
  if (mine?.eligible_from) return 'Your profile needs to be a week old before your points count toward the standings.'
  return 'Post, comment and collect likes to earn season points.'
}
