/**
 * Condenses a wallet/RPC failure into a single short line fit for a toast.
 * viem packs the whole request payload (chain, from, to, calldata, docs link)
 * into `message`, so prefer `shortMessage` and never spill past the first line.
 * @param {unknown} error The thrown error.
 * @param {string} [fallback] Copy used when nothing readable is found.
 * @returns {string} A one-line reason.
 */
export const shortTxError = (error, fallback = 'Transaction failed') => {
  if (!error) return fallback

  const raw = error.shortMessage || error.details || error.message || ''
  const firstLine = String(raw).split('\n')[0].trim()

  if (!firstLine) return fallback
  if (/user (rejected|denied)/i.test(firstLine)) return 'Transaction rejected'
  if (/insufficient funds/i.test(firstLine)) return 'Insufficient funds for gas'

  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine
}

/**
 * onError handler for <img> tags whose source can die after resolving (IPFS gateways,
 * external NFT metadata). Swaps in the bundled placeholder and stamps `data-broken` —
 * the flag stops the swap from looping if the placeholder itself ever fails, and gives
 * SCSS a hook to render the line-art contained instead of cover-cropped.
 * @param {import('react').SyntheticEvent<HTMLImageElement>} event The img error event.
 */
export const handleBrokenImage = (event) => {
  const img = event.currentTarget
  if (img.dataset.broken) return
  img.dataset.broken = 'true'
  img.src = '/no-image.svg'
}

/**
 * Bundled avatar shown when a profile image can't be fetched. Served from this origin on
 * purpose: the IPFS-hosted default (NEXT_PUBLIC_DEFAULT_PFP_CID) rides the same gateway as
 * the picture that just failed, so it is no fallback at all when that gateway is the problem.
 */
export const FALLBACK_AVATAR_SRC = '/default-pfp.svg'

/**
 * onError handler for avatar <img> tags. A profile picture is a CID the owner pinned
 * somewhere we don't control — once it goes unpinned, or its gateway times out, the
 * browser paints a broken-image glyph next to the name. Swap in the default PFP instead.
 * Same `data-broken` guard as handleBrokenImage, so a failing fallback can't loop.
 * @param {import('react').SyntheticEvent<HTMLImageElement>} event The img error event.
 */
export const handleBrokenAvatar = (event) => {
  const img = event.currentTarget
  if (img.dataset.broken) return
  img.dataset.broken = 'true'
  img.src = FALLBACK_AVATAR_SRC
}

export const slugify = (str) => {
  str = str.replace(/^\s+|\s+$/g, '') // trim leading/trailing white space
  str = str.toLowerCase() // convert string to lowercase
  str = str
    .replace(/\s+/g, '-') // replace spaces with hyphens
    .replace(/-+/g, '-') // remove consecutive hyphens
  return str
}
