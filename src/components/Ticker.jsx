'use client'
import React from 'react'
import { useTicker } from '@/hooks/useTicker'
import styles from './Ticker.module.scss'

export default function Ticker({ blockchain, address, symbol }) {
  /* Passing symbol allows the hook to 'discover' the address if missing */
  const { tickerData, isLoading, isError } = useTicker(blockchain, address, symbol)

  if (isLoading) return <div className={styles.tickerContainer}>Loading...</div>
  if (isError || !tickerData?.Price) return null

  const price = tickerData.Price
  const change = tickerData.PriceYesterday
    ? ((price - tickerData.PriceYesterday) / tickerData.PriceYesterday) * 100
    : 0

  const isPositive = change >= 0

  return (
    <div className={styles.tickerContainer}>
      <div className={styles.info}>
        <span className={styles.symbol}>{tickerData.Symbol}</span>
      </div>
      <div className={styles.values}>
        <span className={`${styles.price} ${isPositive ? styles.up : styles.down}`}>
          $
          {price.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: price < 1 ? 6 : 2,
          })}
        </span>
        <span className={`${styles.change} ${isPositive ? styles.up : styles.down}`}>
          {isPositive ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
        </span>
      </div>
    </div>
  )
}
