import moment from 'moment'
import web3 from 'web3';

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
    return { isActive: true, timeLeft: endMoment.diff(now) ,status: `started` }
  } else if (now.isBefore(startMoment)) {
    // Poll is in the future, return time until it starts
    return { isActive: false, timeLeft: startMoment.diff(now),status: `willstart` }
  } else {
    // Poll has ended
    return { isActive: false, timeLeft: 0,status: `endeed` }
  }
}

  const slugify = (str) => {
    str = str.replace(/^\s+|\s+$/g, '') // trim leading/trailing white space
    str = str.toLowerCase() // convert string to lowercase
    str = str
      .replace(/\s+/g, '-') // replace spaces with hyphens
      .replace(/-+/g, '-') // remove consecutive hyphens
    return str
  }