/**
 * @file lib/sharpSvg.js
 * @description Keeps sharp's SVG loader available to the code that rasterizes SVG on purpose.
 *
 * sharp's loader blocklist is process-wide. Next's image optimizer, the first time it serves a
 * `/_next/image` request, blocks every libvips loader and re-allows only JPEG, PNG, GIF, WebP,
 * HEIF and TIFF. On Vercel that optimizer ran in its own function, so nothing else noticed. Under
 * a single `next start` process it switches SVG off for every route, and onchain artwork (Burnt
 * Pix) began failing with "Input buffer contains unsupported image format" until a restart.
 *
 * The optimizer applies its block lazily and only once, so a single unblock at import could land
 * before it and be undone. Callers re-allow SVG right before each decode instead — it is a cheap
 * flag write. Only the SVG loader is reopened; every other loader stays as Next left it.
 */

import sharp from 'sharp'

/** Re-allows SVG input for the sharp pipeline the caller is about to build. */
export const allowSvgInput = () => {
  sharp.unblock({ operation: ['VipsForeignLoadSvg'] })
}
