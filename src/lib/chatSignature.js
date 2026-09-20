/**
 * @file lib/chatSignature.js
 * @description The exact string a wallet signs to open a chat session. Built in one place because
 * the browser signs it and the server re-reads it. Kept free of server imports so the dock can
 * import it.
 */

export const CHAT_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000

/**
 * @param {{address: string, nonce: string, issuedAt: number}} claim
 * @returns {string}
 */
export const chatSessionMessage = ({ address, nonce, issuedAt }) =>
  [
    'Sign in to Hup chat',
    '',
    `Wallet: ${String(address ?? '').toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${issuedAt}`,
  ].join('\n')
