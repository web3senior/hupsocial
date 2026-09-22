/* End-to-end Hup Tasks run on Base Sepolia through two MCP clients: a poster funds a sealed task,
   a worker registers an ERC-8004 identity and submits, the poster opens, approves and rates it,
   then a second task is posted and cancelled. Both wallets need a little Base Sepolia ETH:
   HUP_POSTER_KEY and HUP_WORKER_KEY. Needs a running cidex for 84532 (hup + HupTasks rows). */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'

const base = process.env.HUP_BASE_URL || 'https://localhost:3000'
const local = /localhost|127\.0\.0\.1/.test(base)
const chain = process.env.HUP_TEST_CHAIN || 'base-sepolia'
if (!process.env.HUP_POSTER_KEY || !process.env.HUP_WORKER_KEY) throw new Error('Set HUP_POSTER_KEY and HUP_WORKER_KEY (funded throwaway keys)')

const connect = async (key, label) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../bin/hup-mcp.js', import.meta.url))],
    env: { ...process.env, HUP_BASE_URL: base, HUP_AGENT_PRIVATE_KEY: key, ...(local ? { NODE_TLS_REJECT_UNAUTHORIZED: '0' } : {}) },
    stderr: 'pipe',
  })
  transport.stderr?.on('data', (d) => process.stderr.write(`[${label}] ${d}`))
  const client = new Client({ name: `hup-tasks-${label}`, version: '0.0.0' })
  await client.connect(transport)
  return async (name, args, { quiet = false } = {}) => {
    const t0 = Date.now()
    const res = await client.callTool({ name, arguments: args })
    const text = res.content?.[0]?.text ?? ''
    if (!quiet || res.isError) console.log(`\n## ${label} ${name} (${Date.now() - t0}ms) isError=${res.isError ?? false}\n${text.slice(0, 1400)}`)
    if (res.isError) throw new Error(`${name} failed: ${text}`)
    return JSON.parse(text)
  }
}

const until = async (label, fn, { tries = 40, delayMs = 3000 } = {}) => {
  for (let i = 0; i < tries; i += 1) {
    const value = await fn()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

const poster = await connect(process.env.HUP_POSTER_KEY, 'poster')
const worker = await connect(process.env.HUP_WORKER_KEY, 'worker')

if (process.env.HUP_TEST_ONLY === 'cancel') {
  // HUP_TEST_FUND_POST funds a post that promised a task but was never funded, instead of a new one
  let postId = process.env.HUP_TEST_FUND_POST
  if (postId) await poster('hup_fund_task', { chain, post_id: postId })
  else {
    const lone = await poster('hup_post_task', {
      chain,
      text: 'hup-mcp tasks test: a task that gets cancelled before anyone replies. Ignore.',
      category: 'other',
      reward: '0.00001',
      slots: 1,
      duration_hours: 1,
    })
    postId = String(lone.post.post_id)
  }
  await poster('hup_close_task', { chain, post_id: postId, action: 'cancel' })
  console.log(`\nDONE cancel ${postId}`)
  process.exit(0)
}

const posted = await poster('hup_post_task', {
  chain,
  text: 'hup-mcp tasks test: translate "good morning" into French. Reply with just the translation. Throwaway test, ignore.',
  category: 'translate',
  reward: '0.00001',
  slots: 2,
  duration_hours: 2,
  sealed: true,
})
const postId = String(posted.post.post_id)
if (posted.task?.status !== 'confirmed') throw new Error('Funding did not confirm')

await until('the task to index', async () => (await worker('hup_task', { network_id: chain, post_id: postId }, { quiet: true })).task)
await worker('hup_tasks', { network_id: chain, status: 'open', limit: 3 })

const identity = await worker('hup_register_agent', { chain, name: 'hup-mcp test worker', description: 'Throwaway worker used to test Hup Tasks.' })
const submitted = await worker('hup_submit_task', { chain, post_id: postId, text: 'Bonjour' })
if (!submitted.sealed) throw new Error('Expected a sealed submission')

const review = await until('the submission to index', async () => {
  const r = await poster('hup_review_task', { chain, post_id: postId }, { quiet: true })
  return r.submissions.find((s) => String(s.reply_id) === String(submitted.post_id)) ? r : null
})
const entry = review.submissions.find((s) => String(s.reply_id) === String(submitted.post_id))
console.log('\nopened sealed submission:', JSON.stringify(entry))
if (entry.text !== 'Bonjour') throw new Error('The poster could not open the sealed submission')

await poster('hup_approve_task', { chain, post_id: postId, approvals: [{ reply_id: submitted.post_id, rating: 90 }] })
const paid = await until('the payout to index', async () => {
  const t = await worker('hup_task', { network_id: chain, post_id: postId }, { quiet: true })
  return t.task?.paid_slots === 1 ? t : null
})
console.log('\nafter approval:', JSON.stringify(paid.task), JSON.stringify(paid.submissions))

await poster('hup_close_task', { chain, post_id: postId, action: 'extend', hours: 1 })

const second = await poster('hup_post_task', {
  chain,
  text: 'hup-mcp tasks test: a task that gets cancelled before anyone replies. Ignore.',
  category: 'other',
  reward: '0.00001',
  slots: 1,
  duration_hours: 1,
})
await poster('hup_close_task', { chain, post_id: String(second.post.post_id), action: 'cancel' })

console.log(`\nDONE task ${postId}, agent ${identity.agent_id ?? identity.identity?.agent_id}`)
process.exit(0)
