/**
 * Hup Mini App SDK (guest side).
 *
 * Loaded by a mini app running inside a Hup post. Exposes two surfaces over one transport:
 *
 *   window.hup       — Hup-native: profile, tipping, and the multichain context the host knows about.
 *   window.sdk       — Farcaster Mini App compatible, so apps written for Farcaster or Base App
 *                      run here unmodified (sdk.actions.ready, sdk.context, sdk.wallet.*).
 *
 * The provider returned by getEthereumProvider() is EIP-1193 shaped but does not talk to a wallet
 * directly — every request is forwarded to the Hup host, which uses the viewer's existing session
 * and asks them to confirm anything that signs or spends. Do not ship your own connector.
 *
 *   <script src="https://hup.social/miniapp-sdk.js"></script>
 *   <script>
 *     await sdk.actions.ready()
 *     const provider = await sdk.wallet.getEthereumProvider()
 *     const [account] = await provider.request({ method: 'eth_requestAccounts' })
 *   </script>
 */
;(function () {
  'use strict'

  var PROTOCOL = 'hup-miniapp/1'

  if (window.parent === window) {
    console.warn('[hup-sdk] Not running inside a Hup frame — the wallet bridge will not respond.')
  }

  var nextId = 1
  var pending = {}
  var listeners = {}
  var context = null
  var contextWaiters = []

  function emit(event, payload) {
    ;(listeners[event] || []).forEach(function (fn) {
      try {
        fn(payload)
      } catch (err) {
        console.error('[hup-sdk] listener error', err)
      }
    })
  }

  function send(message) {
    window.parent.postMessage(Object.assign({ protocol: PROTOCOL }, message), '*')
  }

  window.addEventListener('message', function (event) {
    // Only the host frame can be the parent, so source is the meaningful check; the sandbox
    // gives this frame an opaque origin, so event.origin is not comparable.
    if (event.source !== window.parent) return
    var data = event.data
    if (!data || typeof data !== 'object' || data.protocol !== PROTOCOL) return

    if (data.type === 'context') {
      context = data.context
      contextWaiters.splice(0).forEach(function (resolve) {
        resolve(context)
      })
      emit('context', context)
      return
    }

    if (data.type === 'session') {
      if (context) {
        context.user = data.session.address ? { address: data.session.address } : null
        context.chainId = data.session.chainId
      }
      emit('session', data.session)
      emit(data.session.address ? 'accountsChanged' : 'disconnect', data.session.address ? [data.session.address] : [])
      return
    }

    if (data.type === 'rpc:result' || data.type === 'rpc:error') {
      var entry = pending[data.id]
      if (!entry) return
      delete pending[data.id]
      if (data.type === 'rpc:result') entry.resolve(data.result)
      else {
        var err = new Error(data.error && data.error.message ? data.error.message : 'Request failed')
        err.code = data.error && data.error.code
        entry.reject(err)
      }
    }
  })

  function request(args) {
    return new Promise(function (resolve, reject) {
      if (!args || typeof args.method !== 'string') {
        reject(new Error('request requires a method'))
        return
      }
      var id = nextId++
      pending[id] = { resolve: resolve, reject: reject }
      send({ type: 'rpc', id: id, method: args.method, params: args.params || [] })
    })
  }

  // Minimal EIP-1193 surface. Deliberately no `enable()`, no injected-provider fallback:
  // if the host is not there, failing loudly beats silently reaching for a second wallet.
  var provider = {
    isHup: true,
    request: request,
    on: function (event, handler) {
      ;(listeners[event] = listeners[event] || []).push(handler)
      return provider
    },
    removeListener: function (event, handler) {
      listeners[event] = (listeners[event] || []).filter(function (fn) {
        return fn !== handler
      })
      return provider
    },
  }

  function whenContext() {
    if (context) return Promise.resolve(context)
    return new Promise(function (resolve) {
      contextWaiters.push(resolve)
    })
  }

  function ready() {
    // Standalone there is no one to answer — fail fast instead of hanging the app's boot
    if (window.parent === window) {
      return Promise.reject(new Error('not embedded in a host frame'))
    }

    send({ type: 'ready' })

    // A host that exists answers the handshake immediately, so a long silence means the parent
    // is not a Hup bridge (or refused this frame). Reject rather than hang forever; the context
    // still resolves later through whenContext() if a slow host does answer.
    return Promise.race([
      whenContext(),
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error('host did not answer the handshake within 5s'))
        }, 5000)
      }),
    ])
  }

  window.hup = {
    ready: ready,
    getProvider: function () {
      return Promise.resolve(provider)
    },
    get context() {
      return context
    },
    whenReady: whenContext,
    on: provider.on,
    removeListener: provider.removeListener,
  }

  // Farcaster Mini App compatibility. Same transport, their shape — `context.user` carries an
  // `address` here rather than an fid, since Hup identity is wallet-based.
  window.sdk = {
    actions: {
      ready: ready,
      openUrl: function (url) {
        window.open(url, '_blank', 'noopener,noreferrer')
        return Promise.resolve()
      },
      close: function () {
        send({ type: 'close' })
        return Promise.resolve()
      },
    },
    get context() {
      return context
    },
    wallet: {
      getEthereumProvider: function () {
        return Promise.resolve(provider)
      },
    },
  }

  // Announce immediately so a host that mounted first still gets its context handshake
  send({ type: 'ready' })
})()
