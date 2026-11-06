// node --experimental-test-module-mocks --import ./src/tests/personal-vault/loader.mjs --test src/tests/follows/*.test.mjs
import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError } from 'viem'
import { isOnchainFollowAccount } from '../../lib/followAccount.js'
import { readFollowRelations } from '../../lib/socialFollows.js'

const wallet = `0x${'a'.repeat(40)}`
const target = `0x${'b'.repeat(40)}`
const other = `0x${'c'.repeat(40)}`
let state

const client = {
  getCode: async () => {
    if (state.rpcError) throw state.rpcError
    return state.profile ? '0x6000' : '0x'
  },
  readContract: async (request) => {
    state.reads.push(request)
    if (request.functionName === 'supportsInterface') return state.profile
    return state.followed.has(request.args[1])
  },
}

mock.module('wagmi/actions', {
  namedExports: {
    getConnection: () => ({ address: state.address, chainId: state.chainId }),
    getPublicClient: (_config, options) => {
      assert.equal(options.chainId, 42)
      return client
    },
    switchChain: async (_config, { chainId }) => {
      state.switches.push(chainId)
      state.chainId = chainId
      if (state.switchAddress) state.address = state.switchAddress
    },
    writeContract: async (_config, request) => {
      if (state.writeError) throw state.writeError
      state.writes.push(request)
      return '0x123'
    },
    waitForTransactionReceipt: async () => ({ status: state.receiptStatus }),
  },
})
mock.module(new URL('../../config/wagmi.js', import.meta.url).href, { namedExports: { config: {} } })
mock.module(new URL('../../lib/chatApi.js', import.meta.url).href, {
  namedExports: {
    ensureChatSession: async () => {
      state.sessions++
      return 'token'
    },
    clearChatToken: () => { state.cleared++ },
  },
})

const { setFollowing } = await import('../../lib/follow.js')
const update = (changes = {}) => setFollowing({ address: wallet, targets: [target], following: true, signMessageAsync: async () => 'signature', chainId: state.chainId, ...changes })

beforeEach(() => {
  state = {
    address: wallet, chainId: 42, profile: true, followed: new Set(),
    reads: [], writes: [], switches: [], requests: [], sessions: 0, cleared: 0,
    receiptStatus: 'success', offchain: [],
  }
  mock.method(globalThis, 'fetch', async (url, options) => {
    state.requests.push({ url, ...options })
    if (options?.method === 'PUT' && state.unauthorized) {
      state.unauthorized = false
      return { ok: false, status: 401, json: async () => ({ error: 'Expired' }) }
    }
    return {
      ok: true,
      json: async () => ({ success: true, data: { following: [], onchain: [], offchain: state.offchain } }),
    }
  })
})

afterEach(() => mock.restoreAll())

test('Universal Profiles follow onchain from the profile with no session or offchain write', async () => {
  assert.deepEqual(await update(), { onchain: true })
  assert.equal(state.sessions, 0)
  assert.equal(state.requests.length, 0)
  assert.equal(state.writes[0].functionName, 'follow')
  assert.equal(state.writes[0].account, wallet)
  assert.equal(state.writes[0].chainId, 42)
  assert.deepEqual(state.writes[0].args, [target])
})

test('other wallets follow offchain without switching chains or sending transactions', async () => {
  state.profile = false
  state.chainId = 1
  assert.deepEqual(await update(), { onchain: false })
  assert.equal(state.sessions, 1)
  assert.equal(state.writes.length, 0)
  assert.deepEqual(state.switches, [])
  assert.deepEqual(JSON.parse(state.requests[0].body), { targets: [target], following: true })
})

test('Universal Profiles switch to LUKSO and filter duplicate, self and existing batch targets', async () => {
  state.chainId = 1
  state.followed.add(target)
  await update({ targets: [target, other, other, wallet] })
  assert.deepEqual(state.switches, [42])
  assert.deepEqual(state.writes[0].args, [other])
  assert.equal(state.writes[0].functionName, 'follow')
})

test('multiple new targets use one followBatch transaction', async () => {
  await update({ targets: [target, other] })
  assert.equal(state.writes.length, 1)
  assert.equal(state.writes[0].functionName, 'followBatch')
  assert.deepEqual(state.writes[0].args, [[target, other]])
})

test('already-followed targets need no transaction', async () => {
  state.followed.add(target)
  await update()
  assert.equal(state.writes.length, 0)
})

test('Universal Profiles unfollow onchain without creating an offchain session', async () => {
  state.followed.add(target)
  assert.deepEqual(await update({ following: false }), { onchain: false })
  assert.equal(state.writes[0].functionName, 'unfollow')
  assert.equal(state.sessions, 0)
  assert.equal(state.requests.filter((request) => request.method === 'PUT').length, 0)
})

test('unfollow batches exclude targets already absent from the live registry', async () => {
  state.followed.add(target)
  state.followed.add(other)
  await update({ following: false, targets: [target, other, `0x${'d'.repeat(40)}`] })
  assert.equal(state.writes[0].functionName, 'unfollowBatch')
  assert.deepEqual(state.writes[0].args, [[target, other]])
})

test('unfollowing a mixed relation clears its old offchain row as well', async () => {
  state.followed.add(target)
  state.offchain = [target]
  await update({ following: false })
  const request = state.requests.find((request) => request.method === 'PUT')
  assert.deepEqual(JSON.parse(request.body), { targets: [target], following: false })
  assert.equal(state.writes[0].functionName, 'unfollow')
})

test('RPC failure cannot silently create an offchain follow for a Universal Profile', async () => {
  state.rpcError = new Error('RPC unavailable')
  await assert.rejects(update(), /RPC unavailable/)
  assert.equal(state.sessions, 0)
  assert.equal(state.requests.length, 0)
})

test('cancelled and reverted transactions propagate without offchain fallback', async () => {
  state.writeError = new Error('User rejected request')
  await assert.rejects(update(), /User rejected/)
  state.writeError = null
  state.receiptStatus = 'reverted'
  await assert.rejects(update(), /did not go through/)
  assert.equal(state.sessions, 0)
  assert.equal(state.requests.length, 0)
})

test('a changed account during chain switching cannot send as a different identity', async () => {
  state.chainId = 1
  state.switchAddress = other
  await assert.rejects(update(), /wallet changed/)
  assert.equal(state.writes.length, 0)
})

test('expired offchain sessions are renewed once', async () => {
  state.profile = false
  state.unauthorized = true
  await update()
  assert.equal(state.sessions, 2)
  assert.equal(state.cleared, 1)
  assert.equal(state.requests.length, 2)
})

test('other wallets unfollow offchain without sending transactions', async () => {
  state.profile = false
  state.chainId = 1
  await update({ following: false })
  assert.deepEqual(JSON.parse(state.requests[0].body), { targets: [target], following: false })
  assert.equal(state.writes.length, 0)
  assert.deepEqual(state.switches, [])
})

test('older onchain follows remain removable by other wallets', async () => {
  state.profile = false
  state.followed.add(target)
  await update({ following: false, onchain: [target] })
  assert.equal(state.writes[0].functionName, 'unfollow')
  assert.equal(state.writes[0].account, wallet)
})

test('failed mixed unfollows propagate so the onchain relation remains retryable', async () => {
  state.followed.add(target)
  state.offchain = [target]
  state.writeError = new Error('User rejected request')
  await assert.rejects(update({ following: false }), /User rejected/)
  assert.equal(state.requests.filter((request) => request.method === 'PUT').length, 1)
})

test('relation reads distinguish offchain rows and the canonical LUKSO registry', async () => {
  const db = {
    execute: async (sql, args) => {
      assert.match(sql, /MAX\(network_id = \? AND contract_address = \?\) AS onchain/)
      assert.equal(args[0], 42)
      assert.equal(args[1].toLowerCase(), '0xf01103e5a9909fc0dbe8166da7085e0285daddca')
      assert.equal(args[2], 0)
      assert.equal(args[4], wallet)
      return [[
        { followed_address: target, onchain: '1', offchain: '0' },
        { followed_address: other, onchain: '0', offchain: '1' },
      ]]
    },
  }
  assert.deepEqual(await readFollowRelations(db, wallet, [target, other]), {
    following: [target, other], onchain: [target], offchain: [other],
  })
})

test('EOAs and other smart wallets are distinguished from LSP0 profiles', async () => {
  assert.equal(await isOnchainFollowAccount({ getCode: async () => undefined }, wallet), false)
  const contract = { getCode: async () => '0x6000', readContract: async () => false }
  assert.equal(await isOnchainFollowAccount(contract, wallet), false)
  for (const cause of [new ContractFunctionZeroDataError({ functionName: 'supportsInterface' }), new ContractFunctionRevertedError({ abi: [], functionName: 'supportsInterface', message: 'reverted' })]) {
    contract.readContract = async () => { throw new BaseError('Call failed', { cause }) }
    assert.equal(await isOnchainFollowAccount(contract, wallet), false)
  }
  contract.readContract = async () => { throw new Error('Transport failed') }
  await assert.rejects(isOnchainFollowAccount(contract, wallet), /Transport failed/)
})
