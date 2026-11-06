import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { streamRound, streamToolRound } from '../../lib/hupiModel.js'

const state = { rounds: [], requests: [], proposals: [], charges: [], messages: [] }
const client = { chat: { completions: { create: async (request) => {
  state.requests.push(structuredClone(request))
  assert.ok(state.rounds.length, 'unexpected model request')
  const deltas = state.rounds.shift()
  return (async function* () {
    for (const delta of deltas) yield { choices: [{ delta }] }
    yield { meta: { usage: { credits_used: 2 } }, choices: [] }
  })()
} } } }
class AgentError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const noop = async () => null
const modules = {
  '@/lib/hupiModel': { createModelClient: () => ({ client }), streamRound, streamToolRound },
  '@/lib/hupiTools': { hupiTools: () => [], hupiToolStatus: () => 'Working', readHupiMember: noop, runHupiTool: noop },
  '@/lib/hostedAgents': {
    AgentError,
    MEMORY_MAX: 1000,
    addProposal: async (address, proposal) => {
      const saved = { ...proposal, id: state.proposals.length + 1, status: 'pending' }
      state.proposals.push(saved)
      return saved
    },
    appendMessage: async (...args) => state.messages.push(args),
    getAgent: async () => ({ memory: '' }),
    getSession: async () => ({ id: 7, summary: null }),
    readMessages: async () => [{ role: 'user', content: 'Run the morning digest' }],
    readProposals: async () => [],
    listAgentPosts: noop,
    readAgentPost: noop,
    readPost: noop,
    resolveRecipient: noop,
    setMemory: noop,
    setSessionSummary: noop,
  },
  '@/lib/hostedAgentMessages': { AGENT_BIO_MAX: 500, AGENT_NAME_MAX: 100, AGENT_POST_MAX: 1000 },
  '@/lib/agentBilling': { chargeRun: async (address, charge) => state.charges.push(charge) },
  '@/lib/agentWorkspacePrompt': { workspaceForPrompt: noop },
  '@/config/agentModels': { MIN_RUN_CREDITS: 1 },
  '@/config/contracts': { appChains: [], CONTRACTS: {} },
  '@/lib/agentMcp': { agentMcpTools: async () => [], isAgentMcpTool: () => false, runAgentMcpTool: noop },
  '@/lib/agentFeeds': { FEED_ITEMS_MAX: 10, readFeed: noop },
  '@/lib/agentPrices': { PRICE_SYMBOLS_MAX: 10, readPrices: noop },
}
globalThis.__agentRuntimeTestModules = modules
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(modules, specifier)) {
      const source = Object.keys(modules[specifier]).map((name) => `export const ${name} = globalThis.__agentRuntimeTestModules[${JSON.stringify(specifier)}][${JSON.stringify(name)}]`).join('\n')
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
const { runAgentTurn } = await import('../../lib/agentRuntime.js')
hooks.deregister()

const call = (name, args = {}) => ({ tool_calls: [{ index: 0, id: `call-${name}`, function: { name, arguments: JSON.stringify(args) } }] })
const markup = '<｜DSML｜calls><｜DSML｜invoke name="propose_post"><｜DSML｜parameter name="text" string="true">Morning digest</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜calls>'
const run = async (rounds) => {
  for (const key of Object.keys(state)) state[key] = []
  state.rounds = rounds
  const events = []
  const result = await runAgentTurn({
    agent: { name: 'Dispatch', address: 'agent-wallet', model: 'deepseek/deepseek-chat', persona: '' },
    owner: 'owner-wallet',
    sessionId: 7,
    task: { id: 9, title: 'Morning digest', instructions: 'Draft a digest' },
    send: (event) => events.push(event),
  })
  return { result, events }
}

test('a task with leaked DSML persists a pending proposal and emits its card', async () => {
  const { result, events } = await run([[{ content: markup }], [call('propose_post', { text: 'Morning digest' })], [{ content: 'Here is the draft.' }]])
  assert.equal(state.proposals.length, 1)
  assert.equal(state.proposals[0].status, 'pending')
  assert.equal(state.proposals[0].sessionId, 7)
  assert.deepEqual(events.filter((event) => event.type === 'proposal').map((event) => event.proposal), state.proposals)
  assert.ok(!events.filter((event) => event.type === 'delta').map((event) => event.text).join('').includes('DSML'))
  assert.equal(result.credits, 6)
  assert.equal(state.charges[0].credits, 6)
  assert.equal(state.messages.at(-1)[2], 'Here is the draft.')
})

test('the final research round can still create a proposal', async () => {
  const { events } = await run([
    ...Array.from({ length: 4 }, () => [call('read_memory')]),
    [call('propose_post', { text: 'Digest after research' })],
    [{ content: 'Please review the draft.' }],
  ])
  const finalTools = state.requests[4].tools.map((tool) => tool.function.name)
  assert.ok(finalTools.includes('propose_post'))
  assert.ok(!finalTools.includes('read_feed'))
  assert.equal(state.proposals.length, 1)
  assert.equal(events.filter((event) => event.type === 'proposal').length, 1)
})

test('repeated malformed output fails clearly, bills usage, and creates no proposal', async () => {
  await assert.rejects(run([[{ content: markup }], [{ content: markup }]]), /could not create the proposal card/)
  assert.equal(state.proposals.length, 0)
  assert.equal(state.messages.length, 0)
  assert.equal(state.requests.length, 2)
  assert.equal(state.charges[0].credits, 4)
})
