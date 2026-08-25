/**
 * @file lib/webpAnimation.js
 * @description Animation metadata handed from a decoded GIF/WebP to sharp's WebP encoder,
 * clamped to the range the encoder actually accepts.
 */

/* Both of libwebp's animation fields are 16-bit, and sharp validates them before the encode. */
const MAX_16_BIT = 65535

/**
 * libvips reports a GIF's `loop` as the total number of plays — one more than the repeat
 * count stored in the file's NETSCAPE2.0 block — with 0 still meaning forever. An encoder
 * that means "loop as long as the format can express" writes the 16-bit maximum, 65535,
 * rather than 0, so libvips hands back 65536: exactly one past what libwebp can hold.
 * sharp rejects that outright, and the throw took down the whole encode rather than the
 * animation — the request 500'd, the proxy cached the failure, and every surface showing
 * that avatar painted the default PFP instead. Frame delays overflow the same field, since
 * a GIF may hold a frame for up to 655s and libvips reports the delay in milliseconds.
 *
 * Clamping costs nothing anyone can perceive — 65535 plays rather than 65536 — and it keeps
 * a corrupt or missing value from reaching the encoder at all.
 * @param {number} value Raw metadata figure from sharp.
 * @returns {number} The same figure, inside libwebp's range.
 */
const clamp = (value) => Math.min(Math.max(Math.round(Number(value)) || 0, 0), MAX_16_BIT)

/**
 * The `loop`/`delay` options to spread into `.webp()` for an animated source.
 * @param {import('sharp').Metadata} metadata Metadata read with `{ animated: true }`.
 * @returns {{loop: number, delay?: number[]}} Options safe to hand to the encoder.
 */
export function webpAnimationOptions(metadata = {}) {
  const options = { loop: clamp(metadata.loop) }

  if (Array.isArray(metadata.delay) && metadata.delay.length > 0) {
    options.delay = metadata.delay.map(clamp)
  }

  return options
}
