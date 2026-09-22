/**
 * @file lib/relayerSweep.js
 * @description The message the admin signs to move the relayer's native balance out, built the same
 * way on the client and the server so the signature recovers to the admin wallet.
 */

/**
 * @param {{ to: string, chainIds: (number|string)[], nonce: string }} params
 * @returns {string}
 */
export const sweepMessage = ({ to, chainIds, nonce }) =>
  `Sweep the Hup relayer.\nTo: ${to}\nChains: ${chainIds.join(',')}\nNonce: ${nonce}`
