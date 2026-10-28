/**
 * @file lib/hupBridge/respond.js
 * @description The bridge API's response shape: { success, data } or { success: false, error }.
 * A BridgeError carries a message safe to show and its HTTP status; anything else is a 500.
 */

import { NextResponse } from 'next/server'

export class BridgeError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export const ok = (data, init) => NextResponse.json({ success: true, data }, init)

export function fail(error) {
  const status = error instanceof BridgeError ? error.status : 500
  if (status === 500) console.error('[bridge]', error)
  return NextResponse.json({ success: false, error: status === 500 ? 'Something went wrong' : error.message }, { status })
}
