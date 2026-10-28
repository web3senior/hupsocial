// Transfers this browser started and has not seen finished: a deposit waiting to be claimed on
// LUKSO, or a burn waiting to be released on its source chain. Per device by design; a transfer
// from elsewhere is resumed by its transaction hash. Contracts reject double claims, so a stale
// entry can only ever show as done.

const KEY = 'hup-bridge-pending-v1'
const EVENT = 'hup-bridge-pending'
const EMPTY = '[]'

const read = () => {
  try { return localStorage.getItem(KEY) || EMPTY } catch { return EMPTY }
}

const write = (items) => {
  try { localStorage.setItem(KEY, JSON.stringify(items.slice(-20))) } catch { /* Kept for this visit only. */ }
  window.dispatchEvent(new Event(EVENT))
}

export const subscribePending = (callback) => {
  window.addEventListener('storage', callback)
  window.addEventListener(EVENT, callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(EVENT, callback)
  }
}
export const pendingSnapshot = read
export const pendingServerSnapshot = () => EMPTY

export const parsePending = (snapshot) => {
  try { return JSON.parse(snapshot) } catch { return [] }
}

export function addPending(item) {
  const items = parsePending(read()).filter((entry) => entry.txHash.toLowerCase() !== item.txHash.toLowerCase())
  write([...items, { ...item, at: Date.now() }])
}

export function removePending(txHash) {
  write(parsePending(read()).filter((entry) => entry.txHash.toLowerCase() !== txHash.toLowerCase()))
}

export const clearPending = () => write([])
