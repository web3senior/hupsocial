// PollTimer.js
import React, { useState, useEffect } from 'react'
import moment from 'moment'
import web3 from 'web3'

function PollTimer({ startTime, endTime }) {
  const [timeLeft, setTimeLeft] = useState(0)

  useEffect(() => {
    // Convert the Unix timestamp to a moment object
    const startMoment = moment.unix(web3.utils.toNumber(startTime))
    const endMoment = moment.unix(web3.utils.toNumber(endTime))

    console.log(`%c ${moment()}`,'font-size:1rem;color:orange')

    // Calculate the initial remaining time in milliseconds
    const initialTimeLeft = endMoment.diff(moment())
    setTimeLeft(initialTimeLeft)

    // Set up the timer to update every second
    const timer = setInterval(() => {
      setTimeLeft((prevTimeLeft) => {
        // If time runs out, clear the interval
        if (prevTimeLeft <= 1000) {
          clearInterval(timer)
          return 0
        }
        // Otherwise, decrease the time by one second
        return prevTimeLeft - 1000
      })
    }, 1000)

    // Clean up the interval when the component unmounts
    return () => clearInterval(timer)
  }, [endTime]) // The effect depends on endTime

  // Format the remaining time
  const formattedTime = moment.utc(timeLeft).format('H:mm:ss')

  // Check if the poll has ended
  if (timeLeft <= 0) {
    return <>Poll Ended</>
  }

  return <>Ends in {formattedTime}</>
}

export default PollTimer
