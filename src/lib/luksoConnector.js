/**
 * @file lib/luksoConnector.js
 * @description A wagmi connector for a wallet that is only there as `window.lukso`. The Universal
 * Profile extension also announces itself over EIP-6963, which wagmi discovers by itself; an
 * in-app browser that injects the object and announces nothing never reaches the list otherwise.
 */

import { injected } from 'wagmi/connectors'
import { reconnect } from 'wagmi/actions'

export const LUKSO_CONNECTOR_ID = 'lukso.injected'

// Injection can land after the page's own scripts
const CHECKS_MS = [0, 800, 2500, 6000]
const RECONNECT_WAIT_MS = 100
const RECONNECT_WAIT_TRIES = 50

const isLuksoProvider = (provider) => Boolean(provider) && (provider === window.lukso || provider.isUniversalProfileExtension === true)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** wagmi's own reconnect ran before this connector existed, so a returning session is picked up here */
const resume = async (config, connector) => {
  const recent = await config.storage?.getItem('recentConnectorId')
  if (recent !== LUKSO_CONNECTOR_ID) return

  // reconnect() ignores a call made while another is still running
  for (let tries = 0; config.state.status === 'reconnecting' && tries < RECONNECT_WAIT_TRIES; tries++) await wait(RECONNECT_WAIT_MS)
  if (config.state.status === 'disconnected') await reconnect(config, { connectors: [connector] })
}

/**
 * Adds the connector once `window.lukso` is there, and takes it back out if the same wallet turns
 * out to announce itself, so it is never listed twice.
 * @returns {() => void} stops watching
 */
export function watchLuksoProvider(config) {
  if (typeof window === 'undefined') return () => {}

  const store = config._internal.connectors
  let isAnnounced = false

  const remove = () => {
    const own = config.connectors.find((connector) => connector.id === LUKSO_CONNECTOR_ID)
    // The one in use stays: dropping it would strand the session it holds
    if (!own || config.state.current === own.uid) return
    store.setState((list) => list.filter((connector) => connector !== own))
  }

  const add = () => {
    if (isAnnounced || !window.lukso) return
    if (config.connectors.some((connector) => connector.id === LUKSO_CONNECTOR_ID)) return

    const connector = store.setup(
      injected({ target: { id: LUKSO_CONNECTOR_ID, name: 'Universal Profile', provider: (scope) => scope?.lukso } })
    )
    store.setState((list) => [...list, connector])
    resume(config, connector).catch(() => {})
  }

  const handleAnnounce = (event) => {
    if (!isLuksoProvider(event.detail?.provider)) return
    isAnnounced = true
    remove()
  }

  window.addEventListener('eip6963:announceProvider', handleAnnounce)
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  const timers = CHECKS_MS.map((ms) => setTimeout(add, ms))

  return () => {
    window.removeEventListener('eip6963:announceProvider', handleAnnounce)
    timers.forEach(clearTimeout)
  }
}
