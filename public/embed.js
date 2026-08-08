/**
 * Hup post embeds (host side).
 *
 * Loaded by any page that wants to show a Hup post. Upgrades the permalink blockquote the
 * snippet ships into a frame of that post's embed document, then keeps the frame's height in
 * step with its content:
 *
 *   <blockquote class="hup-post" data-hup-network="42" data-hup-post="1337" data-hup-theme="auto">
 *     <a href="https://hup.social/networks/42/1337">Post by kaliyuga on Hup</a>
 *   </blockquote>
 *   <script async src="https://hup.social/embed.js" charset="utf-8"></script>
 *
 * Until this runs — script blocked, no JS, an RSS reader — the blockquote is a working link to
 * the post, which is the whole reason the snippet is shaped this way.
 *
 * Single-page hosts that add embeds after load can re-scan with window.hup.embed.load().
 */
;(function () {
  'use strict'

  var SELECTOR = '.hup-post[data-hup-post]'
  var UPGRADED = 'data-hup-embedded'
  var SIZE_MESSAGE = 'hup:embed:size'
  var MIN_HEIGHT = 140
  // A frame that reports something absurd (a runaway host stylesheet, a broken observer) must
  // not be able to push the rest of the page off the screen.
  var MAX_HEIGHT = 20000

  // Read at execution time, while document.currentScript still points at this tag: the origin
  // serving the script is the deployment that serves the embeds, so a staging or self-hosted
  // Hup keeps working without editing the snippet.
  var self = document.currentScript || document.querySelector('script[src*="/embed.js"]')
  var ORIGIN = (function () {
    try {
      return new URL(self.src, window.location.href).origin
    } catch (err) {
      return 'https://hup.social'
    }
  })()

  var frames = []

  function buildFrame(node) {
    var network = node.getAttribute('data-hup-network')
    var post = node.getAttribute('data-hup-post')
    if (!network || !post) return null

    var theme = node.getAttribute('data-hup-theme') || 'auto'
    var src = ORIGIN + '/networks/' + encodeURIComponent(network) + '/' + encodeURIComponent(post) + '/embed'
    if (theme !== 'auto') src += '?theme=' + encodeURIComponent(theme)

    var frame = document.createElement('iframe')
    frame.src = src
    frame.title = (node.textContent || '').trim() || 'Hup post'
    frame.setAttribute('loading', 'lazy')
    frame.setAttribute('scrolling', 'no')
    frame.setAttribute('frameborder', '0')
    // No allow-same-origin: the document is static and needs neither storage nor its own origin,
    // so the frame stays opaque and can reach nothing of Hup's. allow-scripts is for the height
    // report; allow-popups lets "View on Hup" open in a new tab.
    frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox')
    frame.style.cssText =
      'display:block;width:100%;max-width:550px;height:' + MIN_HEIGHT + 'px;border:0;overflow:hidden;color-scheme:normal;'

    return frame
  }

  function upgrade(node) {
    if (node.getAttribute(UPGRADED) === 'true') return

    var frame = buildFrame(node)
    if (!frame) return

    node.setAttribute(UPGRADED, 'true')
    frames.push(frame)

    if (node.parentNode) node.parentNode.replaceChild(frame, node)
  }

  function load() {
    var nodes = document.querySelectorAll(SELECTOR)
    for (var i = 0; i < nodes.length; i += 1) upgrade(nodes[i])
  }

  // The frame is sandboxed without allow-same-origin, so its messages arrive with an opaque
  // "null" origin — matching event.source against the frames this script created is the check
  // that means anything here, and it is stricter than an origin comparison would be.
  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || data.type !== SIZE_MESSAGE) return

    var height = Math.ceil(Number(data.height))
    if (!isFinite(height) || height <= 0) return
    if (height < MIN_HEIGHT) height = MIN_HEIGHT
    if (height > MAX_HEIGHT) height = MAX_HEIGHT

    for (var i = 0; i < frames.length; i += 1) {
      if (frames[i].contentWindow === event.source) {
        frames[i].style.height = height + 'px'
        return
      }
    }
  })

  window.hup = window.hup || {}
  window.hup.embed = { load: load }

  load()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load)
})()
