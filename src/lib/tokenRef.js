/**
 * @file lib/tokenRef.js
 * @description How a token is named in a URL. Pages under /trade and /token are keyed on the
 * contract address, because the address is the token's only identity that exists off Hup — a
 * sequential launch id can only ever name something this app launched itself.
 *
 * The numeric form is still accepted everywhere a ref is read: every link shared before the
 * change, and every in-post launch card written against the old shape, arrives that way. Pages
 * resolve it and redirect to the canonical address form rather than serving both forever.
 */

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/

export const isTokenAddress = (value) => ADDRESS_PATTERN.test(String(value ?? ''))

/**
 * Read a route param as either form. A numeric launch id can never look like an address, so the
 * two are told apart by shape alone and no caller has to say which it holds.
 * @param {string} value
 * @returns {{kind: 'address', address: string}|{kind: 'id', launchId: string}|null}
 */
export const parseTokenRef = (value) => {
  const raw = String(value ?? '').trim()
  if (isTokenAddress(raw)) return { kind: 'address', address: raw.toLowerCase() }
  if (/^\d+$/.test(raw)) return { kind: 'id', launchId: raw }
  return null
}

/** The trading workspace for a token. */
export const launchHref = (networkId, address) => `/trade/${networkId}/${String(address).toLowerCase()}`

/** The shareable front page for a token. */
export const tokenHref = (networkId, address) => `/token/${networkId}/${String(address).toLowerCase()}`
