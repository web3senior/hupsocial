'use client';

import React, { useState, useEffect } from 'react';
import { useTicker } from '@/hooks/useTicker';
import styles from './Ticker.module.scss';

export default function Ticker({ blockchain, address }) {
  const { tickerData, isLoading, isError } = useTicker(blockchain, address);
  const [lastPrice, setLastPrice] = useState(null);
  const [flashClass, setFlashClass] = useState('');

  /* handle price flash logic */
  useEffect(() => {
    if (tickerData?.Price && lastPrice !== null) {
      if (tickerData.Price > lastPrice) {
        setFlashClass(styles.flashUp);
      } else if (tickerData.Price < lastPrice) {
        setFlashClass(styles.flashDown);
      }

      /* remove class after animation finishes */
      const timer = setTimeout(() => setFlashClass(''), 1000);
      return () => clearTimeout(timer);
    }
    
    if (tickerData?.Price) {
      setLastPrice(tickerData.Price);
    }
  }, [tickerData?.Price]);

  if (isLoading) return <div className={styles.tickerContainer}>loading ticker...</div>;
  if (isError || !tickerData) return null;

  const priceChange = tickerData.PriceYesterday 
    ? ((tickerData.Price - tickerData.PriceYesterday) / tickerData.PriceYesterday) * 100 
    : 0;
  
  const isPositive = priceChange >= 0;

  return (
    <div className={`${styles.tickerContainer} ${flashClass}`}>
      <div className={styles.info}>
        <span className={styles.label}>{tickerData.Name}</span>
        <span className={styles.symbol}>{tickerData.Symbol}</span>
      </div>

      <div className={styles.values}>
        <span className={`${styles.price} ${isPositive ? styles.up : styles.down}`}>
          ${tickerData.Price.toLocaleString(undefined, { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 4 
          })}
        </span>
        <span className={`${styles.change} ${isPositive ? styles.up : styles.down}`}>
          {isPositive ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}%
        </span>
      </div>
    </div>
  );
}