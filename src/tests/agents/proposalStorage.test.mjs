import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const owner = 'owner-wallet'
const address = 'agent-wallet'
const state = { draft: null, writes: [], wrongOwner: false }
const attachment = { cid: 'ipfs://bafytest', type: 'file', name: 'report.pdf', mimeType: 'application/pdf', size: 100, storage: 'IPFS' }
const modules = {
  '@/lib/db': { default: { execute: async (sql, args) => {
    if (sql.startsWith('SELECT * FROM hosted_agents')) return [[state.wrongOwner ? undefined : { agent_address: address, created_at: new Date() }]]
    if (sql.startsWith('SELECT kind,')) return [[state.draft]]
    if (sql.startsWith('SELECT * FROM (')) return [[{ ...state.draft, id: 1, created_at: new Date() }]]
    if (sql.startsWith('UPDATE agent_proposals SET text')) {
      state.writes.push({ sql, args })
      state.draft.text = args[0]
      state.draft.attachments = args[1]
      return [{ affectedRows: 1 }]
    }
    if (sql.startsWith('UPDATE agent_proposals SET status')) {
      state.writes.push({ sql, args })
      return [{ affectedRows: 1 }]
    }
    throw new Error(`Unexpected query: ${sql}`)
  } } },
  '@/lib/address': { normalizeAddress: (value) => value, isEvmAddress: () => true },
  '@/lib/drops': { INTERFACEID_LSP0: '0x' },
  '@/lib/serverRpc': { getServerProvider: async () => null },
  '@/config/agentModels': { DEFAULT_AGENT_MODEL: 'test', isAgentModel: () => true },
  '@/lib/storageHelper': { AVATAR_MAX_SIZE: 1000, resolveAvatarImageUrl: () => null },
  '@/lib/botAvatar': { BOT_TRAITS: {}, isBotTraits: () => false },
}
globalThis.__proposalStorageModules = modules
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(modules, specifier)) {
      const source = Object.keys(modules[specifier]).map((name) => name === 'default'
        ? `export default globalThis.__proposalStorageModules[${JSON.stringify(specifier)}].default`
        : `export const ${name} = globalThis.__proposalStorageModules[${JSON.stringify(specifier)}][${JSON.stringify(name)}]`).join('\n')
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    }
    if (specifier.startsWith('@/')) return nextResolve(new URL(`../../${specifier.slice(2)}.js`, import.meta.url).href, context)
    return nextResolve(specifier, context)
  },
})
const { resolveProposal, readProposals } = await import('../../lib/hostedAgents.js')
hooks.deregister()
const reset = (kind = 'post', status = 'pending') => {
  state.draft = { kind, status, text: 'Original digest', attachments: null, network_id: 42 }
  state.writes = []
  state.wrongOwner = false
}

test('owner saves text and files without publishing, then reads them back', async () => {
  reset()
  await resolveProposal(owner, address, 1, { status: 'pending', text: 'Updated digest', attachments: [attachment] })
  assert.equal(state.draft.status, 'pending')
  assert.equal(state.draft.network_id, 42)
  const [saved] = await readProposals(address)
  assert.equal(saved.text, 'Updated digest')
  assert.deepEqual(saved.attachments, [attachment])
  assert.equal(state.writes.length, 1)
})

test('text-only updates retain attachments; explicit removal persists an empty list', async () => {
  reset('reply')
  state.draft.attachments = JSON.stringify([attachment])
  await resolveProposal(owner, address, 1, { status: 'pending', text: 'Changed reply' })
  assert.deepEqual(JSON.parse(state.draft.attachments), [attachment])
  await resolveProposal(owner, address, 1, { status: 'pending', attachments: [] })
  assert.deepEqual(JSON.parse(state.draft.attachments), [])
})

test('non-owners and resolved proposals cannot be modified', async () => {
  reset()
  state.wrongOwner = true
  await assert.rejects(resolveProposal(owner, address, 1, { status: 'pending', text: 'Changed' }), (error) => error.status === 404)
  for (const status of ['published', 'discarded']) {
    reset('post', status)
    await assert.rejects(resolveProposal(owner, address, 1, { status: 'pending', text: 'Changed' }), (error) => error.status === 409)
    assert.equal(state.writes.length, 0)
  }
})

test('fixed-target proposals and invalid attachments cannot be edited', async () => {
  for (const kind of ['transfer', 'tip', 'like', 'delete', 'profile']) {
    reset(kind)
    await assert.rejects(resolveProposal(owner, address, 1, { status: 'pending', attachments: [attachment] }), (error) => error.status === 400)
    assert.equal(state.writes.length, 0)
  }
  reset()
  await assert.rejects(resolveProposal(owner, address, 1, { status: 'pending', attachments: [{ ...attachment, size: 20 * 1024 * 1024 }] }), (error) => error.status === 400)
})

test('publication records the actual edited text and attachments', async () => {
  reset('edit')
  await resolveProposal(owner, address, 1, { status: 'published', txHash: `0x${'a'.repeat(64)}`, networkId: 42, text: 'Final digest', attachments: [attachment] })
  const { args } = state.writes[0]
  assert.equal(args[0], 'published')
  assert.equal(args[3], 'Final digest')
  assert.deepEqual(JSON.parse(args[4]), [attachment])
})
