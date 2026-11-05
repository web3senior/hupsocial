import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { ethers } from 'ethers'
import { achievementSettingMessage } from '../../lib/achievementSettings.js'

// Isolate database writes while exercising the real route and wallet signature validation.
test('admin catalog, signed settings save, reset and rejected signature', async () => {
  const signer = ethers.Wallet.createRandom()
  const previousAdmin = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS
  process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS = signer.address
  const settings = new Map()
  let nonce = null
  const queries = []
  globalThis.__achievementAdminTestPool = {
    execute: async (sql, values = []) => {
      queries.push(sql)
      if (sql.startsWith('SELECT achievement_id, settings')) {
        return [[...settings].map(([achievement_id, value]) => ({ achievement_id, settings: value }))]
      }
      if (sql.startsWith('DELETE FROM nonces')) {
        const accepted = values[0] === nonce && values[1] === signer.address.toLowerCase()
        if (accepted) nonce = null
        return [{ affectedRows: accepted ? 1 : 0 }]
      }
      if (sql.startsWith('INSERT INTO achievement_settings')) {
        settings.set(values[0], values[1])
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('DELETE FROM achievement_settings')) {
        settings.delete(values[0])
        return [{ affectedRows: 1 }]
      }
      throw new Error(`Unexpected database access: ${sql}`)
    },
  }
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === '@/lib/db') return { url: 'data:text/javascript,export default globalThis.__achievementAdminTestPool', shortCircuit: true }
      return next(specifier, context)
    },
  })
  try {
    const { GET, POST } = await import('../../app/api/v1/admin/achievements/route.js')
    const catalogResponse = await GET(new Request('http://localhost/api/v1/admin/achievements'))
    assert.equal(catalogResponse.status, 200)
    assert.equal((await catalogResponse.json()).data.catalog.length, 14)
    const send = async (change, wallet = signer) => {
      nonce = 'a'.repeat(32)
      const signature = await wallet.signMessage(achievementSettingMessage(change, nonce))
      return POST(new Request('http://localhost/api/v1/admin/achievements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...change, nonce, signature, chainId: 1 }),
      }))
    }
    const change = { action: 'settings', id: 'generous', name: 'Updated award', description: 'Sent 25 tips.', rarity: 'epic', listed: false, thresholds: { threshold: 25 } }
    const saved = await send(change)
    assert.equal(saved.status, 200)
    const item = (await saved.json()).data.catalog.find((entry) => entry.id === change.id)
    assert.equal(item.name, change.name)
    assert.equal(item.threshold, 25)
    assert.equal(item.listed, false)
    assert.equal(nonce, null)
    const rejected = await send({ ...change, name: 'Unauthorized' }, ethers.Wallet.createRandom())
    assert.equal(rejected.status, 403)
    assert.equal(JSON.parse(settings.get(change.id)).name, change.name)
    const reset = await send({ action: 'reset-settings', id: change.id })
    assert.equal(reset.status, 200)
    assert.equal((await reset.json()).data.catalog.find((entry) => entry.id === change.id).overridden, false)
    assert.equal(settings.size, 0)
    assert.ok(queries.every((sql) => !sql.includes('user_achievements')))
  } finally {
    hook.deregister()
    delete globalThis.__achievementAdminTestPool
    if (previousAdmin === undefined) delete process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS
    else process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS = previousAdmin
  }
})
