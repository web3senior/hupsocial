import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { ethers } from 'ethers'
import { featuredAchievementMessage } from '../../lib/achievements.js'

// Exercise the real wallet verifier with a deterministic ERC-1271 RPC boundary.
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/lib/serverPublicClient') {
      return { url: 'data:text/javascript,export const getServerPublicClient = (id) => globalThis.__achievementSignatureClients?.[id]', shortCircuit: true }
    }
    return next(specifier, context)
  },
})
const { verifyWalletSignature } = await import('../../lib/walletSignature.js')
hook.deregister()

test('EOA and Universal Profile signatures use the same featured message', async () => {
  const signer = ethers.Wallet.createRandom()
  const up = `0x${'12'.repeat(20)}`
  const fields = { achievementId: 'og', scope: '', nonce: 'a'.repeat(32), issuedAt: Date.now() }
  const message = featuredAchievementMessage({ ...fields, address: signer.address })
  assert.equal(await verifyWalletSignature(signer.address, message, await signer.signMessage(message), { chainId: 42 }), true)

  const upMessage = featuredAchievementMessage({ ...fields, address: up })
  const upSignature = '0xabcd'
  const calls = []
  globalThis.__achievementSignatureClients = {
    42: { readContract: async (request) => {
      calls.push(request)
      return request.address === up && request.args[0] === ethers.hashMessage(upMessage) && request.args[1] === upSignature ? '0x1626ba7e' : '0xffffffff'
    } },
  }
  try {
    assert.equal(await verifyWalletSignature(up, upMessage, upSignature, { chainId: 42 }), true)
    assert.equal(calls[0].functionName, 'isValidSignature')
    assert.equal(await verifyWalletSignature(up, `${upMessage} tampered`, upSignature, { chainId: 42 }), false)
  } finally {
    delete globalThis.__achievementSignatureClients
  }
})
