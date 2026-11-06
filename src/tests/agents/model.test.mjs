import assert from 'node:assert/strict'
import test from 'node:test'
import { streamRound, streamToolRound } from '../../lib/hupiModel.js'

const tools = [{ type: 'function', function: { name: 'propose_post', parameters: { type: 'object' } } }]
const toolDelta = { tool_calls: [{ index: 0, id: 'draft-1', function: { name: 'propose_post', arguments: '{"text":"Morning digest"}' } }] }
const markup = '<｜DSML｜function_calls><｜DSML｜invoke name="propose_post"><｜DSML｜parameter name="text" string="true">Morning digest</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜function_calls>'

function harness(rounds) {
  const requests = []
  const visible = []
  const client = { chat: { completions: { create: async (request) => {
    requests.push(request)
    assert.ok(rounds.length, 'unexpected extra model request')
    const deltas = rounds.shift()
    return (async function* () {
      for (const delta of deltas) yield { choices: [{ delta }] }
      yield { meta: { usage: { credits_used: 3 } }, choices: [] }
    })()
  } } } }
  return { requests, visible, options: { client, model: 'deepseek/deepseek-chat', messages: [{ role: 'user', content: 'Draft a digest' }], tools, onText: (piece) => visible.push(piece) } }
}

test('recovers character-split DSML through structured tools without displaying markup', async () => {
  const h = harness([[...('I have a draft. ' + markup)].map((content) => ({ content })), [toolDelta]])
  const result = await streamToolRound(h.options)
  assert.equal(result.calls[0].function.name, 'propose_post')
  assert.equal(result.creditsUsed, 6)
  assert.equal(h.requests.length, 2)
  assert.deepEqual(h.requests[1].tools, tools)
  assert.equal(h.visible.join(''), 'I have a draft. \n\n')
  assert.match(h.requests[1].messages.at(-1).content, /structured function tools/)
})

test('ASCII DSML recovery stops after one retry', async () => {
  const content = markup.replaceAll('｜', '|')
  const h = harness([[{ content }], [{ content }]])
  const result = await streamToolRound(h.options)
  assert.equal(h.requests.length, 2)
  assert.equal(result.calls.length, 0)
  assert.ok(result.toolMarkup)
  assert.equal(h.visible.join(''), '')
  assert.equal(result.creditsUsed, 6)
})

test('a retry that only describes the draft still reports failed tool recovery', async () => {
  const h = harness([[{ content: markup }], [{ content: 'Here is my draft.' }]])
  const result = await streamToolRound(h.options)
  assert.equal(result.calls.length, 0)
  assert.ok(result.toolMarkup)
})

test('native tool calls are assembled once even if markup is also present', async () => {
  const h = harness([[{ content: markup }, toolDelta, { tool_calls: [{ index: 0, function: { name: 'propose_post', arguments: ' ' } }] }]])
  const result = await streamToolRound(h.options)
  assert.equal(h.requests.length, 1)
  assert.equal(result.calls.length, 1)
  assert.deepEqual(JSON.parse(result.calls[0].function.arguments), { text: 'Morning digest' })
  assert.equal(h.visible.join(''), '')
})

test('ordinary prose, comparisons and HTML remain intact', async () => {
  const content = 'Prices < yesterday. <strong>Draft</strong> <3'
  const h = harness([[...content].map((piece) => ({ content: piece }))])
  const result = await streamToolRound(h.options)
  assert.equal(result.text, content)
  assert.equal(h.visible.join(''), content)
  assert.equal(h.requests.length, 1)
})

test('does not retry markup when no tools are offered', async () => {
  const h = harness([[{ content: markup }]])
  const result = await streamToolRound({ ...h.options, tools: null })
  assert.ok(result.toolMarkup)
  assert.equal(h.requests.length, 1)
  assert.equal(h.visible.join(''), '')
})

test('existing streamRound consumers retain their streaming behavior', async () => {
  const h = harness([[{ content: 'Hello' }, { content: ' world' }]])
  const result = await streamRound(h.options)
  assert.deepEqual(h.visible.filter(Boolean), ['Hello', ' world'])
  assert.equal(result.text, 'Hello world')
})
