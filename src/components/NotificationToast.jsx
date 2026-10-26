'use client'

import clsx from 'clsx'
import Avatar from '@/components/ui/Avatar'
import { Identicon } from '@/components/ui/UniversalIdentity/Identicon'
import { DEFAULT_PFP, DEFAULT_USERNAME, useProfile } from '@/hooks/useProfile'
import { shortAddress } from '@/lib/address'
import styles from './NotificationToast.module.scss'

const AVATAR_SIZE = 36

const countFormat = new Intl.NumberFormat('en')
const listFormat = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })
const pluralRules = new Intl.PluralRules('en')

const hasPicture = (profile) => Boolean(profile?.profileImage) && profile.profileImage !== DEFAULT_PFP

/**
 * The live toast's icon slot: the actor's profile picture, their blockie when they never set
 * one, and the action's glyph pinned to the corner in its tone (heart for a like, arrows for a
 * repost). Rendered into the toast through its own React root, so it reads the same global SWR
 * cache the feed does and fills in when the profile lands rather than holding the toast back.
 */
export function NotificationToastAvatar({ address, icon: Icon, weight }) {
  const { profile, isLoading } = useProfile(address)

  return (
    <span className={styles['notification-toast__avatar']}>
      {isLoading && !profile ? (
        <span className={clsx(styles['notification-toast__picture'], styles['notification-toast__picture--pending'])} />
      ) : hasPicture(profile) ? (
        <Avatar src={profile.profileImage} size={AVATAR_SIZE} className={styles['notification-toast__picture']} loading="eager" />
      ) : (
        <Identicon address={address} size={AVATAR_SIZE} className={styles['notification-toast__picture']} />
      )}
      {Icon && (
        <span className={styles['notification-toast__badge']} aria-hidden="true">
          <Icon weight={weight ?? 'fill'} />
        </span>
      )}
    </span>
  )
}

/** "<b>Alice</b> and 3 others liked your post", with the address standing in until a name arrives. */
export function NotificationToastText({ address, others = 0, verb }) {
  const { profile } = useProfile(address)
  const named = profile?.fullName || (profile?.name !== DEFAULT_USERNAME && profile?.name)
  const name = named || shortAddress(address)
  const who = others > 0 ? [name, `${countFormat.format(others)} ${pluralRules.select(others) === 'one' ? 'other' : 'others'}`] : [name]

  // ListFormat supplies the joining "and"; formatToParts keeps the name its own part so it alone is bold
  return (
    <span className={styles['notification-toast__text']}>
      {listFormat.formatToParts(who).map((part, index) =>
        index === 0 ? <strong key={index} className={styles['notification-toast__name']}>{part.value}</strong> : part.value,
      )}
      {` ${verb}`}
    </span>
  )
}
