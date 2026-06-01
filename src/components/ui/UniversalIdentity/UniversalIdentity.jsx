import React from 'react'
import clsx from 'clsx'
import { Identicon } from './Identicon'
import styles from './UniversalIdentity.module.scss'

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
            <img 
              src={resolvedAvatar} 
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
              size={80} // Matches full diameter of wrapper container
              className={styles['user-identity__fingerprint-canvas']} 
            />
          </div>

        </div>
      </div>
    </div>
  )
}

export default UniversalIdentity