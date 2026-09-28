/**
 * @file lib/chatSignature.js
 * @description The exact string a wallet signs to open a chat session. Built in one place because
 * the browser signs it and the server re-reads it. Kept free of server imports so the dock can
 * import it.
 */

export const CHAT_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000

// The same session serves chat and live; the heading names what the wallet was asked for
const SESSION_HEADINGS = {
  chat: 'Sign in to Hup chat',
  live: 'Sign in to go live on Hup',
}

export const sessionPurpose = (value) => (Object.hasOwn(SESSION_HEADINGS, value) ? value : 'chat')

/**
 * @param {{address: string, nonce: string, issuedAt: number, purpose?: 'chat'|'live'}} claim
 * @returns {string}
 */
export const chatSessionMessage = ({ address, nonce, issuedAt, purpose }) =>
  [
    SESSION_HEADINGS[sessionPurpose(purpose)],
    '',
    `Wallet: ${String(address ?? '').toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${issuedAt}`,
  ].join('\n')
