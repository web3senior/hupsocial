'use client'

import { useEffect, useId, useRef } from 'react'
import { Rise } from 'cube-motion/react'
import { KeyIcon, ShieldCheckIcon } from '@phosphor-icons/react'
import { CHAIN_ICONS } from '@/config/chainIcons'
import styles from './VaultIllustration.module.scss'

export function ChainLogo({ chainId, size = 24 }) {
  const icon = CHAIN_ICONS[chainId]
  return icon
    // Local SVG data keeps gradient and clip-path IDs isolated between logos.
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={`data:image/svg+xml,${encodeURIComponent(icon)}`} width={size} height={size} alt="" draggable={false} />
    : <span className={styles.illustration__fallback} aria-hidden="true">◈</span>
}

export default function VaultIllustration({ threshold }) {
  const svgRef = useRef(null)
  const id = useId().replace(/:/g, '')

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const animations = svgRef.current?.querySelectorAll('animate, animateTransform') || []
    const sync = () => animations.forEach((animation) => {
      if (preference.matches) animation.endElement()
      else animation.beginElement()
    })
    sync()
    preference.addEventListener('change', sync)
    return () => {
      preference.removeEventListener('change', sync)
      animations.forEach((animation) => animation.endElement())
    }
  }, [])

  return (
    <Rise className={styles.illustration}>
      <div className={styles.illustration__grid} aria-hidden="true" />
      <svg ref={svgRef} className={styles.illustration__svg} viewBox="0 0 360 300" fill="none" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${id}-body`} x1="80" y1="65" x2="265" y2="255" gradientUnits="userSpaceOnUse"><stop stopColor="#52616F" /><stop offset="1" stopColor="#202D3A" /></linearGradient>
          <linearGradient id={`${id}-door`} x1="100" y1="85" x2="230" y2="245" gradientUnits="userSpaceOnUse"><stop stopColor="#344452" /><stop offset="1" stopColor="#17212D" /></linearGradient>
          <linearGradient id={`${id}-rim`} x1="121" y1="105" x2="206" y2="190" gradientUnits="userSpaceOnUse"><stop stopColor="#D9E4EC" /><stop offset="0.45" stopColor="#6B7F90" /><stop offset="1" stopColor="#D4DEE5" /></linearGradient>
          <radialGradient id={`${id}-glow`}><stop stopColor="currentColor" stopOpacity="0.2" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></radialGradient>
        </defs>
        <ellipse cx="180" cy="170" rx="175" ry="128" fill={`url(#${id}-glow)`} />
        <ellipse cx="180" cy="260" rx="110" ry="13" fill="#000" opacity="0.14" />
        <path d="M32 165C13 82 77 31 168 33M292 79C354 117 345 217 287 245" stroke="currentColor" strokeOpacity="0.22" strokeDasharray="3 6" />
        <path d="M85.99 62.58L117.99 42.58A17 17 0 0 1 127 40H257A17 17 0 0 1 274 57L242 77A17 17 0 0 0 225 60H95A17 17 0 0 0 85.99 62.58Z" fill="#728391" />
        <path d="M242 77L274 57V214A17 17 0 0 1 266.01 228.42L234.01 248.42A17 17 0 0 0 242 234V77Z" fill="#162330" />
        <path d="M251 76L258 72V216L251 220V76Z" fill="#263746" />
        <rect x="78" y="60" width="164" height="191" rx="17" fill={`url(#${id}-body)`} stroke="#8193A2" strokeWidth="1.5" />
        <rect x="89" y="72" width="141" height="166" rx="12" fill={`url(#${id}-door)`} stroke="#0D1722" strokeWidth="2" />
        <rect x="97" y="81" width="125" height="149" rx="8" stroke="#70818D" strokeOpacity="0.35" />
        <rect x="83" y="94" width="13" height="27" rx="4" fill="#8495A3" />
        <rect x="83" y="190" width="13" height="27" rx="4" fill="#8495A3" />
        <path d="M88 99V116M88 195V212" stroke="#B9C7D0" strokeWidth="2" strokeLinecap="round" />
        <image href="/logos/safe.svg" x="104" y="86" width="18" height="18" preserveAspectRatio="xMidYMid meet" />
        <rect x="188" y="89" width="22" height="7" rx="3.5" fill="#13251F" />
        <circle cx="193" cy="92.5" r="2" fill="#12FF80"><animate attributeName="opacity" values="1;0.4;1" dur="4s" repeatCount="indefinite" begin="indefinite" /></circle>
        <circle cx="161" cy="157" r="44" fill="#111B26" stroke="#6B7E8C" />
        <circle cx="161" cy="157" r="37" fill={`url(#${id}-rim)`} />
        <circle cx="161" cy="157" r="31" fill="#263644" stroke="#111E2A" strokeWidth="2" />
        <g>
          <animateTransform attributeName="transform" type="rotate" values="0 161 157;24 161 157;0 161 157;0 161 157" keyTimes="0;0.35;0.7;1" dur="10s" repeatCount="indefinite" begin="indefinite" />
          <path d="M161 130V184M134 157H188M142 138L180 176M142 176L180 138" stroke="#B2C3CF" strokeWidth="6" strokeLinecap="round" />
          <circle cx="161" cy="157" r="12" fill="#DAE5EC" stroke="#6D8292" strokeWidth="2" />
          <circle cx="161" cy="157" r="5" fill="#526978" />
        </g>
        <rect x="141" y="212" width="40" height="4" rx="2" fill="#607687" />
        <path d="M94 253V262H113V253M204 253V262H223V253" fill="#17232F" />
        <g transform="translate(32 106)"><rect width="34" height="34" rx="11" fill="#20343F" stroke="#718B97" /><KeyIcon x={7} y={7} size={20} color="#BAE4E4" /><animateTransform attributeName="transform" type="translate" values="32 106;32 100;32 106" dur="6s" repeatCount="indefinite" begin="indefinite" /></g>
        <g transform="translate(278 181)"><rect width="34" height="34" rx="11" fill="#20343F" stroke="#718B97" /><ShieldCheckIcon x={7} y={7} size={20} color="#BAE4E4" /><animateTransform attributeName="transform" type="translate" values="278 181;278 187;278 181" dur="7s" repeatCount="indefinite" begin="indefinite" /></g>
      </svg>
      {threshold && <span className={styles.illustration__caption}>{threshold} approvals required</span>}
    </Rise>
  )
}
