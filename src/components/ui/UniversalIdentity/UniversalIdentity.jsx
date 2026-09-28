'use client'

import React, { useRef } from 'react'
import clsx from 'clsx'
import Avatar from '../Avatar'
import AvatarViewer from '../AvatarViewer'
import styles from './UniversalIdentity.module.scss'

/* The widest the only slot this renders in ever gets: the profile header's min(8rem, 28vw).
   The face itself is sized in CSS — this is what the encode is asked for, so the picture is
   sharp at the desktop diameter and simply has pixels to spare on a narrower screen. */
const SLOT_WIDTH_PX = 128

export const UniversalIdentity = ({
  displayName,
  profileImageUrl,
  fallbackAvatarUrl = '/default-pfp.svg',
  className,
}) => {
  const viewerRef = useRef(null)
  const alt = `${displayName}'s avatar`

  const avatar = (
    <Avatar
      src={profileImageUrl || fallbackAvatarUrl}
      size={SLOT_WIDTH_PX}
      className={styles['user-identity__avatar']}
      alt={alt}
    />
  )

  return (
    <div className={clsx(styles['user-identity'], className)}>
      {profileImageUrl ? (
        <>
          <button
            type="button"
            className={styles['user-identity__button']}
            onClick={() => viewerRef.current?.open()}
            aria-label="View profile picture"
          >
            {avatar}
          </button>
          <AvatarViewer ref={viewerRef} src={profileImageUrl} alt={alt} />
        </>
      ) : (
        <div className={styles['user-identity__button']}>{avatar}</div>
      )}
    </div>
  )
}

export default UniversalIdentity
