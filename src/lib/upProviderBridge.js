/**
 * Host side of the LUKSO up-provider protocol — the transport that Grid mini apps built for
 * universaleverything.io speak (`createClientUPProvider()` from @lukso/up-provider). Serving it
 * next to the Hup bridge lets those apps run inside posts unmodified, against the viewer's
 * existing Hup wallet session (EOA or Universal Profile alike).
 *
 * Wire protocol, as implemented by @lukso/up-provider 0.3.x:
 *
 *   1. The client posts the bare string 'upProvider:hasProvider' (or
 *      'upProvider:requestIframeProvider') to window.parent. Same-origin clients transfer a
 *      MessagePort with it; cross-origin clients — which is every registered app, since the
 *      resolver refuses frames on Hup's own origin — send nothing and expect the server to
 *      create the MessageChannel.
 *   2. The server replies { type: 'upProvider:windowInitialize', chainId, allowedAccounts,
 *      contextAccounts, rpcUrls }, transferring port2 when it created the channel. The client
 *      ACKs with 'upProvider:windowInitialized' over the port.
 *   3. Everything after rides that port: JSON-RPC requests from the client, `{ id, result }` /
 *      `{ id, error }` replies from the server, and `{ method, params }` notifications
 *      (accountsChanged, contextAccountsChanged, chainChanged, connect) pushed by the server.
 *      A reply's `result` key must be present — structured clone drops `undefined`, and the
 *      client only settles a request on a present `result` or `error`.
 *
 * The client short-circuits eth_accounts / eth_chainId / wallet_switchEthereumChain /
 * up_contextAccounts locally from the init payload, and eth_call directly against `rpcUrls`,
 * so what actually reaches this bridge is mostly transactions, signatures, and reads — all of
 * which go through the same executeWalletMethod policy as the Hup bridge: confirmation dialogs
 * for anything that signs, spoof checks, forbidden-method refusals.
 *
 * Trust model is identical to the Hup bridge: the frame is hostile, identity comes from
 * `event.source === iframe.contentWindow`, and the registered origin is enforced on top.
 */

import { executeWalletMethod } from './miniAppBridge'

const HANDSHAKE_MESSAGES = new Set(['upProvider:hasProvider', 'upProvider:requestIframeProvider'])
const WRAPPED_TYPE = 'upProvider:jsonrpc'

/**
 * Serves the up-provider protocol to a sandboxed iframe.
 *
 * @param {object} options
 * @param {HTMLIFrameElement} options.iframe The frame to serve. Identity is bound to its contentWindow.
 * @param {object} options.app Resolved registry record ({ appId, chainId, name, origin }).
 * @param {number} options.chainId The app's registered chain — served as the provider's chain
 *        regardless of what network the viewer's wallet is on (writes switch via wagmi).
 * @param {string[]} [options.rpcUrls] Public RPC endpoints for the chain; lets the client
 *        short-circuit eth_call without a round trip through the bridge.
 * @param {string[]} [options.contextAccounts] Grid semantics: the profile hosting the widget.
 *        Hup maps it to the post author's wallet.
 * @param {() => object} options.getSession Returns the live { address, isConnected } snapshot.
 * @param {(request: object) => Promise<any>} options.onSignatureRequest User-confirmed signing.
 * @param {(request: object) => Promise<any>} options.onRead Read-only RPC.
 * @param {(chainId: number) => Promise<any>} options.onSwitchChain Host-mediated chain switch.
 * @param {(request: object) => Promise<any>} [options.onSessionCall] Burner-session-key call.
 * @param {(event: string, detail: object) => void} [options.onEvent] Observability hook.
 * @returns {{ pushSession: (session: object) => void, detach: () => void }}
 */
export function createUpProviderBridge({ iframe, app, chainId, rpcUrls = [], contextAccounts = [], getSession, onSignatureRequest, onRead, onSwitchChain, onSessionCall, onEvent }) {
  if (!iframe) throw new Error('createUpProviderBridge requires an iframe')

  let detached = false
  let port = null // server end of the MessageChannel; null until the frame handshakes
  let frameOrigin = '*' // resolved at handshake, used only for window-level replies
  let lastAccounts = []

  const emit = (event, detail = {}) => {
    try {
      onEvent?.(event, { appId: app?.appId, protocol: 'up', ...detail })
    } catch {
      /* observability must never break the bridge */
    }
  }

  const chainHex = `0x${Number(chainId).toString(16)}`

  const sessionAccounts = () => {
    const session = getSession() || {}
    return session.isConnected && session.address ? [session.address] : []
  }

  // Server-pushed notifications: `params` is the payload itself (the client reads
  // `accountsChanged` params as the accounts array, `connect` params as [{ chainId }]).
  const notify = (method, params) => {
    if (detached) return
    const message = { jsonrpc: '2.0', method, params }
    if (port) port.postMessage(message)
    else iframe.contentWindow?.postMessage({ type: WRAPPED_TYPE, payload: message }, frameOrigin)
  }

  const handleRequest = async (request, respond) => {
    const { id, method, params } = request
    if (typeof method !== 'string' || (typeof id !== 'number' && typeof id !== 'string')) return
    try {
      const result = await executeWalletMethod({
        method,
        params: Array.isArray(params) ? params : [],
        // The app's registered chain is this provider's chain, whatever the wallet is on
        session: { ...(getSession() || {}), chainId },
        contextAccounts,
        app,
        onSignatureRequest,
        onRead,
        onSwitchChain,
        onSessionCall,
        emit,
      })
      respond({ jsonrpc: '2.0', id, result: result ?? null })
    } catch (err) {
      respond({ jsonrpc: '2.0', id, error: { code: typeof err?.code === 'number' ? err.code : -32603, message: err?.message || 'Internal error' } })
    }
  }

  const onPortMessage = (event) => {
    if (detached) return
    const data = event.data
    if (!data || typeof data !== 'object') return

    if (data.type === 'upProvider:windowInitialized') {
      emit('frame:ready')
      // Mirror universaleverything's channel-enable choreography: the init payload carried NO
      // accounts, and the real values arrive as this notification burst. The distinction
      // matters because the client only re-emits events to the app for values that CHANGE —
      // the standard Grid template (LUKSO's UpProvider.jsx, used by Dracos and co) drives all
      // of its state from these events and deadlocks on a spinner if they never fire.
      // chainChanged is unconditional client-side and is what unlocks that template's init.
      // The client buffers notifications until the app's listeners attach, so none are lost.
      lastAccounts = sessionAccounts()
      notify('chainChanged', [Number(chainId)])
      notify('accountsChanged', lastAccounts)
      notify('contextAccountsChanged', [...contextAccounts])
      if (lastAccounts.length > 0) notify('connect', [{ chainId: chainHex }])
      return
    }

    handleRequest(data, (response) => {
      if (!detached) port?.postMessage(response)
    })
  }

  const onWindowMessage = (event) => {
    // Primary identity check: contentWindow cannot be forged by the frame or by any other page.
    if (detached || event.source !== iframe.contentWindow) return

    // Same trust model as the Hup bridge: the frame runs with allow-same-origin, so its origin
    // is real — a frame that navigated away from the registered app loses its channel.
    if (app?.origin && event.origin !== app.origin) {
      emit('message:foreignOrigin', { origin: event.origin })
      return
    }

    if (HANDSHAKE_MESSAGES.has(event.data)) {
      frameOrigin = event.origin && event.origin !== 'null' ? event.origin : '*'

      // A frame that reloads handshakes again — the new channel replaces the old one
      port?.close()

      const clientPort = event.ports?.[0]
      const created = clientPort ? null : new MessageChannel()
      port = clientPort || created.port1
      port.addEventListener('message', onPortMessage)
      port.start()

      // UE parity: accounts are deliberately EMPTY here and delivered as an accountsChanged
      // notification after the client ACKs — the client dedupes events against its current
      // state, so values baked into the init would suppress the very events Grid template
      // apps wait for (see the windowInitialized handler below).
      lastAccounts = []
      const init = {
        type: 'upProvider:windowInitialize',
        chainId: Number(chainId),
        allowedAccounts: [],
        contextAccounts: [...contextAccounts],
        rpcUrls: [...rpcUrls],
      }

      // When the server created the channel, port2 travels with the init message; a client
      // that transferred its own port expects the init on that port instead.
      if (created) iframe.contentWindow.postMessage(init, frameOrigin, [created.port2])
      else port.postMessage(init)

      emit('frame:handshake')
      return
    }

    // Wrapped window-level fallback for clients running without a port
    if (event.data?.type === WRAPPED_TYPE && event.data.payload) {
      handleRequest(event.data.payload, (response) => {
        if (!detached) iframe.contentWindow?.postMessage({ type: WRAPPED_TYPE, payload: response }, frameOrigin)
      })
    }
  }

  /**
   * Announces the viewer connecting or disconnecting to a live frame. Disconnect is announced
   * as an empty accountsChanged, not the protocol's `disconnect` — that one also wipes the
   * client's contextAccounts, and the post author does not change when the viewer logs out.
   */
  const pushSession = (session) => {
    if (detached || !port) return
    const accounts = session?.isConnected && session?.address ? [session.address] : []
    const changed = accounts.length !== lastAccounts.length || accounts.some((account, i) => account !== lastAccounts[i])
    if (!changed) return
    const wasConnected = lastAccounts.length > 0
    lastAccounts = accounts
    notify('accountsChanged', accounts)
    if (!wasConnected && accounts.length > 0) notify('connect', [{ chainId: chainHex }])
    emit('session:pushed', { connected: accounts.length > 0 })
  }

  window.addEventListener('message', onWindowMessage)

  return {
    pushSession,
    detach: () => {
      detached = true
      window.removeEventListener('message', onWindowMessage)
      port?.close()
      port = null
    },
  }
}

export const __testing = { HANDSHAKE_MESSAGES, WRAPPED_TYPE }
