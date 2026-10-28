/**
 * @file lib/launchpad/txJournal.js
 * @description Every transaction intent is written down before the wallet is asked, and updated
 * as it moves. An entry that ends `unknown` (the wallet errored after it may have broadcast) is
 * never retried automatically: the user checks the explorer and decides. Browser-only, per device.
 */

const KEY = 'hup_coins_tx_journal'
const LIMIT = 50

export function readJournal() {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

function write(entries) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(-LIMIT)))
  } catch {
    // Storage blocked: the transaction still goes ahead, only without a record on this device
  }
}

export function journal(entry) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  write([...readJournal(), { id, at: Date.now(), status: 'requested', ...entry }])
  return id
}

export function updateJournal(id, patch) {
  write(readJournal().map((entry) => (entry.id === id ? { ...entry, ...patch, updatedAt: Date.now() } : entry)))
}

export const unresolved = () => readJournal().filter((entry) => entry.status === 'sent' || entry.status === 'unknown')
