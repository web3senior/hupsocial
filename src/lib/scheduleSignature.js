/**
 * @file lib/scheduleSignature.js
 * @description The exact string a wallet signs to manage its scheduled posts. Built in one place
 * because the browser signs it and the server re-reads it. Kept free of server imports so the
 * composer can import it.
 */

export const SCHEDULE_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000

// The earliest a post may be scheduled for, and the furthest out
export const SCHEDULE_MIN_LEAD_S = 60
export const SCHEDULE_MAX_AHEAD_S = 366 * 24 * 60 * 60

// How long past its time a pre-signed request stays deliverable. The relayer only needs a few
// minutes of slack; the rest covers a cron that was down, and bounds how long a signed request
// sits in the database.
export const SCHEDULE_DELIVERY_WINDOW_S = 3 * 24 * 60 * 60

/**
 * @param {{address: string, nonce: string, issuedAt: number}} claim
 * @returns {string}
 */
export const scheduleSessionMessage = ({ address, nonce, issuedAt }) =>
  [
    'Manage your scheduled posts on Hup',
    '',
    `Wallet: ${String(address ?? '').toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${issuedAt}`,
  ].join('\n')
