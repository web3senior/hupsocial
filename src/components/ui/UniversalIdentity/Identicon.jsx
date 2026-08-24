import React from 'react'
import clsx from 'clsx'
import makeBlockie from 'ethereum-blockies-base64'
import { normalizeAddress } from '@/lib/address'
import styles from './Identicon.module.scss'

export const Identicon = ({ address, size = 16, className }) => {
  // Hex lowercased, base58 kept verbatim — two Solana keys that differ only by case must not
  // collapse onto one blockie
  const safeAddress = normalizeAddress(address) ?? ''

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