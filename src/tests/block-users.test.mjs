import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
}

// Resolve app aliases without relying on another feature's test loader.
const addressSource = await readFile(new URL('../lib/address.js', import.meta.url), 'utf8')
const addressModule = `data:text/javascript;base64,${Buffer.from(addressSource).toString('base64')}`
const storeSource = (await readFile(new URL('../stores/useBlockStore.js', import.meta.url), 'utf8'))
  .replace("'zustand'", JSON.stringify(import.meta.resolve('zustand')))
  .replace("'zustand/middleware'", JSON.stringify(import.meta.resolve('zustand/middleware')))
  .replace("'@/lib/address'", JSON.stringify(addressModule))
const { useBlockStore } = await import(`data:text/javascript;base64,${Buffer.from(storeSource).toString('base64')}`)
const viewer = `0x${'a'.repeat(40)}`
const otherViewer = `0x${'b'.repeat(40)}`
const target = `0x${'c'.repeat(40)}`

test('blocks normalize EVM addresses, deduplicate, and stay scoped to the viewer', () => {
  const { setBlocked } = useBlockStore.getState()
  setBlocked(viewer, target.toUpperCase().replace('0X', '0x'), true)
  setBlocked(viewer, target, true)
  assert.deepEqual(useBlockStore.getState().blockedByWallet[viewer], [target])
  assert.equal(useBlockStore.getState().blockedByWallet[otherViewer], undefined)
  setBlocked(otherViewer, target, true)
  setBlocked(viewer, target, false)
  assert.deepEqual(useBlockStore.getState().blockedByWallet[viewer], [])
  assert.deepEqual(useBlockStore.getState().blockedByWallet[otherViewer], [target])
})

test('invalid addresses and self-blocks do not change state', () => {
  const before = useBlockStore.getState().blockedByWallet
  const { setBlocked } = useBlockStore.getState()
  setBlocked(viewer, viewer, true)
  setBlocked(null, target, true)
  setBlocked(viewer, 'invalid', true)
  assert.equal(useBlockStore.getState().blockedByWallet, before)
})

test('Solana identities preserve case and blocks survive rehydration', async () => {
  const solanaTarget = 'Ab'.repeat(16)
  useBlockStore.getState().setBlocked(viewer, solanaTarget, true)
  assert.deepEqual(useBlockStore.getState().blockedByWallet[viewer], [solanaTarget])
  useBlockStore.setState({ blockedByWallet: {} })
  // Restore the previously saved payload, as a fresh browser load would.
  useBlockStore.getState().setBlocked(viewer, solanaTarget, true)
  const saved = [...storage.entries()]
  useBlockStore.setState({ blockedByWallet: {} })
  saved.forEach(([key, value]) => storage.set(key, value))
  await useBlockStore.persist.rehydrate()
  assert.deepEqual(useBlockStore.getState().blockedByWallet[viewer], [solanaTarget])
})
