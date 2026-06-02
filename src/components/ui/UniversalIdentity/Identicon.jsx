import React, { useEffect, useRef } from 'react'
import clsx from 'clsx'
import makeBlockie from 'ethereum-blockies-base64';
import jazzy from '@metamask/jazzicon'
import styles from './Identicon.module.scss'

export const Identicon = ({ address, name = '', profileImage = '', size = 16, className }) => {
  const iconRef = useRef(null)

  useEffect(() => {
    if (address && iconRef.current) {
      iconRef.current.innerHTML = ''

      // Combine all profile components into a single identifier string
      const identityString = `${address.toLowerCase()}_${name.trim()}_${profileImage.trim()}`

      // Generate a deterministic hash from the identity string using a simple DJB2 algorithm
      let hash = 5381
      for (let i = 0; i < identityString.length; i++) {
        hash = (hash * 33) ^ identityString.charCodeAt(i)
      }

      // Convert the signed bitwise hash into an unsigned 32-bit integer seed
      const seed = hash >>> 0

      // Render the unique canvas pattern based on the combined profile identity
      const iconElement = jazzy(size, seed)
      iconRef.current.appendChild(iconElement)
    }
  }, [address, name, profileImage, size])

  return (
    // <div
    //   ref={iconRef}
    //   className={clsx(styles['identicon-container'], className)}
    //   style={{ width: size, height: size }}
    //   title={name ? `${name} (${address})` : address}
    // />
    <img src={makeBlockie(`${address.toLowerCase()}_${name.trim()}_${profileImage.trim()}`)} 
    alt={name} className={clsx(styles['identicon-container'], className)} style={{ width: size, height: size }} />
  )
}
