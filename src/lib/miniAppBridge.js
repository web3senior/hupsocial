/**
 * Host side of the mini app bridge.
 *
 * An embedded mini app never runs its own wallet connector. It asks for an EIP-1193 provider from
 * the guest SDK, and every request that provider makes is serialized over postMessage to this
 * module, which answers it using the viewer's existing Hup wallet session. That gives one
 * connection instead of two, works in mobile in-wallet browsers where injection into third-party
 * frames does not happen, and — most importantly — leaves the host in control of what a frame is
 * allowed to ask for.
 *
 * The trust model here is that the frame is hostile. It is sandboxed without allow-same-origin, so
 * its origin is opaque ("null") and no origin string it sends can be believed. Identity therefore
 * comes from `event.source === iframe.contentWindow`, which the frame cannot forge, and never from
 * `event.origin`. Anything that spends money or produces a signature is routed through
 * `onSignatureRequest`, which must show the user what they are approving before it resolves.
 */

// Reads that carry no authority and cannot move funds: proxied straight to the chain.
const AUTO_APPROVED_READS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByHash',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getStorageAt',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
  'net_version',
  'web3_clientVersion',
])

// Anything that produces a signature or spends funds — always user-confirmed.
const SIGNING_METHODS = new Set(['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'eth_signTypedData'])

/**
 * eth_sign hands the wallet an opaque 32-byte digest with no human-readable content, so a user
 * cannot meaningfully consent to it and it has been used to trick people into signing
 * transactions. There is no legitimate mini app use for it; it is refused outright rather than
 * being routed through the confirmation dialog.
 */
const FORBIDDEN_METHODS = new Set(['eth_sign', 'eth_signTransaction', 'wallet_addEthereumChain', 'eth_accounts_unlock'])

export const BRIDGE_PROTOCOL = 'hup-miniapp/1'

const RPC_ERRORS = {
  userRejected: { code: 4001, message: 'User rejected the request' },
  unauthorized: { code: 4100, message: 'The requested account has not been authorized' },
  unsupported: { code: 4200, message: 'The requested method is not supported by this host' },
  disconnected: { code: 4900, message: 'The host is not connected to a wallet' },
  internal: { code: -32603, message: 'Internal error' },
  invalidParams: { code: -32602, message: 'Invalid method parameters' },
}

/**
 * Wires a sandboxed iframe to the viewer's wallet.
 *
 * @param {object} options
 * @param {HTMLIFrameElement} options.iframe The frame to serve. Identity is bound to its contentWindow.
 * @param {object} options.app Resolved registry record ({ appId, chainId, name, frameUrl }).
 * @param {() => object} options.getSession Returns the live { address, chainId, isConnected } snapshot.
 * @param {(request: object) => Promise<any>} options.onSignatureRequest Must present the request to
 *        the user and resolve with the result, or reject to decline. Never auto-resolve this.
 * @param {(request: object) => Promise<any>} options.onRead Performs a read-only RPC call.
 * @param {(chainId: number) => Promise<any>} options.onSwitchChain Host-mediated chain switch.
 * @param {(event: string, detail: object) => void} [options.onEvent] Observability hook.
 * @returns {() => void} Detach function — call on unmount.
 */
export function createMiniAppBridge({ iframe, app, getSession, onSignatureRequest, onRead, onSwitchChain, onEvent }) {
  if (!iframe) throw new Error('createMiniAppBridge requires an iframe')

  let detached = false

  const emit = (event, detail = {}) => {
    try {
      onEvent?.(event, { appId: app?.appId, ...detail })
    } catch {
      /* observability must never break the bridge */
    }
  }

  const post = (message) => {
    // targetOrigin '*' is correct here and not a leak: the frame is sandboxed without
    // allow-same-origin, so its origin is opaque and no specific origin would ever match. The
    // payload is only ever a reply to something that frame just asked for.
    if (!detached) iframe.contentWindow?.postMessage({ protocol: BRIDGE_PROTOCOL, ...message }, '*')
  }

  const reply = (id, result) => post({ type: 'rpc:result', id, result })
  const fail = (id, error) => post({ type: 'rpc:error', id, error })

  const handleRpc = async (id, method, params) => {
    const session = getSession() || {}

    if (FORBIDDEN_METHODS.has(method)) {
      emit('method:forbidden', { method })
      return fail(id, RPC_ERRORS.unsupported)
    }

    if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
      // The viewer's connection to Hup is the app's connection — there is no separate approval,
      // but an app still cannot see an address when nobody is connected.
      if (!session.isConnected || !session.address) return reply(id, [])
      return reply(id, [session.address])
    }

    if (method === 'eth_chainId') {
      if (!session.chainId) return fail(id, RPC_ERRORS.disconnected)
      return reply(id, `0x${Number(session.chainId).toString(16)}`)
    }

    if (method === 'wallet_switchEthereumChain') {
      const target = Number(params?.[0]?.chainId)
      if (!Number.isSafeInteger(target)) return fail(id, RPC_ERRORS.invalidParams)
      try {
        await onSwitchChain?.(target)
        return reply(id, null)
      } catch (err) {
        return fail(id, { code: 4001, message: err?.message || 'Chain switch rejected' })
      }
    }

    if (AUTO_APPROVED_READS.has(method)) {
      try {
        return reply(id, await onRead({ method, params }))
      } catch (err) {
        return fail(id, { code: RPC_ERRORS.internal.code, message: err?.shortMessage || err?.message || 'Read failed' })
      }
    }

    if (SIGNING_METHODS.has(method)) {
      if (!session.isConnected || !session.address) return fail(id, RPC_ERRORS.disconnected)

      // A frame must not be able to sign as somebody else, nor spoof the `from` on a transaction.
      const claimedFrom = method === 'eth_sendTransaction' ? params?.[0]?.from : method === 'personal_sign' ? params?.[1] : params?.[0]
      if (claimedFrom && String(claimedFrom).toLowerCase() !== String(session.address).toLowerCase()) {
        emit('signature:wrongAccount', { method, claimedFrom })
        return fail(id, RPC_ERRORS.unauthorized)
      }

      try {
        emit('signature:requested', { method })
        const result = await onSignatureRequest({ method, params, app })
        emit('signature:approved', { method })
        return reply(id, result)
      } catch (err) {
        emit('signature:rejected', { method, reason: err?.message })
        return fail(id, err?.code === 4001 ? RPC_ERRORS.userRejected : { code: 4001, message: err?.message || 'Request rejected' })
      }
    }

    emit('method:unsupported', { method })
    return fail(id, RPC_ERRORS.unsupported)
  }

  const onMessage = (event) => {
    // Primary identity check: contentWindow cannot be forged by the frame or by any other page.
    if (detached || event.source !== iframe.contentWindow) return

    // Secondary check. The frame runs with allow-same-origin, so event.origin is a real origin
    // rather than "null" — which makes it worth enforcing against the registered one. This is
    // what stops a frame that navigates itself somewhere else (an open redirect, a compromised
    // dependency) from continuing to speak for the app the user approved.
    if (app?.origin && event.origin !== app.origin) {
      emit('message:foreignOrigin', { origin: event.origin })
      return
    }

    const data = event.data
    if (!data || typeof data !== 'object' || data.protocol !== BRIDGE_PROTOCOL) return

    if (data.type === 'ready') {
      const session = getSession() || {}
      emit('frame:ready')
      return post({
        type: 'context',
        context: {
          host: 'hup',
          app: { appId: app?.appId, chainId: app?.chainId, name: app?.name },
          user: session.isConnected && session.address ? { address: session.address } : null,
          chainId: session.chainId ?? null,
        },
      })
    }

    if (data.type === 'rpc') {
      const { id, method, params } = data
      if (typeof id !== 'number' && typeof id !== 'string') return
      if (typeof method !== 'string') return fail(id, RPC_ERRORS.invalidParams)
      handleRpc(id, method, Array.isArray(params) ? params : []).catch(() => fail(id, RPC_ERRORS.internal))
    }
  }

  window.addEventListener('message', onMessage)

  return () => {
    detached = true
    window.removeEventListener('message', onMessage)
  }
}

/**
 * Pushes a session change into a live frame so an app can react to the viewer connecting,
 * disconnecting, or switching networks without re-mounting.
 */
export function pushSessionUpdate(iframe, session) {
  iframe?.contentWindow?.postMessage(
    {
      protocol: BRIDGE_PROTOCOL,
      type: 'session',
      session: {
        address: session?.address ?? null,
        chainId: session?.chainId ?? null,
        isConnected: Boolean(session?.isConnected),
      },
    },
    '*',
  )
}

export const __testing = { AUTO_APPROVED_READS, SIGNING_METHODS, FORBIDDEN_METHODS, RPC_ERRORS }
