'use client'

import { useEffect } from 'react'
import { captureReferral } from '@/lib/referral'

/** Remembers a Hupster's ?ref= on whichever page a visitor lands on. Renders nothing. */
export default function ReferralCapture() {
  useEffect(() => {
    captureReferral()
  }, [])

  return null
}
