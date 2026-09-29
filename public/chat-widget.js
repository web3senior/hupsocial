/**
 * Hup chat widget (host side).
 *
 * Puts the public Hup chat room in the bottom-right corner of the page that loads it:
 *
 *   <script async src="https://hup.social/chat-widget.js" data-theme="auto" charset="utf-8"></script>
 *
 * data-theme is auto (the visitor's system theme), light or dark. Only origins in
 * src/config/chatEmbed.mjs may frame the room; anywhere else the browser refuses the frame.
 *
 * The room runs in a frame of /embed/chat, which reports its mode (minimized, open, expanded)
 * and, while minimized, its pill's size; this script fits the frame to that. The visitor can
 * drag it off whatever it covers, by the pill or the open card's bar, and it stays where it was put.
 *
 * On a page opened inside the LUKSO Grid the room is one frame too deep to be handed the
 * visitor's Universal Profile, so this script relays it over the up-provider wire protocol
 * (see src/lib/upProviderBridge.js): from the page's own up-provider client when it has one,
 * from the Grid directly when it does not.
 *
 * A wallet app's own browser injects its wallet into the page and gives the room's frame none.
 * There the page's injected wallet is relayed the same way, and only to a room with no wallet.
 *
 * A site that frames /embed/chat itself adds data-manual, which leaves the frame and its layout
 * to the site, and hands its iframe over for the relay alone: hupChat.attach(iframe).
 *
 * hupChat.version, and the small label in the room's title bar, say which script a page is running.
 */
;(function () {
  'use strict'

  if (window.hupChat) return

  // Bump with every change to this file: it is how a cached copy is told from the current one
  var VERSION = '1.4.0'

  var STATE_MESSAGE = 'hup:chat:state'
  // Must match src/components/chat/useEmbedBridge.js
  var WIDGET_QUERY = 'hup:chat:widget?'
  var WIDGET_INFO = 'hup:chat:widget'
  var DRAG_MESSAGE = 'hup:chat:drag'
  var OFFSET_KEY = 'hup:chat:offset'
  var DRAG_MARGIN = 8
  var EDGE = 16
  var COMPACT_WIDTH = 768
  var CARD = { width: 360, height: 640 }
  var EXPANDED_WIDTH = 520

  var self = document.currentScript || document.querySelector('script[src*="/chat-widget.js"]')
  var ORIGIN = (function () {
    try {
      return new URL(self.src, window.location.href).origin
    } catch (err) {
      return 'https://hup.social'
    }
  })()

  // The apex redirects to www, so the room's origin is not always the one this script came from
  var ROOM_ORIGINS = (function () {
    var url = new URL(ORIGIN)
    var twin = url.hostname.indexOf('www.') === 0 ? url.hostname.slice(4) : 'www.' + url.hostname
    return [ORIGIN, url.protocol + '//' + twin + (url.port ? ':' + url.port : '')]
  })()
  var roomOrigin = ORIGIN

  var theme = (self && self.getAttribute('data-theme')) || 'auto'
  var manual = Boolean(self && self.hasAttribute('data-manual'))
  var state = { mode: 'minimized', width: 0, height: 0 }
  var frame = null
  // The shift from the corner seat, as the visitor left it
  var offset = readOffset()
  var applied = { x: 0, y: 0 }
  var dragOrigin = null

  function px(value) {
    return Math.max(0, Math.round(value)) + 'px'
  }

  function readOffset() {
    try {
      var stored = JSON.parse(window.localStorage.getItem(OFFSET_KEY))
      if (stored && isFinite(stored.x) && isFinite(stored.y)) return { x: Number(stored.x), y: Number(stored.y) }
    } catch (err) {
      // Blocked storage only costs the position its memory
    }
    return { x: 0, y: 0 }
  }

  function saveOffset() {
    try {
      window.localStorage.setItem(OFFSET_KEY, JSON.stringify(offset))
    } catch (err) {
      // Blocked storage only costs the position its memory
    }
  }

  function within(value, a, b) {
    return Math.min(Math.max(value, Math.min(a, b)), Math.max(a, b))
  }

  // Seated at the corner and shifted, never past the viewport's edge
  function seat(style, width, height) {
    applied = {
      x: within(offset.x, EDGE - (window.innerWidth - width - DRAG_MARGIN), EDGE - DRAG_MARGIN),
      y: within(offset.y, EDGE - (window.innerHeight - height - DRAG_MARGIN), EDGE - DRAG_MARGIN),
    }
    style.inset = 'auto ' + px(EDGE - applied.x) + ' ' + px(EDGE - applied.y) + ' auto'
    style.width = px(width)
    style.height = px(height)
  }

  function layout() {
    if (!frame) return
    var vw = window.innerWidth
    var vh = window.innerHeight
    var style = frame.style

    if (state.mode === 'minimized') {
      if (!state.width || !state.height) return
      seat(style, state.width, state.height)
      style.borderRadius = '999px'
    } else if (vw < COMPACT_WIDTH) {
      // Phones get the room edge to edge, as the app does
      style.inset = '0'
      style.width = '100%'
      style.height = '100%'
      style.borderRadius = '0'
    } else {
      var width = state.mode === 'expanded' ? EXPANDED_WIDTH : CARD.width
      var height = state.mode === 'expanded' ? vh - EDGE * 2 : Math.min(CARD.height, vh - EDGE * 2)
      seat(style, Math.min(width, vw - EDGE * 2), height)
      style.borderRadius = '20px'
    }
    style.visibility = 'visible'
  }

  // The room reads the gesture, since the pointer is over its frame; the frame is this page's to move
  function onDrag(data) {
    var isEdgeToEdge = state.mode !== 'minimized' && window.innerWidth < COMPACT_WIDTH
    if (manual || isEdgeToEdge) return

    if (data.phase === 'end') {
      if (!dragOrigin) return
      dragOrigin = null
      offset = applied
      return saveOffset()
    }

    var x = Number(data.x)
    var y = Number(data.y)
    if (!isFinite(x) || !isFinite(y)) return
    if (!dragOrigin) dragOrigin = applied
    offset = { x: dragOrigin.x + x, y: dragOrigin.y + y }
    layout()
  }

  // --- Universal Profile relay ---

  // Must match src/lib/upProviderClient.js
  var WALLET_OFFER = 'hup:chat:wallet'
  var WALLET_QUERY = 'hup:chat:wallet?'
  var UP_RDNS = 'dev.lukso.auth'
  var UP_HANDSHAKES = ['upProvider:hasProvider', 'upProvider:requestIframeProvider']
  var UP_INIT = 'upProvider:windowInitialize'
  var UP_READY = 'upProvider:windowInitialized'
  var POLL_MS = 1000
  // Long enough for the page's own client to announce itself before the Grid is asked directly
  var GRID_SEARCH_DELAY = 1500
  var GRID_SEARCH_TIMEOUT = 3000
  var GRID_SEARCH_ATTEMPTS = 5
  // Not a wallet method: the room's client answers eth_requestAccounts itself and never asks
  var REQUEST_ACCOUNTS = 'hup_requestAccounts'
  // Injection can land after the page's own scripts
  var INJECTED_CHECKS = 10
  var NAME_LIMIT = 40

  var wallet = null // { source, name, chainId, accounts, contextAccounts, rpcUrls, request }
  var pageProvider = null
  var injected = null
  var injectedTimer = null
  var injectedChecks = 0
  var announced = []
  // Until the room says otherwise: a room with its own wallet is never handed the page's
  var roomHasWallet = true
  var gridPort = null
  var gridPending = {}
  var gridRequestId = 0
  var roomPort = null
  var roomReady = false
  var sent = { chainId: 0, accounts: [], contextAccounts: [] }
  var pollTimer = null
  var relayStarted = false

  function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : []
  }

  function sameList(a, b) {
    if (a.length !== b.length) return false
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  function notifyRoom(method, params) {
    if (roomPort && roomReady) roomPort.postMessage({ jsonrpc: '2.0', method: method, params: params })
  }

  // The room's client only re-emits what changes, so everything reaches it as a notification
  function syncRoom(force) {
    if (!wallet || !roomReady) return
    var accounts = list(wallet.accounts)
    var contextAccounts = list(wallet.contextAccounts)
    var chainId = Number(wallet.chainId) || 0
    var wasConnected = sent.accounts.length > 0

    if (force || chainId !== sent.chainId) notifyRoom('chainChanged', [chainId])
    if (force || !sameList(contextAccounts, sent.contextAccounts)) notifyRoom('contextAccountsChanged', contextAccounts)
    if (force || !sameList(accounts, sent.accounts)) notifyRoom('accountsChanged', accounts)
    if ((force || !wasConnected) && accounts.length > 0) notifyRoom('connect', [{ chainId: '0x' + chainId.toString(16) }])

    sent = { chainId: chainId, accounts: accounts, contextAccounts: contextAccounts }
  }

  function offerWallet() {
    if (!wallet || !frame || !frame.contentWindow) return
    frame.contentWindow.postMessage({ type: WALLET_OFFER, source: wallet.source, name: wallet.name || null }, roomOrigin)
  }

  function dropInjected() {
    if (injectedTimer) clearInterval(injectedTimer)
    injectedTimer = injected = null
  }

  function readPageProvider() {
    if (!pageProvider || !wallet) return
    wallet.chainId = Number(pageProvider.chainId) || 0
    wallet.accounts = list(pageProvider.accounts)
    wallet.contextAccounts = list(pageProvider.contextAccounts)
    syncRoom(false)
  }

  function usePageProvider(provider) {
    // A top-level page has no Grid above it to grant anyone
    if (pageProvider === provider || window.parent === window) return
    pageProvider = provider
    if (gridPort) gridPort.close()
    gridPort = null
    dropInjected()
    wallet = {
      source: 'page client',
      chainId: 0,
      accounts: [],
      contextAccounts: [],
      rpcUrls: [],
      request: function (method, params) {
        return provider.request(method, params)
      },
    }
    // Polled, never subscribed: subscribing resumes the client's buffered events, the page's call to make
    if (!pollTimer) pollTimer = setInterval(readPageProvider, POLL_MS)
    readPageProvider()
    offerWallet()
  }

  function onAnnounce(event) {
    var detail = event.detail
    if (!detail || !detail.provider || !detail.info) return
    if (detail.info.rdns === UP_RDNS || detail.provider.isUPClientProvider === true) return usePageProvider(detail.provider)
    for (var i = 0; i < announced.length; i++) if (announced[i].provider === detail.provider) return
    announced.push({ name: String(detail.info.name || detail.info.rdns || 'Wallet').slice(0, NAME_LIMIT), provider: detail.provider })
  }

  function findInjected() {
    if (window.lukso) return { provider: window.lukso, name: 'Universal Profile' }
    for (var i = 0; i < announced.length; i++) {
      if (announced[i].provider.isUniversalProfileExtension === true) return announced[i]
    }
    if (announced.length === 1) return announced[0]
    if (window.ethereum) return { provider: window.ethereum, name: announced.length ? announced[0].name : 'Site wallet' }
    return null
  }

  function readInjected() {
    var provider = injected
    if (!provider || !wallet) return
    Promise.all([provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' })]).then(
      function (values) {
        if (injected !== provider || !wallet) return
        wallet.chainId = Number(values[0]) || 0
        wallet.accounts = list(values[1])
        syncRoom(false)
      },
      function () {
        // A wallet that cannot answer yet is asked again on the next read
      }
    )
  }

  // The one request that may prompt: the visitor asked the room to connect
  function askInjected() {
    var provider = injected
    return provider.request({ method: 'eth_requestAccounts' }).then(function (accounts) {
      if (injected !== provider || !wallet) return []
      wallet.accounts = list(accounts)
      syncRoom(false)
      readInjected()
      return wallet.accounts
    })
  }

  function useInjected(found) {
    injected = found.provider
    wallet = {
      source: 'injected',
      name: found.name,
      chainId: 0,
      accounts: [],
      contextAccounts: [],
      rpcUrls: [],
      request: function (method, params) {
        if (method === REQUEST_ACCOUNTS) return askInjected()
        return found.provider.request({ method: method, params: params })
      },
    }
    if (typeof found.provider.on === 'function') {
      found.provider.on('accountsChanged', readInjected)
      found.provider.on('chainChanged', readInjected)
    }
    if (injectedTimer) clearInterval(injectedTimer)
    injectedTimer = setInterval(readInjected, POLL_MS * 3)
    readInjected()
    offerWallet()
  }

  // Last in line: a Grid above the page, or the page's own client, is the wallet when there is one
  function considerInjected() {
    if (wallet || roomHasWallet || !frame) return
    var found = findInjected()
    if (found) useInjected(found)
  }

  function watchInjected() {
    var timer = setInterval(function () {
      injectedChecks += 1
      if (wallet || injectedChecks > INJECTED_CHECKS) return clearInterval(timer)
      considerInjected()
    }, POLL_MS)
  }

  function onGridMessage(event) {
    var data = event.data
    if (!data || !wallet || pageProvider) return

    if (data.method === 'chainChanged') wallet.chainId = Number(data.params && data.params[0]) || 0
    else if (data.method === 'accountsChanged') wallet.accounts = list(data.params)
    else if (data.method === 'contextAccountsChanged') wallet.contextAccounts = list(data.params)
    else if (data.method === 'rpcUrlsChanged') wallet.rpcUrls = list(data.params)
    else if (data.method === 'disconnect') wallet.accounts = []
    else if (data.method !== 'connect' && data.method !== 'showPopup') {
      var pending = gridPending[data.id]
      if (!pending) return
      delete gridPending[data.id]
      if (data.error) pending.reject(data.error)
      else pending.resolve(data.result)
      return
    }
    syncRoom(false)
  }

  function useGrid(init, port) {
    gridPort = port
    dropInjected()
    wallet = {
      source: 'grid',
      chainId: Number(init.chainId) || 0,
      accounts: list(init.allowedAccounts),
      contextAccounts: list(init.contextAccounts),
      rpcUrls: list(init.rpcUrls),
      request: function (method, params) {
        return new Promise(function (resolve, reject) {
          var id = ++gridRequestId
          gridPending[id] = { resolve: resolve, reject: reject }
          port.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params || [] })
        })
      },
    }
    port.onmessage = onGridMessage
    port.postMessage({
      type: UP_READY,
      chainId: init.chainId,
      allowedAccounts: init.allowedAccounts,
      contextAccounts: init.contextAccounts,
      rpcUrls: init.rpcUrls,
    })
    syncRoom(false)
    offerWallet()
  }

  // The Grid answers once its own wallet is ready, which can be after the first ask
  function searchGrid(attempt) {
    if ((wallet && wallet.source !== 'injected') || !frame || window.parent === window) return

    function onInit(event) {
      if (event.source !== window.parent || !event.data || event.data.type !== UP_INIT) return
      window.removeEventListener('message', onInit)
      if ((wallet && wallet.source !== 'injected') || !event.ports || !event.ports[0]) return
      useGrid(event.data, event.ports[0])
    }

    window.addEventListener('message', onInit)
    window.parent.postMessage(UP_HANDSHAKES[0], '*')
    // Listening only while an ask is out: an init meant for the page's own client is not ours to take
    setTimeout(function () {
      window.removeEventListener('message', onInit)
      if (attempt < GRID_SEARCH_ATTEMPTS) searchGrid(attempt + 1)
    }, GRID_SEARCH_TIMEOUT)
  }

  function onRoomMessage(event) {
    var data = event.data
    if (!data || typeof data !== 'object' || !wallet) return

    if (data.type === UP_READY) {
      roomReady = true
      syncRoom(true)
      return
    }

    var id = data.id
    var port = roomPort
    if (typeof data.method !== 'string' || (typeof id !== 'number' && typeof id !== 'string')) return

    Promise.resolve()
      .then(function () {
        if (data.method === REQUEST_ACCOUNTS && wallet.source !== 'injected') {
          throw { code: 4200, message: 'This wallet is connected from the page that frames it' }
        }
        return wallet.request(data.method, Array.isArray(data.params) ? data.params : [])
      })
      .then(
        function (result) {
          // Structured clone drops undefined, and the client only settles on a present result
          port.postMessage({ jsonrpc: '2.0', id: id, result: result === undefined ? null : result })
        },
        function (err) {
          port.postMessage({
            jsonrpc: '2.0',
            id: id,
            error: { code: err && typeof err.code === 'number' ? err.code : -32603, message: (err && err.message) || 'Internal error' },
          })
        }
      )
  }

  function serveRoom() {
    if (!wallet) return
    // A room that reloads handshakes again: the new channel replaces the old one
    if (roomPort) roomPort.close()
    var channel = new MessageChannel()
    roomPort = channel.port1
    roomReady = false
    sent = { chainId: 0, accounts: [], contextAccounts: [] }
    roomPort.onmessage = onRoomMessage
    frame.contentWindow.postMessage(
      {
        type: UP_INIT,
        chainId: Number(wallet.chainId) || 0,
        allowedAccounts: [],
        contextAccounts: list(wallet.contextAccounts),
        rpcUrls: list(wallet.rpcUrls),
      },
      roomOrigin,
      [channel.port2]
    )
  }

  function hostFacts() {
    var names = []
    for (var i = 0; i < announced.length && i < 5; i++) names.push(announced[i].name)
    return {
      framed: window.parent !== window,
      lukso: Boolean(window.lukso),
      ethereum: Boolean(window.ethereum),
      announced: names,
      wallet: wallet ? wallet.source : 'none',
    }
  }

  function tellVersion() {
    if (!frame || !frame.contentWindow) return
    frame.contentWindow.postMessage({ type: WIDGET_INFO, version: VERSION, host: hostFacts(), drag: !manual }, roomOrigin)
  }

  function startRelay() {
    if (relayStarted) return
    relayStarted = true
    window.addEventListener('eip6963:announceProvider', onAnnounce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    setTimeout(function () {
      searchGrid(1)
    }, GRID_SEARCH_DELAY)
    watchInjected()
  }

  function stopRelay() {
    relayStarted = false
    window.removeEventListener('eip6963:announceProvider', onAnnounce)
    dropInjected()
    if (pollTimer) clearInterval(pollTimer)
    if (roomPort) roomPort.close()
    if (gridPort) gridPort.close()
    pollTimer = roomPort = gridPort = wallet = pageProvider = null
  }

  function onMessage(event) {
    if (!frame || event.source !== frame.contentWindow || ROOM_ORIGINS.indexOf(event.origin) === -1) return
    roomOrigin = event.origin
    var data = event.data
    if (UP_HANDSHAKES.indexOf(data) !== -1) return serveRoom()
    if (!data) return
    if (data.type === WALLET_QUERY) {
      roomHasWallet = data.own !== false
      considerInjected()
      return offerWallet()
    }
    if (data.type === WIDGET_QUERY) return tellVersion()
    if (data.type === DRAG_MESSAGE) return onDrag(data)
    if (manual || data.type !== STATE_MESSAGE) return
    state = { mode: data.mode, width: Number(data.width) || 0, height: Number(data.height) || 0 }
    layout()
  }

  function mount() {
    if (frame) return
    var src = ORIGIN + '/embed/chat'
    if (theme === 'light' || theme === 'dark') src += '?theme=' + theme

    frame = document.createElement('iframe')
    frame.src = src
    frame.title = 'Hup chat'
    frame.setAttribute('allow', 'clipboard-write')
    frame.setAttribute('data-hup-chat-version', VERSION)
    // Hidden, but wide enough to lay the pill out, until the room reports its first size
    frame.style.cssText =
      'position:fixed;right:' +
      EDGE +
      'px;bottom:' +
      EDGE +
      'px;width:320px;height:80px;border:0;margin:0;padding:0;visibility:hidden;' +
      'z-index:2147483000;color-scheme:normal;background:transparent;overflow:hidden;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.18);'
    document.body.appendChild(frame)
    startRelay()
  }

  // The site's own frame of /embed/chat; a frame it remounts is attached again
  function attach(element) {
    if (!manual || !element || element === frame) return
    frame = element
    frame.setAttribute('data-hup-chat-version', VERSION)
    if (roomPort) roomPort.close()
    roomPort = null
    roomReady = false
    try {
      var origin = new URL(element.src, window.location.href).origin
      if (ROOM_ORIGINS.indexOf(origin) !== -1) roomOrigin = origin
    } catch (err) {
      // Left at the script's own origin until the room speaks
    }
    startRelay()
    // A room that loaded before it was attached asked while nobody was listening
    tellVersion()
    offerWallet()
  }

  window.addEventListener('message', onMessage)

  if (!manual) {
    window.addEventListener('resize', layout)
    if (document.body) mount()
    else document.addEventListener('DOMContentLoaded', mount)
  }

  window.hupChat = {
    version: VERSION,
    attach: attach,
    /** Where the relay stands, for a site owner's console: hupChat.status() */
    status: function () {
      return {
        version: VERSION,
        manual: manual,
        script: ORIGIN,
        room: roomOrigin,
        framed: window.parent !== window,
        wallet: wallet ? wallet.source : 'none',
        host: hostFacts(),
        accounts: wallet ? list(wallet.accounts) : [],
        roomConnected: roomReady,
      }
    },
    remove: function () {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('resize', layout)
      stopRelay()
      if (!manual && frame && frame.parentNode) frame.parentNode.removeChild(frame)
      frame = null
      window.hupChat = undefined
    },
  }
})()
