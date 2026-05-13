/**
 * @file lib/viewer.js
 * @description Retrieves or generates a unique identifier for the current viewer.
 */

import { v4 as uuidv4 } from 'uuid'

export const getViewerId = (walletAddress) => {
  /* Use the wallet address if the user is connected */
  if (walletAddress) return walletAddress

  /* Check for an existing guest ID in local storage */
  let guestId = localStorage.getItem('hup_visitor_id')

  /* If no ID exists, generate a new one and save it */
  if (!guestId) {
    guestId = `guest_${uuidv4()}`
    localStorage.setItem('hup_visitor_id', guestId)
  }

  return guestId
}
