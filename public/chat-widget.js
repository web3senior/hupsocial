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
 * and, while minimized, its pill's size; this script fits the frame to that.
 */
;(function () {
  'use strict'

  if (window.hupChat) return

  var STATE_MESSAGE = 'hup:chat:state'
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

  var theme = (self && self.getAttribute('data-theme')) || 'auto'
  var state = { mode: 'minimized', width: 0, height: 0 }
  var frame = null

  function px(value) {
    return Math.max(0, Math.round(value)) + 'px'
  }

  function layout() {
    if (!frame) return
    var vw = window.innerWidth
    var vh = window.innerHeight
    var style = frame.style

    if (state.mode === 'minimized') {
      if (!state.width || !state.height) return
      style.inset = 'auto ' + px(EDGE) + ' ' + px(EDGE) + ' auto'
      style.width = px(state.width)
      style.height = px(state.height)
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
      style.inset = 'auto ' + px(EDGE) + ' ' + px(EDGE) + ' auto'
      style.width = px(Math.min(width, vw - EDGE * 2))
      style.height = px(height)
      style.borderRadius = '20px'
    }
    style.visibility = 'visible'
  }

  function onMessage(event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== ORIGIN) return
    var data = event.data
    if (!data || data.type !== STATE_MESSAGE) return
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
  }

  window.addEventListener('message', onMessage)
  window.addEventListener('resize', layout)

  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount)

  window.hupChat = {
    remove: function () {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('resize', layout)
      if (frame && frame.parentNode) frame.parentNode.removeChild(frame)
      frame = null
      window.hupChat = undefined
    },
  }
})()
