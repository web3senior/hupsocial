'use client'
import { useState, useEffect } from 'react'
import Ticker from './Ticker'
import styles from './TickerTooltip.module.scss'

// Define your supported tickers here
const TICKER_MAP = {
  // --- NATIVE COINS & MAJORS ---
  BTC: { chain: 'Bitcoin', address: '0x0000000000000000000000000000000000000000' },
  ETH: { chain: 'Ethereum', address: '0x0000000000000000000000000000000000000000' },
  BNB: { chain: 'BSC', address: '0x0000000000000000000000000000000000000000' },
  SOL: { chain: 'Solana', address: '0x0000000000000000000000000000000000000000' },
  XRP: { chain: 'Ripple', address: '0x0000000000000000000000000000000000000000' },
  ADA: { chain: 'Cardano', address: '0x0000000000000000000000000000000000000000' },
  DOGE: { chain: 'Dogecoin', address: '0x0000000000000000000000000000000000000000' },
  TRX: { chain: 'Tron', address: '0x0000000000000000000000000000000000000000' },
  DOT: { chain: 'Polkadot', address: '0x0000000000000000000000000000000000000000' },
  AVAX: { chain: 'Avalanche', address: '0x0000000000000000000000000000000000000000' },
  TON: { chain: 'Toncoin', address: '0x0000000000000000000000000000000000000000' },
  LTC: { chain: 'Litecoin', address: '0x0000000000000000000000000000000000000000' },
  BCH: { chain: 'BitcoinCash', address: '0x0000000000000000000000000000000000000000' },
  XLM: { chain: 'Stellar', address: '0x0000000000000000000000000000000000000000' },
  ETC: { chain: 'EthereumClassic', address: '0x0000000000000000000000000000000000000000' },
  XMR: { chain: 'Monero', address: '0x0000000000000000000000000000000000000000' },
  HBAR: { chain: 'Hedera', address: '0x0000000000000000000000000000000000000000' },
  SUI: { chain: 'Sui', address: '0x0000000000000000000000000000000000000000' },
  NEAR: { chain: 'Ethereum', address: '0x85f17cf997934a597031b2e18a9ab6ebd4b9f6a4' },
  ICP: { chain: 'InternetComputer', address: '0x0000000000000000000000000000000000000000' },
  APT: { chain: 'Aptos', address: '0x0000000000000000000000000000000000000000' },

  // --- STABLECOINS (Ethereum Addresses) ---
  USDT: { chain: 'Ethereum', address: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
  USDC: { chain: 'Ethereum', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
  DAI: { chain: 'Ethereum', address: '0x6b175474e89094c44da98b954eedeac495271d0f' },
  PYUSD: { chain: 'Ethereum', address: '0x6c3ea9036406852006290770bedfc107456ec065' },
  USDe: { chain: 'Ethereum', address: '0x4c9edd5852cd3058041ea5995af39617e0b791e0' },
  FDUSD: { chain: 'BSC', address: '0xc5f0f7b03112701c675600b99616dc53f306605e' },

  // --- TOP TOKENS ---
  LINK: { chain: 'Ethereum', address: '0x514910771af9ca656af840dff83e8264ecf986ca' },
  SHIB: { chain: 'Ethereum', address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce' },
  UNI: { chain: 'Ethereum', address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984' },
  PEPE: { chain: 'Ethereum', address: '0x6982508145454ce325ddbe47a25d4ec3d2311933' },
  AAVE: { chain: 'Ethereum', address: '0x7fc8691373c256c2142366370cbe4d153826b60c' },
  ARB: { chain: 'Arbitrum', address: '0x912ce59144191c1204e64559fe8253a0e49e6548' },
  OP: { chain: 'Optimism', address: '0x4200000000000000000000000000000000000042' },
  FET: { chain: 'Ethereum', address: '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85' },
  POL: { chain: 'Polygon', address: '0x0000000000000000000000000000000000001010' }, // Native on Polygon
  MNT: { chain: 'Mantle', address: '0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000' },
  STETH: { chain: 'Ethereum', address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84' },
  WBTC: { chain: 'Ethereum', address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' },
  LEO: { chain: 'Ethereum', address: '0x2af5d2ad76741191d15dfe7bf6ac92d4bd912ca3' },
  CRO: { chain: 'Cronos', address: '0x0000000000000000000000000000000000000000' },
  MKR: { chain: 'Ethereum', address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2' },
  RENDER: { chain: 'Ethereum', address: '0x6de037ef9a2759834140d935c192896b73c7518f' },
  TAO: { chain: 'Ethereum', address: '0x77e06c9eCCf2E797fd462A92B6D7642EF85b0A44' }, // Wrapped TAO
  ONDO: { chain: 'Ethereum', address: '0xfaba6f8e4a5e8b00f74123c018a745ad390e2418' },
  HYPE: { chain: 'Hyperliquid', address: '0x0000000000000000000000000000000000000000' },
  KAS: { chain: 'Kaspa', address: '0x0000000000000000000000000000000000000000' },
  IMX: { chain: 'Ethereum', address: '0xf57e7e7c23978c3caec3c3548e3d615c346e79ff' },
  WLD: { chain: 'Optimism', address: '0xdc6ff2101910f0a5147ff97d620952a7b7dd3707' },
  BONK: { chain: 'Solana', address: 'DeZdw7qyvOc68u1PosBy9UC3TJiFf4Bv9pbc76J89eFQ' },

  // --- SPECIAL ---
  LYX: { chain: 'Lukso', address: '0x0000000000000000000000000000000000000000' },
  GTC: { chain: 'Ethereum', address: '0xde30da39c46104798bb5aa3fe8b9e0e1f348163f' },
}

export default function TickerTooltip() {
  const [active, setActive] = useState(null)

  useEffect(() => {
    const handleMouseOver = (e) => {
      const target = e.target.closest('.ticker-trigger')
      if (target) {
        const symbol = target.getAttribute('data-symbol')
        const config = TICKER_MAP[symbol] || { chain: 'Ethereum', address: null }

        const rect = target.getBoundingClientRect()
        setActive({
          symbol,
          chain: config.chain,
          address: config.address,
          x: rect.left + rect.width / 2,
          y: rect.top,
        })
      }
    }

    const handleMouseOut = (e) => {
      if (e.target.closest('.ticker-trigger')) setActive(null)
    }

    document.addEventListener('mouseover', handleMouseOver)
    document.addEventListener('mouseout', handleMouseOut)

    return () => {
      document.removeEventListener('mouseover', handleMouseOver)
      document.removeEventListener('mouseout', handleMouseOut)
    }
  }, [])

  if (!active) return null

  return (
    <div
      className={styles.floatingContainer}
      style={{
        left: `${active.x}px`,
        top: `${active.y}px`,
        position: 'fixed',
        transform: 'translate(-50%, -100%)',
      }}
    >
      {/* If address is null, Ticker component can perform an internal search by symbol */}
      <Ticker blockchain={active.chain} address={active.address} symbol={active.symbol} />
    </div>
  )
}
