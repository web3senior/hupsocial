// PollTimer.js
import React, { useState, useEffect } from 'react'
import moment from 'moment'
import web3 from 'web3'

function PollTimer({ startTime, endTime, pollId }) {
  const [timeLeft, setTimeLeft] = useState(0)
  const [isPollActive, setIsPollActive] = useState(false)

  useEffect(() => {
    // Convert the Unix timestamps to moment objects
    const startMoment = moment.unix(web3.utils.toNumber(startTime))
    const endMoment = moment.unix(web3.utils.toNumber(endTime))

    const updateTimer = () => {
      const now = moment()
      if (now.isBefore(startMoment)) {
        // Poll is in the future, count down to the start time
        setTimeLeft(startMoment.diff(now))
        setIsPollActive(false)
      } else if (now.isBetween(startMoment, endMoment)) {
        // Poll is currently active, count down to the end time
        setTimeLeft(endMoment.diff(now))
        setIsPollActive(true)
      } else {
        // Poll has ended
        setTimeLeft(0)
        setIsPollActive(false)
      }
    }

    // Run the update immediately
    updateTimer()

    // Set up a timer to update every second
    const timer = setInterval(updateTimer, 1000)

    // Clean up the interval when the component unmounts
    return () => clearInterval(timer)
  }, [startTime, endTime]) // The effect depends on both startTime and endTime

  // Format the remaining time
  const duration = moment.duration(timeLeft)
  const days = Math.floor(duration.asDays())
  const hours = duration.hours()
  const minutes = duration.minutes()
  const seconds = duration.seconds()

  const formattedTime = `${days > 0 ? `${days}d ` : ''}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`

  if (timeLeft <= 0 && !isPollActive) {
    return <>Poll ended</>
  }

  return (
    <>
      {isPollActive ? 'Ends' : 'Starts'} in {formattedTime}
    </>
  )
}

export default PollTimer
