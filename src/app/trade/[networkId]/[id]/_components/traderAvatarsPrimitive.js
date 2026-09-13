// Lightweight Charts series primitive that draws trader avatars at the price/time of their
// trades — the social layer on the candles. The library's own markers API draws shapes only, so
// this plugs into the v5 primitive slot and paints circular-clipped profile pictures straight
// onto the chart canvas, which keeps them glued to their candle through pan and zoom because
// they render inside the chart's own draw loop.
//
// Colour is never the identity here: the avatar is. The buy/sell ring reuses whatever pair the
// chart resolved from the app's theme tokens (--chart-up / --chart-down), as a second cue on top
// of the face.

// One shared image cache across charts — avatars repeat across tokens and sessions
const imageCache = new Map()

class TraderAvatarsPaneRenderer {
  constructor(source) {
    this._source = source
  }

  draw(target) {
    const source = this._source
    if (!source._chart || !source._series || source._markers.length === 0) {
      source._hits = []
      return
    }

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const timeScale = source._chart.timeScale()
      const hits = []
      // A face may never take more than a sixteenth of the pane: the same marker set has to sit
      // on a 260px phone canvas and a fullscreen one, and a radius tuned for the tall case
      // swallows the candles in the short one
      const ceiling = Math.max(6, Math.round(mediaSize.height / 16))

      for (const marker of source._markers) {
        const x = timeScale.timeToCoordinate(marker.time)
        const anchorY = source._series.priceToCoordinate(marker.price)
        if (x === null || anchorY === null) continue

        const radius = Math.min(marker.radius, ceiling)
        let y = anchorY

        // Collision pass: markers arrive biggest-first, so earlier-placed faces have priority
        // and later (smaller) ones step away vertically — up first, then down — until they
        // clear. Faces are allowed to overlap by a third of a diameter: a run of trades should
        // read as a cluster of people, not a picket fence. Only a near-total eclipse steps away.
        const collides = (candidateY) =>
          hits.some((placed) => (x - placed.x) ** 2 + (candidateY - placed.y) ** 2 < ((radius + placed.r) * 0.66) ** 2)
        if (collides(y)) {
          // Six half-diameter steps, not twelve full ones: past this a face has travelled so far
          // from its candle that it reads as a balloon rather than a mark on the tape, and the
          // leader line below is doing all the work
          for (let attempt = 1; attempt <= 6; attempt++) {
            const direction = attempt % 2 === 1 ? -1 : 1
            const candidate = anchorY + direction * Math.ceil(attempt / 2) * (radius + 3)
            if (candidate > radius + 2 && candidate < mediaSize.height - radius - 2 && !collides(candidate)) {
              y = candidate
              break
            }
          }
        }

        // Hairline back to the price the trade actually printed at, whenever the face was moved
        // off it. Without this a displaced avatar is a claim about a price nothing traded at.
        if (Math.abs(y - anchorY) > radius) {
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(x, y + (y > anchorY ? -radius : radius))
          ctx.lineTo(x, anchorY)
          ctx.lineWidth = 1
          ctx.strokeStyle = marker.side === 1 ? source._down : source._up
          ctx.globalAlpha = 0.4
          ctx.stroke()
          ctx.restore()
        }

        // Buy/sell ring, on a dark hairline so two overlapping faces stay two faces
        ctx.beginPath()
        ctx.arc(x, y, radius + 1.5, 0, Math.PI * 2)
        ctx.fillStyle = marker.side === 1 ? source._down : source._up
        ctx.fill()
        ctx.lineWidth = 1
        ctx.strokeStyle = 'rgba(12, 12, 16, 0.55)'
        ctx.stroke()

        // Face: the avatar clipped to a circle, or an initial on a neutral disc while the
        // image loads (or when the wallet has none)
        const record = marker.image ? source._image(marker.image) : null
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.clip()
        if (record?.ready) {
          ctx.drawImage(record.img, x - radius, y - radius, radius * 2, radius * 2)
        } else {
          ctx.fillStyle = '#5b5b66'
          ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
          ctx.fillStyle = '#ffffff'
          ctx.font = `600 ${Math.max(8, Math.round(radius * 0.95))}px system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(marker.initial, x, y + 0.5)
        }
        ctx.restore()

        // "+N" badge when the candle held more trades than the one face shown
        if (marker.extra > 0) {
          const label = `+${marker.extra}`
          ctx.font = '600 9px system-ui, sans-serif'
          const width = ctx.measureText(label).width + 6
          const bx = x + radius - 2
          const by = y + radius - 2
          ctx.fillStyle = 'rgba(20, 20, 24, 0.85)'
          ctx.beginPath()
          ctx.roundRect(bx, by - 5, width, 11, 5.5)
          ctx.fill()
          ctx.fillStyle = '#ffffff'
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          ctx.fillText(label, bx + 3, by + 1)
        }

        hits.push({ x, y, r: radius + 2, marker })
      }

      source._hits = hits
    })
  }
}

class TraderAvatarsPaneView {
  constructor(source) {
    this._renderer = new TraderAvatarsPaneRenderer(source)
  }

  renderer() {
    return this._renderer
  }
}

class TraderAvatarsPrimitive {
  constructor({ up = '#16a34a', down = '#dc2626' } = {}) {
    this._up = up
    this._down = down
    this._chart = null
    this._series = null
    this._requestUpdate = null
    this._markers = []
    this._hits = []
    this._paneViews = [new TraderAvatarsPaneView(this)]
  }

  attached({ chart, series, requestUpdate }) {
    this._chart = chart
    this._series = series
    this._requestUpdate = requestUpdate
  }

  detached() {
    this._chart = null
    this._series = null
    this._requestUpdate = null
    this._hits = []
  }

  paneViews() {
    return this._paneViews
  }

  updateAllViews() {}

  /**
   * Replaces the marker set. Markers arrive pre-clustered (one face per candle, capped) with
   * `{ time, price, side, size, radius, name, address, image, initial, extra }`.
   */
  setMarkers(markers) {
    this._markers = markers ?? []
    this._requestUpdate?.()
  }

  /** Returns the marker under container-relative (x, y), or null — for hover and click. */
  hitTest(x, y) {
    // Reverse order so the biggest (drawn last... first in sort) — top-most hit wins
    for (let i = this._hits.length - 1; i >= 0; i--) {
      const hit = this._hits[i]
      if ((x - hit.x) ** 2 + (y - hit.y) ** 2 <= hit.r ** 2) return hit.marker
    }
    return null
  }

  _image(url) {
    let record = imageCache.get(url)

    // A failed load is remembered, not forever: the proxy negative-caches gateway misses for a
    // few minutes, so a permanently-poisoned cache would keep fallback discs long after the
    // image became fetchable. Retry on the next draw once 30s have passed.
    if (record?.failedAt && Date.now() - record.failedAt > 30_000) {
      imageCache.delete(url)
      record = null
    }

    if (!record) {
      const img = new Image()
      record = { img, ready: false, failedAt: 0 }
      img.onload = () => {
        record.ready = true
        this._requestUpdate?.()
      }
      img.onerror = () => {
        record.failedAt = Date.now()
      }
      img.src = url
      imageCache.set(url, record)
    }
    return record
  }
}

export const createTraderAvatarsPrimitive = (colors) => new TraderAvatarsPrimitive(colors)
