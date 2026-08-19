'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SOLANA_TOKENS } from '@/config/solanaTokens'
import { anchorElement } from './ui/NativePopover'
import Ticker from './Ticker'
import styles from './TickerTooltip.module.scss'

// The non-Solana cashtags, resolved through DIA. Solana mints live in config/solanaTokens
// instead — they need a curated allowlist rather than a chain name, because a Solana symbol
// is not unique and the popular ones all have same-symbol spoofs.
const TICKER_MAP = {
  // --- NATIVE COINS & MAJORS ---
  BTC: { chain: 'Bitcoin', address: '0x0000000000000000000000000000000000000000' },
  ETH: { chain: 'Ethereum', address: '0x0000000000000000000000000000000000000000' },
  BNB: { chain: 'BinanceSmartChain', address: '0x0000000000000000000000000000000000000000' },
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
  FDUSD: { chain: 'BinanceSmartChain', address: '0xc5f0f7b03112701c675600b99616dc53f306605e' },

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
  HYPE: { chain: 'Hyperliquid', address: '0x0d01dc56dcaaca66ad901c959b4011ec' },
  KAS: { chain: 'Kaspa', address: '0x0000000000000000000000000000000000000000' },
  IMX: { chain: 'Ethereum', address: '0xf57e7e7c23978c3caec3c3548e3d615c346e79ff' },
  WLD: { chain: 'Optimism', address: '0xdc6ff2101910f0a5147ff97d620952a7b7dd3707' },

  // --- SPECIAL ---
  LYX: { chain: 'Lukso', address: '0x0000000000000000000000000000000000000000' },
  GTC: { chain: 'Ethereum', address: '0xde30da39c46104798bb5aa3fe8b9e0e1f348163f' },
  CELO: { chain: 'Celo', address: '0x471ece3750da237f93b8e339c536989b8978a438' },
  G: { chain: 'Celo', address: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A' },
}

/**
 * The cashtag card, in the native top layer.
 *
 * Hover is not an input mode on a phone, and this app is read on phones — so a fine pointer
 * gets the old hover behavior and a coarse one taps to open. The panel is a real `popover`
 * rather than a floating div: that buys light-dismiss, Escape, and top-layer stacking from
 * the platform, and it anchors through NativePopover's own `anchorElement` so cards hang by
 * the same rules as every other anchored panel in the app.
 */
export default function TickerTooltip() {
  const [active, setActive] = useState(null)
  const panelRef = useRef(null)
  const triggerRef = useRef(null)
  // A tap on an open card's own cashtag should close it. The browser light-dismisses on
  // pointerdown, well before the click below lands, so without remembering what just closed
  // the handler would simply reopen the card and the tap would read as a no-op.
  const lastClosed = useRef({ symbol: null, at: 0 })

  const hide = useCallback(() => {
    try {
      panelRef.current?.hidePopover()
    } catch {
      /* already closed */
    }
  }, [])

  const show = useCallback((target, symbol) => {
    // Solana first: those resolve from the curated mint allowlist, not a chain name.
    // An unknown cashtag shows nothing — defaulting it to Ethereum only ever produced a
    // lookup for an address the app does not have.
    const config = SOLANA_TOKENS[symbol] ? { chain: 'Solana', address: null } : TICKER_MAP[symbol]
    if (!config) return

    triggerRef.current = target
    setActive({ symbol, chain: config.chain, address: config.address })
  }, [])

  useEffect(() => {
    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches

    const handleMouseOver = (e) => {
      const target = e.target.closest('.ticker-trigger')
      if (target) show(target, target.getAttribute('data-symbol'))
    }

    const handleMouseOut = (e) => {
      if (e.target.closest('.ticker-trigger')) hide()
    }

    // Capture phase: post and comment cards navigate to the thread on click, and their
    // handlers run on React's root container. Stopping here keeps a tap on a cashtag from
    // also opening the post.
    const handleClick = (e) => {
      const target = e.target.closest('.ticker-trigger')
      if (!target) return
      e.preventDefault()
      e.stopPropagation()

      const symbol = target.getAttribute('data-symbol')
      const justClosed = lastClosed.current.symbol === symbol && Date.now() - lastClosed.current.at < 400
      if (justClosed) {
        lastClosed.current = { symbol: null, at: 0 }
        return
      }
      show(target, symbol)
    }

    // Hover exists only on fine pointers, but the click guard is unconditional. A cashtag is
    // an interactive element: clicking one must never open the post underneath, on any device.
    // Binding this for coarse pointers alone left every hybrid in between — touch laptops,
    // device emulation, Android browsers that report (hover: hover) — falling straight through
    // to the card's own navigation.
    if (canHover) {
      document.addEventListener('mouseover', handleMouseOver)
      document.addEventListener('mouseout', handleMouseOut)
    }
    document.addEventListener('click', handleClick, true)

    return () => {
      document.removeEventListener('mouseover', handleMouseOver)
      document.removeEventListener('mouseout', handleMouseOut)
      document.removeEventListener('click', handleClick, true)
    }
  }, [hide, show])

  // Open and anchor once the card's content is in the DOM. The quote arrives over SWR, so the
  // panel grows from "Loading..." to a full card after it is already placed — a ResizeObserver
  // re-anchors it rather than leaving it hanging off its first, much smaller, measurement.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !active) return

    const place = () => anchorElement(panel, triggerRef.current, 'top')

    if (!panel.matches(':popover-open')) {
      panel.style.visibility = 'hidden'
      panel.showPopover()
    }
    const frame = requestAnimationFrame(() => {
      place()
      panel.style.visibility = ''
    })

    const observer = new ResizeObserver(() => {
      if (panel.matches(':popover-open')) place()
    })
    observer.observe(panel)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [active])

  // Light-dismiss and Escape close the panel without going through hide(), so the React state
  // has to follow the element rather than the other way around
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const handleToggle = (e) => {
      if (e.newState === 'closed') {
        lastClosed.current = { symbol: active?.symbol ?? null, at: Date.now() }
        setActive(null)
      }
    }

    panel.addEventListener('toggle', handleToggle)
    return () => panel.removeEventListener('toggle', handleToggle)
  }, [active])

  return (
    <div ref={panelRef} popover="auto" className={styles.floatingContainer}>
      {active && <Ticker blockchain={active.chain} address={active.address} symbol={active.symbol} />}
    </div>
  )
}
