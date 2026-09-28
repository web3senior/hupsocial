/**
 * @file lib/liveApi.js
 * @description Browser fetchers for live streams. Starting, ending and moderating go to the app
 * with the chat bearer token; "is this wallet live?" goes straight to the worker beside the
 * media server, so an audience of any size costs the app nothing.
 */

import { liveStatusUrl } from '@/lib/live'

const STATUS_TIMEOUT_MS = 4000

class LiveApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

const call = async (token, path, init = {}) => {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new LiveApiError(data?.error || 'Live request failed', response.status)
  return data
}

export const fetchLiveStreams = () => call(null, '/api/v1/live').then((body) => body?.data ?? [])

export const fetchStudio = (token) => call(token, '/api/v1/live/session')

export const startLiveStream = (token, { title, networkId }) =>
  call(token, '/api/v1/live/session', { method: 'POST', body: JSON.stringify({ title, networkId }) })

/** keepalive so a closing tab still ends its stream */
export const endLiveStream = (token) => call(token, '/api/v1/live/session', { method: 'DELETE', keepalive: true })

export const killLiveStream = (token, id) => call(token, '/api/v1/live/moderation', { method: 'POST', body: JSON.stringify({ id }) })

/** @returns {Promise<{status: 'offline'|'pending'|'live', id?: number, title?: string, networkId?: number, viewers?: number, startedAt?: string|null}>} */
export const fetchLiveStatus = async (wallet) => {
  const response = await fetch(liveStatusUrl(wallet), { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) })
  if (!response.ok) throw new LiveApiError('Live status is unavailable', response.status)
  return response.json()
}

export const isLiveUnauthorized = (error) => error?.status === 401
