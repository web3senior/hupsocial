import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizePost, truncateToRuns } from '../../lib/postSummary.js'

let calls = []
let rows = []
let failure = null
globalThis.__hupDbPool = {
  async execute(query, params) {
    calls.push({ query, params })
    if (failure) throw failure
    return [rows]
  },
}
const { getPostPreviewText } = await import('../../lib/postPreview.js')

const post = (text = '', poll = { chainId: 42, pollId: '9007199254740993' }) => ({
  display_name: 'Alice',
  content: { elements: [{ type: 'text', data: { text } }], ...(poll ? { poll } : {}) },
})

test('poll question reaches image text and metadata, using the attachment chain and exact id', async () => {
  rows = [{ question: 'Which feature should we build next?' }]
  const item = { ...post(), network_id: 1 }
  const text = await getPostPreviewText(item)
  assert.equal(text, rows[0].question)
  assert.deepEqual(calls.at(-1).params, ['42', '9007199254740993'])
  assert.equal(truncateToRuns(text, 300).map((run) => run.text).join(''), rows[0].question)
  assert.equal(summarizePost(item, 70, text), rows[0].question)
  assert.equal(summarizePost(item, 200, text), rows[0].question)
})

test('question stays ahead of a long caption and follows the existing truncation limits', async () => {
  rows = [{ question: 'Which feature?' }]
  const item = post('More context '.repeat(50))
  const text = await getPostPreviewText(item)
  assert.ok(text.startsWith('Which feature?\n\nMore context'))
  for (const max of [70, 180, 200, 300]) {
    const summary = summarizePost(item, max, text)
    assert.ok(summary.startsWith('Which feature?'))
    assert.ok(summary.length <= max)
  }
})

test('ordinary posts and invalid poll references do not query the database', async () => {
  calls = []
  for (const poll of [null, {}, { chainId: 42, pollId: 'invalid' }, { chainId: -1, pollId: 2 }]) {
    assert.equal(await getPostPreviewText(post('Hello **world**', poll)), 'Hello **world**')
  }
  assert.equal(calls.length, 0)
  assert.equal(summarizePost(post('Hello **world**', null), 70), 'Hello world')
})

test('unindexed or blank questions preserve captions and describe a poll-only post', async () => {
  for (const result of [[], [{ question: null }], [{ question: '  ' }]]) {
    rows = result
    assert.equal(await getPostPreviewText(post('My caption')), 'My caption')
    const item = post()
    assert.equal(summarizePost(item, 70, await getPostPreviewText(item)), 'Alice shared a poll on Hup')
  }
})

test('lookup failures preserve the post preview', async () => {
  failure = new Error('Database unavailable')
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.equal(await getPostPreviewText(post('My caption')), 'My caption')
  } finally {
    failure = null
    console.warn = warn
  }
})
