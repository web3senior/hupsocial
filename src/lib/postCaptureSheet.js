/**
 * @file lib/postCaptureSheet.js
 * @description Turns the post card on screen into the card that gets photographed.
 *
 * The copy is a deep clone of the post's own element — same markup, same class names, same
 * stylesheet. Cloning rather than re-rendering is what keeps the picture honest: there is no
 * second implementation of the card that could drift from the one in the feed.
 *
 * A clone also gives what the live node cannot. It is never hovered, never focused and never
 * mid-ripple, so the picture is the card at rest rather than the click that asked for it; and
 * it can be edited freely, which is where the two elements a rasterizer cannot draw get
 * replaced by something it can.
 */

/* Chrome that belongs to the app rather than to the post: any menu, tooltip or toast that
   happens to be open inside the card when it is copied, and the card's own "…" button —
   an affordance in a picture is just a smudge. `data-capture-ignore` is the escape hatch for
   anything else that should not be carried into a copy. */
const STRIP_SELECTORS = ['[popover]', 'dialog', '[aria-label="Post options"]', '[data-capture-ignore]']

/* Typography the card inherits rather than declares. It is read off the live node and pinned to
   the clone, because a clone is mounted somewhere else in the document and inherits whatever is
   in force there: the copy sheet opens from the share menu, which lives in the post's own action
   row, where the app sets a 13px type scale. Colour is deliberately not on this list — the sheet
   re-resolves that under the theme the reader picks. */
const INHERITED_TYPOGRAPHY = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  /* `line-height` is deliberately absent: the app sets it unitless, which children inherit as a
     multiplier of their own size. Pinning the root's computed pixel value hands every descendant
     the *card's* leading — 24px lines around 10px labels. */
  'letterSpacing',
  'wordSpacing',
  'textTransform',
  'fontVariationSettings',
  'fontFeatureSettings',
  'textAlign',
  'direction',
]

/**
 * The frame a video is showing right now, for one that carries no poster.
 *
 * Cross-origin footage taints the canvas and `toDataURL` throws — the gateway a video streams
 * from is not always ours, so this is an expected miss rather than an error.
 * @param {HTMLVideoElement} video
 * @returns {string|null} A PNG data URI.
 */
function currentFrameOf(video) {
  if (!video.videoWidth || video.readyState < 2) return null

  try {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

/**
 * Swaps every <video> in the clone for the still the copy should show.
 *
 * A <video> paints nothing inside a rasterized <foreignObject>, and the rasterizer's own
 * workaround is to re-download the file and seek it — for a video pinned on IPFS that is tens
 * of megabytes fetched again through the gateway, which is how a copy ends up never finishing.
 * The poster is the frame the feed already shows, and it is already in the browser's cache.
 *
 * The two trees are structurally identical, so index order pairs them.
 * @param {HTMLElement} node Live post element.
 * @param {HTMLElement} clone Its clone.
 */
function replaceVideos(node, clone) {
  const originals = node.querySelectorAll('video')
  const clones = clone.querySelectorAll('video')

  originals.forEach((video, index) => {
    const cloned = clones[index]
    if (!cloned) return

    const still = video.poster || currentFrameOf(video)

    /* No poster and no frame to grab: the box still belongs in the layout, so it stays as an
       empty one rather than collapsing the card around it. */
    if (!still) {
      const box = document.createElement('div')
      box.className = cloned.className
      cloned.replaceWith(box)
      return
    }

    const image = document.createElement('img')
    image.src = still
    image.className = cloned.className
    image.alt = ''
    /* Sizing comes from the gallery's own class, but object-fit is the one property whose
       initial value differs between the two elements — `contain` for video, `fill` for img. */
    image.style.objectFit = getComputedStyle(video).objectFit
    cloned.replaceWith(image)
  })
}

/**
 * Swaps every <canvas> for its own bitmap. A cloned canvas is a blank one — the pixels live in
 * the drawing context, not in the markup — which is what would flatten a cashtag's sparkline
 * into an empty strip.
 * @param {HTMLElement} node Live post element.
 * @param {HTMLElement} clone Its clone.
 */
function replaceCanvases(node, clone) {
  const originals = node.querySelectorAll('canvas')
  const clones = clone.querySelectorAll('canvas')

  originals.forEach((canvas, index) => {
    const cloned = clones[index]
    if (!cloned) return

    try {
      const { width, height } = getComputedStyle(canvas)
      const image = document.createElement('img')
      image.src = canvas.toDataURL()
      image.className = cloned.className
      image.alt = ''
      image.style.width = width
      image.style.height = height
      cloned.replaceWith(image)
    } catch {
      /* Tainted by cross-origin pixels — the blank clone is the best available */
    }
  })
}

/**
 * A deep, inert copy of a post card, ready to be shown in the copy dialog and rasterized from
 * there. Not attached to anything: the caller mounts it.
 * @param {HTMLElement} node The post's root element.
 * @returns {HTMLElement}
 */
export function buildPostSheet(node) {
  const clone = node.cloneNode(true)

  /* Before anything is removed, while the two trees still line up index for index */
  replaceVideos(node, clone)
  replaceCanvases(node, clone)

  const computed = getComputedStyle(node)
  for (const property of INHERITED_TYPOGRAPHY) clone.style[property] = computed[property]

  /* The thread line down the left edge runs 5rem past the bottom of the card, to meet the
     comments underneath it. A copy is one card on its own — the line would trail off the edge
     of the picture pointing at nothing. */
  clone.setAttribute('data-has-comments', 'false')

  for (const selector of STRIP_SELECTORS) {
    for (const element of clone.querySelectorAll(selector)) element.remove()
  }

  /* Two elements answering to one id is invalid the moment this is mounted beside the original */
  clone.removeAttribute('id')
  for (const element of clone.querySelectorAll('[id]')) element.removeAttribute('id')

  /* A copy carries the whole post. The clamp and its "Show more" are a scrolling affordance,
     and a picture has nothing to expand — the words below the fold would simply be lost. */
  for (const element of clone.querySelectorAll('[data-collapsed]')) {
    element.style.maxHeight = 'none'
    element.style.webkitLineClamp = 'unset'
    element.style.overflow = 'visible'
    element.removeAttribute('data-collapsed')
  }
  for (const button of clone.querySelectorAll('[data-show-more]')) button.remove()

  /* Everything in the picture has to be decoded by the time it is drawn, including the media
     the feed deferred because it was below the fold */
  for (const image of clone.querySelectorAll('img')) {
    image.loading = 'eager'
    image.decoding = 'sync'
  }

  return clone
}
