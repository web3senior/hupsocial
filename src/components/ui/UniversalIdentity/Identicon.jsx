import React from 'react'
import clsx from 'clsx'
import makeBlockie from 'ethereum-blockies-base64'
import styles from './Identicon.module.scss'

export const Identicon = ({ address, size = 16, className }) => {
  // Ensure we have a valid address string before transforming it
  const safeAddress = address ? address.toLowerCase() : ''

  // Generate the unique base64 image data using the sanitized address string
  const imageSource = safeAddress ? makeBlockie(safeAddress) : ''

  return (
    <img 
      src={imageSource} 
      alt={address ? `Identicon for ${address}` : 'Identicon'} 
      className={clsx(styles['identicon-container'], className)} 
      style={{ width: size, height: size }} 
    />
  )
}