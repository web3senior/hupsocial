
/**
 * Handler bus for the app-wide Security Vault unlock, shaped exactly like the embedded
 * wallet's tx-confirm bus: a dialog mounted once in the shell registers itself here, and any
 * module-level code that hits a locked vault awaits `requestVaultUnlock()` instead of dying.
 *
 * The alternative is what this replaces — a `window.prompt` asking for a password that has not
 * decrypted anything since the vault became the single key source. Signing needs a wallet
 * signature, so the surface has to be a React component; this is the seam between the two.
 */

let unlockHandler = null

/** Registers the mounted dialog. Returns the deregistration cleanup for useEffect. */
export const setVaultUnlockHandler = (handler) => {
  unlockHandler = handler
  return () => {
    if (unlockHandler === handler) unlockHandler = null
  }
}

export const hasVaultUnlockSurface = () => Boolean(unlockHandler)

/**
 * Opens the vault unlock dialog and resolves once the vault is open.
 *
 * @param {{ reason?: string }} [context] - short line naming what is waiting on the unlock
 * @throws {Error} code 'VAULT_LOCKED' when no dialog is mounted (SSR, a mini app frame).
 * @throws {Error} code 4001 when the user cancels.
 */
export const requestVaultUnlock = async (context = {}) => {
  if (!unlockHandler) {
    const err = new Error('Security Vault is locked')
    err.code = 'VAULT_LOCKED'
    throw err
  }
  return unlockHandler(context)
}
