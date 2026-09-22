/**
 * @file lib/taskFundingBus.js
 * @description Lets code outside React ask for the Fund Task dialog. The composer closes the
 * moment a task post is sent, so once the indexer confirms the post it is this bus, not the
 * composer, that opens the funding step (TaskFundingHost renders it).
 */

import { useSyncExternalStore } from 'react'

let current = null
const listeners = new Set()

const emit = () => {
  for (const listener of listeners) listener()
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** @param {{ networkId: number, postId: string|number, terms: Object }} request */
export const requestTaskFunding = (request) => {
  current = request
  emit()
}

export const clearTaskFunding = () => {
  current = null
  emit()
}

export const useTaskFundingRequest = () =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  )
