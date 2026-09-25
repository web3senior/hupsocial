/**
 * @file lib/whitelist.js
 * @description The Mint Whitelist, shared by the page and the route that writes it.
 */

/**
 * The exact string a wallet signs to join. Built in one place because the browser signs it and
 * the server re-reads it — a character of drift between the two rejects every sign-up.
 * @param {{address: string, nonce: string, issuedAt: number}} request
 * @returns {string}
 */
export const whitelistJoinMessage = ({ address, nonce, issuedAt }) =>
  [
    'Join the Mint Whitelist',
    '',
    'This signature is free and sends no transaction.',
    '',
    `Wallet: ${String(address ?? '').toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${issuedAt}`,
  ].join('\n')
