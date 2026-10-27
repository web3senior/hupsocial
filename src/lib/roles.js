/**
 * @file lib/roles.js
 * @description Roles an admin gives a wallet by hand — the Hupster ambassador mark first. Shared by
 * the client and the server: the mark, the admin tab and the route all read the catalogue here, so
 * renaming a role is this file and nothing else. The stored value is the slug, never the label.
 */

export const ROLES = {
  ambassador: {
    label: 'Hupster',
    description: 'Hup ambassador',
  },
}

export const ROLE_IDS = Object.keys(ROLES)

export const isRole = (value) => typeof value === 'string' && Object.hasOwn(ROLES, value)

/**
 * The message the admin signs to grant or revoke a role, built the same way on the client and the
 * server so the signature recovers to the admin wallet.
 * @param {{ action: 'grant'|'revoke', wallet: string, role: string, nonce: string }} params
 * @returns {string}
 */
export const roleMessage = ({ action, wallet, role, nonce }) =>
  `${action === 'grant' ? 'Grant' : 'Revoke'} a Hup role.\nWallet: ${wallet}\nRole: ${role}\nNonce: ${nonce}`
