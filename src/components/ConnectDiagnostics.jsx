'use client'

import { useEffect, useState } from 'react'
import { useConnection, useConnectors } from 'wagmi'
import { useWidgetInfo } from '@/components/chat/useEmbedBridge'
import { LUKSO_CONNECTOR_ID } from '@/lib/luksoConnector'
import { UP_PROVIDER_RDNS, walletOffer } from '@/lib/upProviderClient'
import styles from './ConnectDiagnostics.module.scss'

// Bump with every change to how wallets are found: it tells a cached page from the current one
const CONNECT_VERSION = '1.4.0'
const REFRESH_MS = 2000
const ANNOUNCE_WAIT_MS = 400
const MAX_DEPTH = 10

const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`

const frameDepth = () => {
  let depth = 0
  let scope = window
  try {
    while (scope !== scope.parent && depth < MAX_DEPTH) {
      scope = scope.parent
      depth += 1
    }
  } catch {
    // A parent that cannot be reached still counts as the frame it is
  }
  return depth
}

const announcedWallets = () =>
  new Promise((resolve) => {
    const names = new Set()
    const handleAnnounce = (event) => names.add(event.detail?.info?.name || event.detail?.info?.rdns || 'unnamed')
    window.addEventListener('eip6963:announceProvider', handleAnnounce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', handleAnnounce)
      resolve([...names])
    }, ANNOUNCE_WAIT_MS)
  })

const describeEthereum = () => {
  if (!window.ethereum) return 'no'
  return window.ethereum === window.lukso ? 'yes, same as window.lukso' : 'yes'
}

const RELAYED_FROM = {
  grid: 'the Grid',
  'page client': "the site's Grid client",
  injected: "the site's own wallet",
}

const describeGrid = async (connector) => {
  if (!connector) return 'not offered'
  const accounts = await connector.getAccounts().catch(() => [])
  const from = RELAYED_FROM[walletOffer()?.source] || 'the Grid'
  return accounts.length ? `${shortAddress(accounts[0])} from ${from}` : `offered by ${from}, nothing granted`
}

const describeHost = (host) => {
  if (!host) return { page: 'unknown', lukso: 'unknown', ethereum: 'unknown', wallets: 'unknown' }
  return {
    page: host.framed ? 'framed' : 'top level',
    lukso: host.lukso ? 'yes' : 'no',
    ethereum: host.ethereum ? 'yes' : 'no',
    wallets: host.announced.length ? host.announced.join(', ') : 'none',
  }
}

/**
 * What this browser gives the page to connect with, for the places a console cannot be opened:
 * a wallet app's own browser, a frame inside the Grid. Only shown there, and read only while open.
 */
export default function ConnectDiagnostics() {
  const connectors = useConnectors()
  const { status } = useConnection()
  const [isShown, setIsShown] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [facts, setFacts] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const widget = useWidgetInfo(isShown, refresh)

  useEffect(() => {
    setIsShown(window.parent !== window || Boolean(window.lukso))
  }, [])

  useEffect(() => {
    if (!isOpen) return undefined
    let isStale = false

    const read = async () => {
      const depth = frameDepth()
      const [wallets, grid] = await Promise.all([
        announcedWallets(),
        describeGrid(connectors.find((connector) => connector.id === UP_PROVIDER_RDNS)),
      ])
      if (isStale) return
      setFacts({
        page: depth ? `framed, ${depth} deep` : 'top level',
        lukso: window.lukso ? 'yes' : 'no',
        luksoConnector: connectors.some((connector) => connector.id === LUKSO_CONNECTOR_ID) ? 'added' : 'not needed or absent',
        ethereum: describeEthereum(),
        wallets: wallets.length ? wallets.join(', ') : 'none',
        grid,
        browser: window.navigator.userAgent,
      })
    }

    const tick = () => {
      read()
      setRefresh((count) => count + 1)
    }

    tick()
    const timer = setInterval(tick, REFRESH_MS)
    return () => {
      isStale = true
      clearInterval(timer)
    }
  }, [isOpen, connectors])

  if (!isShown) return null

  const host = describeHost(widget.host)
  // The site that carries the widget is where a wallet app's browser puts its wallet
  const hostRows = widget.version
    ? [
        ['Site page', host.page],
        ['Site window.lukso', host.lukso],
        ['Site window.ethereum', host.ethereum],
        ['Site announced wallets', host.wallets],
      ]
    : []

  const rows = [
    ['Connect', CONNECT_VERSION],
    ['Chat widget', widget.version ? `v${widget.version}` : 'none'],
    ['Page', facts?.page],
    ['window.lukso', facts?.lukso],
    ['window.lukso wallet', facts?.luksoConnector],
    ['window.ethereum', facts?.ethereum],
    ['Announced wallets', facts?.wallets],
    ...hostRows,
    ['Relayed wallet', facts?.grid],
    ['Status', status],
    ['Browser', facts?.browser],
  ]

  return (
    <details className={styles.diagnostics} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className={styles.diagnostics__summary}>Connection details</summary>
      <dl className={styles.diagnostics__list}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.diagnostics__row}>
            <dt className={styles.diagnostics__label}>{label}</dt>
            <dd className={styles.diagnostics__value}>{value ?? '…'}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
