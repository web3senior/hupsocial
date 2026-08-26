import React from 'react'
import clsx from 'clsx'
import { Identicon } from './Identicon'
import Avatar from '../Avatar'
import styles from './UniversalIdentity.module.scss'

/* The widest the only slot this renders in ever gets: the profile header's min(8rem, 28vw).
   The face itself is sized in CSS — this is what the encode is asked for, so the picture is
   sharp at the desktop diameter and simply has pixels to spare on a narrower screen. */
const SLOT_WIDTH_PX = 128

export const UniversalIdentity = ({
  displayName,
  smartContractAddress,
  profileImageUrl,
  fallbackAvatarUrl = '/default-pfp.svg',
  className,
}) => {
  const resolvedAvatar = profileImageUrl || fallbackAvatarUrl

  return (
    <div className={clsx(styles['user-identity'], className)}>
      <div className={styles['user-identity__avatar-wrapper']}>
        <div className={styles['user-identity__flipper']}>
          
          {/* FRONT SIDE: The standard uploaded profile image */}
          <div className={clsx(styles['user-identity__face'], styles['user-identity__face--front'])}>
            <Avatar
              src={resolvedAvatar}
              size={SLOT_WIDTH_PX}
              className={styles['user-identity__avatar']}
              alt={`${displayName}'s avatar`}
            />
          </div>

          {/* BACK SIDE: The full-size canvas identicon signature */}
          <div className={clsx(styles['user-identity__face'], styles['user-identity__face--back'])}>
            <Identicon
              name={displayName}
              profileImage={resolvedAvatar}
              address={smartContractAddress}
              /* Identicon writes its size as an inline style, which outranks the class below —
                 a px value here would pin the back face to one diameter while the front one
                 tracks the slot */
              size="100%"
              className={styles['user-identity__fingerprint-canvas']}
            />
          </div>

        </div>
      </div>
    </div>
  )
}

export default UniversalIdentity