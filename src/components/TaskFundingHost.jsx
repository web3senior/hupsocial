'use client'

import { clearTaskFunding, useTaskFundingRequest } from '@/lib/taskFundingBus'
import FundTaskDialog from './FundTaskDialog'

/** Mounted once in the shell; renders the funding dialog whenever something requests it. */
export default function TaskFundingHost() {
  const request = useTaskFundingRequest()
  if (!request) return null

  return (
    <FundTaskDialog
      key={`${request.networkId}:${request.postId}`}
      networkId={request.networkId}
      postId={request.postId}
      terms={request.terms}
      onClose={clearTaskFunding}
    />
  )
}
