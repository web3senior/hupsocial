/**
 * @file lib/connectDialog.js
 * @description Opens the wallet chooser from anywhere. Same bus shape as the email login handler
 * in lib/embeddedWallet/connector.js, and dependency-free for the same reason: a like button must
 * not pull the dialog's module graph in just to ask for it.
 *
 * openConnect() reports whether a chooser was there rather than throwing, unlike openEmailLogin().
 * These callers sit on hot paths (a like, the composer) where a missing surface should degrade to
 * the message they already showed, not take the tap down with it.
 */

let handler = null

export const setConnectHandler = (next) => {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

/** True when a chooser was mounted and opened; false leaves the fallback to the caller. */
export const openConnect = () => {
  if (!handler) return false
  handler()
  return true
}
