'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import styles from './TokenNavigation.module.scss'

const SECTIONS = [
  { id: 'token-overview', label: 'Overview' },
  { id: 'token-utility', label: 'Utility' },
  { id: 'token-buybacks', label: 'Buybacks' },
  { id: 'token-tokenomics', label: 'Tokenomics' },
  { id: 'token-airdrops', label: 'Airdrops' },
  { id: 'token-sale', label: 'Public sale' },
  { id: 'token-targets', label: 'Launch targets' },
  { id: 'token-roadmap', label: 'Roadmap' },
  { id: 'token-safeguards', label: 'Safeguards' },
  { id: 'token-faq', label: 'FAQ' },
]

export default function TokenNavigation() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id)
  const navigationRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    const targets = SECTIONS.map(({ id }) => document.getElementById(id)).filter(Boolean)
    let frame = 0

    const updateActiveSection = () => {
      frame = 0
      const navigation = navigationRef.current
      if (!navigation) return

      const bounds = navigation.getBoundingClientRect()
      const threshold = (window.matchMedia('(max-width: 760px)').matches ? bounds.bottom : bounds.top) + 24
      let currentId = SECTIONS[0].id

      for (const target of targets) {
        if (target.getBoundingClientRect().top <= threshold) currentId = target.id
      }

      // The final section may be too short to reach the navigation's lower edge.
      if (window.scrollY > 0 && Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 2) {
        currentId = SECTIONS.at(-1).id
      }

      setActiveId(currentId)
    }

    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateActiveSection)
    }

    scheduleUpdate()
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('hashchange', scheduleUpdate)
    const resizeObserver = new ResizeObserver(scheduleUpdate)
    if (navigationRef.current?.parentElement) resizeObserver.observe(navigationRef.current.parentElement)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('hashchange', scheduleUpdate)
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    const list = listRef.current
    const activeLink = list?.querySelector('[aria-current="location"]')
    if (!list || !activeLink) return

    const listBounds = list.getBoundingClientRect()
    const linkBounds = activeLink.getBoundingClientRect()
    if (linkBounds.left < listBounds.left || linkBounds.right > listBounds.right) {
      list.scrollTo({ left: list.scrollLeft + linkBounds.left - listBounds.left - (list.clientWidth - linkBounds.width) / 2 })
    }
    if (linkBounds.top < listBounds.top || linkBounds.bottom > listBounds.bottom) {
      list.scrollTo({ top: list.scrollTop + linkBounds.top - listBounds.top - (list.clientHeight - linkBounds.height) / 2 })
    }
  }, [activeId])

  return (
    <nav ref={navigationRef} className={styles.tokenNav} aria-label="$HUP sections">
      <div className={styles.tokenNav__brand}>
        <span className={styles.tokenNav__mark} aria-hidden="true" />
        <div><strong>$HUP</strong><span>The platform token</span></div>
      </div>
      <span className={styles.tokenNav__caption}>Explore the token</span>
      <ul ref={listRef} className={styles.tokenNav__list}>
        {SECTIONS.map(({ id, label }) => (
          <li key={id} className={styles.tokenNav__item}>
            <a
              href={`#${id}`}
              aria-current={activeId === id ? 'location' : undefined}
              className={clsx(styles.tokenNav__link, activeId === id && styles['tokenNav__link--active'])}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
      <p className={styles.tokenNav__note}>Pre-launch overview<span>Details may evolve before launch.</span></p>
    </nav>
  )
}
