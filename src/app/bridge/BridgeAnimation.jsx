'use client'

import { useState } from 'react'
import Image from 'next/image'
import clsx from 'clsx'
import { Rise } from 'cube-motion/react'
import { ArrowRightIcon, PauseIcon, PlayIcon } from '@phosphor-icons/react'
import styles from './BridgeAnimation.module.scss'

const chains = [
  { name: 'Ethereum', logo: '/networks/ethereum.svg' },
  { name: 'Base', logo: '/networks/base.svg' },
  { name: 'Arbitrum', logo: '/networks/arbitrum.svg' },
  { name: 'Other EVM chains' },
]
const lanes = [28, 76, 124, 172]

export default function BridgeAnimation() {
  const [paused, setPaused] = useState(false)

  return (
    <Rise as="section" className={clsx(styles.flow, paused && styles['flow--paused'])} aria-label="ERC20 assets from EVM chains become LSP7 tokens on LUKSO">
      <div className={styles.flow__heading}>
        <div><span className={styles.flow__eyebrow}>CROSS THE BRIDGE</span><h2 className={styles.flow__title}>Many chains.<br /><span>One LUKSO.</span></h2></div>
        <button type="button" className={styles.flow__control} onClick={() => setPaused((value) => !value)} aria-label={paused ? 'Play bridge animation' : 'Pause bridge animation'} aria-pressed={paused}>
          {paused ? <PlayIcon size={14} weight="fill" /> : <PauseIcon size={14} weight="fill" />}
        </button>
      </div>
      <div className={styles.flow__diagram} aria-hidden="true">
        <div className={styles.flow__sources}>
          {chains.map((chain) => (
            <span key={chain.name} className={styles.flow__chain}>
              <span className={styles.flow__mark}>
                {chain.logo ? <Image src={chain.logo} alt="" width={22} height={22} /> : <span className={styles.flow__more}>•••</span>}
              </span>
              {chain.name}
            </span>
          ))}
        </div>
        <svg className={styles.flow__routes} viewBox="0 0 320 200" preserveAspectRatio="none">
          <defs>
            <linearGradient id="bridge-flow-gradient"><stop stopColor="#8b8bce" /><stop offset="1" stopColor="#fd1669" /></linearGradient>
          </defs>
          {lanes.map((y, index) => {
            const path = `M 0 ${y} C 145 ${y}, 155 100, 238 100 L 320 100`
            return (
              <g key={y}>
                <path className={styles.flow__route} d={path} />
                <path className={styles.flow__trail} d={path} pathLength="100" style={{ animationDelay: `${index * -0.85}s` }} />
                <path className={styles.flow__signal} d={path} pathLength="100" style={{ animationDelay: `${index * -0.85}s` }} />
              </g>
            )
          })}
        </svg>
        <div className={styles.flow__destination}>

          <span className={styles.flow__logo}><span className={styles.flow__orbit} /><Image src="/networks/lukso.svg" alt="" width={48} height={48} /></span>
          <strong>LUKSO</strong>
          <span className={styles.flow__standard}>LSP7</span>
        </div>
      </div>
      <div className={styles.flow__caption}><span><small>FROM EVM CHAINS</small>ERC20</span><span className={styles.flow__conversion}><ArrowRightIcon size={22} /></span><span><small>ON LUKSO</small>LSP7</span></div>
      <p className={styles.flow__note}>Same assets. A new home in your Universal Profile.</p>
      <p className={styles.flow__availability}>Illustrative routes · Available chains appear below when live.</p>
    </Rise>
  )
}

