import moment from 'moment'
import web3 from 'web3'

/**
 * Checks if a poll is currently active and calculates the time left.
 * @param {moment.Moment} startMoment The moment object for the poll's start time.
 * @param {moment.Moment} endMoment The moment object for the poll's end time.
 * @returns {{isActive: boolean, timeLeft: number}} An object containing the poll's active status and time left in milliseconds.
 */
export function isPollActive(startMoment, endMoment) {
  startMoment = moment.unix(web3.utils.toNumber(startMoment))
  endMoment = moment.unix(web3.utils.toNumber(endMoment))
  const now = moment()

  if (now.isBetween(startMoment, endMoment)) {
    // Poll is active, return time until it ends
    return { isActive: true, timeLeft: endMoment.diff(now), status: `started` }
  } else if (now.isBefore(startMoment)) {
    // Poll is in the future, return time until it starts
    return { isActive: false, timeLeft: startMoment.diff(now), status: `willstart` }
  } else {
    // Poll has ended
    return { isActive: false, timeLeft: 0, status: `endeed` }
  }
}

/**
 * Condenses a wallet/RPC failure into a single short line fit for a toast.
 * viem packs the whole request payload (chain, from, to, calldata, docs link)
 * into `message`, so prefer `shortMessage` and never spill past the first line.
 * @param {unknown} error The thrown error.
 * @param {string} [fallback] Copy used when nothing readable is found.
 * @returns {string} A one-line reason.
 */
export const shortTxError = (error, fallback = 'Transaction failed') => {
  if (!error) return fallback

  const raw = error.shortMessage || error.details || error.message || ''
  const firstLine = String(raw).split('\n')[0].trim()

  if (!firstLine) return fallback
  if (/user (rejected|denied)/i.test(firstLine)) return 'Transaction rejected'
  if (/insufficient funds/i.test(firstLine)) return 'Insufficient funds for gas'

  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine
}

export const slugify = (str) => {
  str = str.replace(/^\s+|\s+$/g, '') // trim leading/trailing white space
  str = str.toLowerCase() // convert string to lowercase
  str = str
    .replace(/\s+/g, '-') // replace spaces with hyphens
    .replace(/-+/g, '-') // remove consecutive hyphens
  return str
}
