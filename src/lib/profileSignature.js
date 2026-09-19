/**
 * @file lib/profileSignature.js
 * @description The exact string a wallet signs to authorize a profile write. Built in one place
 * because the browser signs it and the server re-reads it — a character of drift between the two
 * rejects every save.
 *
 * Kept out of lib/walletSignature.js on purpose: that module pulls in ethers and the server's
 * pinned clients, and this string has to be importable from the browser.
 */

/** How long a signed profile claim stays valid. Matches the username claim window. */
export const PROFILE_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000

/**
 * @param {{address: string, nonce: string, issuedAt: number}} claim
 * @returns {string}
 */
export const profileUpdateMessage = ({ address, nonce, issuedAt }) =>
  [
    'Update your Hup profile',
    '',
    `Wallet: ${String(address ?? '').toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${issuedAt}`,
  ].join('\n')
