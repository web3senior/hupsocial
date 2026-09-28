/**
 * @file lib/lazyWalletConnect.js
 * @description wagmi's WalletConnect connector, started only when there is something to start it for.
 *
 * wagmi's reconnect() walks every connector on page load and reports nothing until the last one
 * has answered. The stock connector answers by downloading and initialising the whole WalletConnect
 * client, so every visitor waited on it — whichever wallet they actually use.
 */

import { createConnector } from 'wagmi'
import { walletConnect } from 'wagmi/connectors'

export function lazyWalletConnect(parameters) {
  const createInner = walletConnect(parameters)

  return createConnector((config) => {
    const inner = createInner(config)

    // Once started the provider stays reachable: the disconnect handlers read it after the
    // session record is already gone
    let live = false

    // Written by the connector when a session is made, emptied when it ends
    const hasSession = async () => {
      const chains = await config.storage?.getItem(inner.requestedChainsStorageKey)
      return Array.isArray(chains) && chains.length > 0
    }

    return {
      ...inner,

      async connect(args = {}) {
        if (!args.isReconnecting) live = true
        return inner.connect.call(this, args)
      },

      async getProvider(args) {
        if (!live && !(await hasSession())) return undefined
        live = true
        return inner.getProvider.call(this, args)
      },
    }
  })
}
