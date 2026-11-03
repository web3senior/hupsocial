'use client'

import React, { useRef } from 'react'
import clsx from 'clsx'
import Avatar from '../Avatar'
import AvatarViewer from '../AvatarViewer'
import DecorationFrame from '@/components/decorations/DecorationFrame'
import styles from './UniversalIdentity.module.scss'

/* The widest the only slot this renders in ever gets: the profile header's min(8rem, 28vw).
   The face itself is sized in CSS — this is what the encode is asked for, so the picture is
   sharp at the desktop diameter and simply has pixels to spare on a narrower screen. */
const SLOT_WIDTH_PX = 128

export const UniversalIdentity = ({
  displayName,
  profileImageUrl,
  fallbackAvatarUrl = '/default-pfp.svg',
  decorations,
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

  /* Framed outside the button rather than through Avatar's own prop: the button clips the
     picture to its circle, and the decorations have to spill past that edge. */
  return (
    <div className={clsx(styles['user-identity'], className)}>
      {profileImageUrl ? (
        <>
          <DecorationFrame decorations={decorations} size={SLOT_WIDTH_PX} fill>
            <button
              type="button"
              className={styles['user-identity__button']}
              onClick={() => viewerRef.current?.open()}
              aria-label="View profile picture"
            >
              {avatar}
            </button>
          </DecorationFrame>
          <AvatarViewer ref={viewerRef} src={profileImageUrl} alt={alt} />
        </>
      ) : (
        <DecorationFrame decorations={decorations} size={SLOT_WIDTH_PX} fill>
          <div className={styles['user-identity__button']}>{avatar}</div>
        </DecorationFrame>
      )}
    </div>
  )
}

export default UniversalIdentity
