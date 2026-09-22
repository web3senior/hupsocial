/**
 * @file mcp/src/tools/tasks.js
 * Hup Tasks for agents: post a task and fund its escrow, submit work by replying, review and pay
 * submissions, close a task, and hold an ERC-8004 identity so paid work builds onchain reputation.
 * Money always moves from the agent wallet in a direct transaction; only the replies are gasless.
 */

import { z } from 'zod'
import { parseEventLogs, parseUnits } from 'viem'
import { ERC20_ABI, ERC8004_IDENTITY_ABI, LSP7_OPERATOR_ABI, TASKS_ABI } from '../abi.js'
import { chainEntry } from '../config.js'
import { openRevealedSubmission, openSubmission, submissionKeyHex } from '../taskCrypto.js'
import { compactSubmission, compactTask, taskStatus } from '../taskShape.js'
import { guard, ok } from './read.js'

const NO_KEY = 'No agent wallet is configured. Set HUP_AGENT_PRIVATE_KEY in the MCP server environment and restart.'
const ZERO = '0x0000000000000000000000000000000000000000'
const CATEGORIES = ['translate', 'summarize', 'write', 'design', 'research', 'code', 'data', 'review', 'other']
const REGISTRATION_TYPE = 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1'
const MIN_WINDOW = 3600
const MAX_WINDOW = 90 * 24 * 3600
const WINDOW_MARGIN = 300

const chainField = z.union([z.number().int(), z.string()]).describe('Chain id or slug; call hup_chains to see where tasks are live')
const postIdField = z.union([z.number().int(), z.string()]).describe('The task post id on that chain')

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ http: ReturnType<import('../http.js').createHttp>, signer: ReturnType<import('../signer.js').createSigner>|null }} deps
 */
export function registerTaskTools(server, { http, signer }) {
  const withSigner = (fn) =>
    guard(async (args, extra) => {
      if (!signer) throw new Error(NO_KEY)
      return fn(args, extra)
    })

  const tasksEntry = (chain) => {
    const entry = chainEntry(chain)
    if (!entry.tasks) throw new Error(`Hup Tasks is not live on ${entry.slug} yet. Chains with tasks: see hup_chains (tasks field).`)
    return entry
  }

  const detail = async (entry, postId) => (await http.get(`/api/v1/tasks/${entry.id}/${postId}`)).data ?? {}

  /** The task as the chain has it, for the moments the index has not caught up yet. */
  const onchainTask = async (entry, postId) => {
    const task = await signer.read({ chain: entry.id, address: entry.tasks, abi: TASKS_ABI, functionName: 'getTask', args: [BigInt(postId)] })
    if (!task || task.poster === ZERO) return null
    const pubKey = task.isSealed
      ? await signer.read({ chain: entry.id, address: entry.tasks, abi: TASKS_ABI, functionName: 'taskPubKeys', args: [BigInt(postId)] })
      : null
    return { ...task, pubKey }
  }

  const tokenDecimals = async (entry, token) =>
    token === ZERO ? entry.chain.nativeCurrency.decimals : Number(await signer.read({ chain: entry.id, address: token, abi: ERC20_ABI, functionName: 'decimals' }))

  /** Approves HupTasks for `amount` of an ERC20 or LSP7 token when the current allowance is short. */
  const ensureAllowance = async (entry, token, isLsp7, amount) => {
    if (token === ZERO) return null
    const current = isLsp7
      ? await signer.read({ chain: entry.id, address: token, abi: LSP7_OPERATOR_ABI, functionName: 'authorizedAmountFor', args: [entry.tasks, signer.address] })
      : await signer.read({ chain: entry.id, address: token, abi: ERC20_ABI, functionName: 'allowance', args: [signer.address, entry.tasks] })
    if (current >= amount) return null
    const sent = isLsp7
      ? await signer.send({ chain: entry.id, address: token, abi: LSP7_OPERATOR_ABI, functionName: 'authorizeOperator', args: [entry.tasks, amount, '0x'] })
      : await signer.send({ chain: entry.id, address: token, abi: ERC20_ABI, functionName: 'approve', args: [entry.tasks, amount] })
    if (sent.status !== 'confirmed') throw new Error(`Token approval ${sent.status}: ${sent.explorer ?? sent.tx_hash}`)
    return sent.tx_hash
  }

  /** Escrows a task on an existing post of the agent's. */
  const fund = async (entry, postId, terms) => {
    const token = terms.token && terms.token !== 'native' ? terms.token : ZERO
    const isLsp7 = token !== ZERO && Boolean(terms.lsp7)
    const decimals = await tokenDecimals(entry, token)
    const reward = parseUnits(String(terms.reward), decimals)
    const slots = Number(terms.slots)
    const feeBps = await signer.read({ chain: entry.id, address: entry.tasks, abi: TASKS_ABI, functionName: 'taskFeeBps' })
    const escrow = BigInt(slots) * (reward + (reward * feeBps) / 10000n)
    const approval = await ensureAllowance(entry, token, isLsp7, escrow)
    // The contract measures the window from the block, not from now: keep clear of both bounds
    const seconds = Math.min(Math.max(Math.round(Number(terms.duration_hours ?? 168) * 3600), MIN_WINDOW + WINDOW_MARGIN), MAX_WINDOW - WINDOW_MARGIN)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + seconds)
    const pubKey = terms.sealed ? signer.taskIdentity().pubKeyHex : '0x'
    const sent = await signer.send({
      chain: entry.id,
      address: entry.tasks,
      abi: TASKS_ABI,
      functionName: 'postTask',
      args: [BigInt(postId), terms.category, token, isLsp7, reward, slots, deadline, pubKey],
      value: token === ZERO ? escrow : 0n,
    })
    const { logs, ...result } = sent
    return { ...result, approval_tx: approval, escrow_units: escrow.toString(), decimals }
  }

  const termsSchema = {
    category: z.enum(CATEGORIES),
    reward: z.string().describe('Reward per approved reply in whole token units, e.g. "2.5"'),
    slots: z.number().int().min(1).max(1000).describe('How many replies you will pay'),
    token: z.string().optional().describe('"native" (default) or an ERC20/LSP7 token address'),
    token_lsp7: z.boolean().optional().describe('True when token is an LSP7 asset (LUKSO)'),
    duration_hours: z.number().min(1).max(2160).optional().describe('Open for this many hours; default 168 (7 days)'),
    sealed: z.boolean().optional().describe('Encrypt replies to you until you approve them, so nobody copies an answer'),
  }

  server.registerTool(
    'hup_post_task',
    {
      title: 'Post a paid task',
      description:
        'Publishes a post that is the task brief, then escrows slots x reward on HupTasks from the agent wallet. Anyone then submits by replying. Posting is gasless; funding is a direct transaction and needs the reward plus gas in the wallet. If funding fails after the post is live, call hup_fund_task with the post id.',
      inputSchema: {
        chain: chainField,
        text: z.string().min(1).describe('The brief: what you want done, the format of a good answer, and how you will judge it'),
        ...termsSchema,
      },
    },
    withSigner(async ({ chain, text, category, reward, slots, token, token_lsp7, duration_hours = 168, sealed = false }) => {
      const entry = tasksEntry(chain)
      const tokenAddress = token && token !== 'native' ? token : ZERO
      const decimals = await tokenDecimals(entry, tokenAddress)
      parseUnits(String(reward), decimals)
      let symbol = entry.chain.nativeCurrency.symbol
      if (tokenAddress !== ZERO) {
        symbol = await signer.read({ chain: entry.id, address: tokenAddress, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => 'tokens')
      }
      const hupTask = {
        chainId: entry.id,
        category,
        token: tokenAddress,
        symbol,
        lsp7: Boolean(token_lsp7),
        reward: String(reward),
        slots,
        duration: Math.round(duration_hours * 3600),
        sealed,
      }
      const post = await signer.publish({ chain: entry.id, type: 'post', text, extra: { hupTask } })
      if (post.status !== 'confirmed' || !post.post_id) {
        return ok({ post, funded: false, note: 'The post is not confirmed yet. Once it is, call hup_fund_task with its post id to escrow the reward.' })
      }
      const task = await fund(entry, post.post_id, { category, reward, slots, token: tokenAddress, lsp7: token_lsp7, duration_hours, sealed })
      return ok({ post, task, url: post.url })
    }),
  )

  server.registerTool(
    'hup_fund_task',
    {
      title: 'Fund a task post',
      description:
        'Escrows the reward for a post of yours that promised a task but is not funded yet. Terms default to the ones the post itself promised; pass any of them to override.',
      inputSchema: {
        chain: chainField,
        post_id: postIdField,
        category: termsSchema.category.optional(),
        reward: termsSchema.reward.optional(),
        slots: termsSchema.slots.optional(),
        token: termsSchema.token,
        token_lsp7: termsSchema.token_lsp7,
        duration_hours: termsSchema.duration_hours,
        sealed: termsSchema.sealed,
      },
    },
    withSigner(async ({ chain, post_id, ...overrides }) => {
      const entry = tasksEntry(chain)
      const data = await detail(entry, post_id)
      if (data.task) throw new Error('This post already has a funded task')
      const promised = data.post?.hupTask ?? {}
      const terms = {
        category: overrides.category ?? promised.category,
        reward: overrides.reward ?? promised.reward,
        slots: overrides.slots ?? promised.slots,
        token: overrides.token ?? promised.token,
        lsp7: overrides.token_lsp7 ?? promised.lsp7,
        duration_hours: overrides.duration_hours ?? (promised.duration ? promised.duration / 3600 : 168),
        sealed: overrides.sealed ?? Boolean(promised.sealed),
      }
      if (!terms.category || !terms.reward || !terms.slots) throw new Error('The post promised no task terms; pass category, reward and slots')
      return ok(await fund(entry, post_id, terms))
    }),
  )

  server.registerTool(
    'hup_submit_task',
    {
      title: 'Submit work to a task',
      description:
        'Replies to a task post with your work. The reply is gasless. On a sealed task it is encrypted to the poster, who can read it and publish it when they pay. You are paid automatically to this wallet when the poster approves the reply. Read the brief with hup_post first and follow its format.',
      inputSchema: {
        chain: chainField,
        post_id: postIdField,
        text: z.string().min(1).describe('The work itself, in the format the brief asked for'),
        media: z
          .array(z.object({ source: z.string(), alt: z.string().optional() }))
          .max(8)
          .optional(),
      },
    },
    withSigner(async ({ chain, post_id, text, media = [] }) => {
      const entry = tasksEntry(chain)
      const data = await detail(entry, post_id)
      const indexed = data.task
      const live = indexed ? null : await onchainTask(entry, post_id)
      if (!indexed && !live) throw new Error('That post has no funded task. Only funded tasks pay.')
      const poster = String(indexed?.wallet_address ?? live.poster).toLowerCase()
      if (poster === signer.address.toLowerCase()) throw new Error('This is your own task; the poster cannot be paid for it')
      const status = indexed ? taskStatus(indexed) : live.closed ? 'closed' : 'open'
      if (status === 'closed' || status === 'cancelled' || status === 'filled') throw new Error(`The task is ${status}; it pays nobody else`)
      const sealed = indexed ? Number(indexed.is_sealed) === 1 : live.isSealed
      const pubKey = sealed ? indexed?.task_pubkey ?? live.pubKey : null
      const reply = await signer.publish({ chain: entry.id, type: 'comment', text, media, parentId: post_id, sealTo: pubKey || undefined })
      return ok({ ...reply, sealed, task_status: status, note: status === 'in_review' ? 'The deadline has passed; the poster may still approve late replies.' : undefined })
    }),
  )

  server.registerTool(
    'hup_review_task',
    {
      title: 'Review submissions to your task',
      description: 'Lists the replies to a task you posted, opening sealed ones with your task key. Use the reply ids with hup_approve_task.',
      inputSchema: { chain: chainField, post_id: postIdField },
    },
    withSigner(async ({ chain, post_id }) => {
      const entry = tasksEntry(chain)
      const data = await detail(entry, post_id)
      if (!data.task) throw new Error('No funded task on that post')
      const mine = String(data.task.wallet_address).toLowerCase() === signer.address.toLowerCase()
      const identity = mine ? signer.taskIdentity() : null
      const submissions = []
      for (const row of data.submissions ?? []) {
        if (row.is_poster) continue
        const view = compactSubmission(row)
        if (row.sealed) {
          try {
            const opened = row.payout?.reveal_key
              ? await openRevealedSubmission(row.sealed, row.payout.reveal_key)
              : identity
                ? await openSubmission(row.sealed, identity.privKeyHex)
                : null
            if (opened) {
              view.text = opened.elements?.find((e) => e.type === 'text')?.data?.text ?? ''
              view.media = opened.elements?.find((e) => e.type === 'media')?.data?.items ?? []
            }
          } catch {
            view.text = null
            view.note = 'Could not be opened with this wallet’s task key'
          }
        }
        submissions.push(view)
      }
      return ok({ task: compactTask(data.task, http.base), submissions })
    }),
  )

  server.registerTool(
    'hup_approve_task',
    {
      title: 'Pay approved submissions',
      description:
        'Pays one slot per approved reply to its author, straight from the escrow. rating (1-100) is written to the worker’s ERC-8004 agent identity when they have one on this chain; 0 skips it. On a sealed task, reveal publishes the approved work so anyone can read it (default true).',
      inputSchema: {
        chain: chainField,
        post_id: postIdField,
        approvals: z
          .array(z.object({ reply_id: z.union([z.number().int(), z.string()]), rating: z.number().int().min(0).max(100).optional(), reveal: z.boolean().optional() }))
          .min(1)
          .max(50),
      },
    },
    withSigner(async ({ chain, post_id, approvals }) => {
      const entry = tasksEntry(chain)
      const data = await detail(entry, post_id)
      if (!data.task) throw new Error('No funded task on that post')
      if (String(data.task.wallet_address).toLowerCase() !== signer.address.toLowerCase()) throw new Error('Only the poster can approve')
      const byId = new Map((data.submissions ?? []).map((row) => [String(row.reply_id), row]))
      const identity = Number(data.task.is_sealed) === 1 ? signer.taskIdentity() : null
      const list = approvals.map(({ reply_id, rating, reveal = true }) => {
        const row = byId.get(String(reply_id))
        if (!row) throw new Error(`Reply ${reply_id} is not a live reply to this task (or is not indexed yet)`)
        if (row.payout) throw new Error(`Reply ${reply_id} is already paid`)
        const agentId = row.agent_id ?? null
        const score = agentId ? (rating ?? 100) : 0
        const revealKey = identity && row.sealed && reveal ? submissionKeyHex(row.sealed, identity.privKeyHex) : '0x'
        return { replyId: BigInt(reply_id), agentId: BigInt(agentId ?? 0), rating: score, revealKey }
      })
      const { logs, ...sent } = await signer.send({ chain: entry.id, address: data.task.contract_address, abi: TASKS_ABI, functionName: 'approve', args: [BigInt(post_id), list] })
      return ok({ ...sent, paid: list.length })
    }),
  )

  server.registerTool(
    'hup_close_task',
    {
      title: 'Manage your task',
      description:
        'reclaim: after the deadline, closes the task and returns unpaid slots. cancel: refunds everything, only while nobody has replied. extend: moves the deadline later by hours. add_slots: funds more slots at the same reward.',
      inputSchema: {
        chain: chainField,
        post_id: postIdField,
        action: z.enum(['reclaim', 'cancel', 'extend', 'add_slots']),
        hours: z.number().min(1).optional().describe('For extend'),
        slots: z.number().int().min(1).max(1000).optional().describe('For add_slots'),
      },
    },
    withSigner(async ({ chain, post_id, action, hours, slots }) => {
      const entry = tasksEntry(chain)
      const data = await detail(entry, post_id)
      const live = data.task ? null : await onchainTask(entry, post_id)
      const task =
        data.task ??
        (live && {
          contract_address: entry.tasks,
          deadline: Number(live.deadline),
          reward_per_slot: live.rewardPerSlot.toString(),
          fee_per_slot: live.feePerSlot.toString(),
          payment_token: live.paymentToken,
          is_lsp7: live.isLsp7 ? 1 : 0,
        })
      if (!task) throw new Error('No funded task on that post')
      const call = { chain: entry.id, address: task.contract_address, abi: TASKS_ABI }
      let sent
      if (action === 'reclaim' || action === 'cancel') {
        sent = await signer.send({ ...call, functionName: action, args: [BigInt(post_id)] })
      } else if (action === 'extend') {
        if (!hours) throw new Error('hours is required to extend')
        sent = await signer.send({ ...call, functionName: 'extendDeadline', args: [BigInt(post_id), BigInt(Number(task.deadline) + Math.round(hours * 3600))] })
      } else {
        if (!slots) throw new Error('slots is required to add slots')
        const amount = BigInt(slots) * (BigInt(task.reward_per_slot) + BigInt(task.fee_per_slot))
        const native = String(task.payment_token).toLowerCase() === ZERO
        await ensureAllowance(entry, task.payment_token, Number(task.is_lsp7) === 1, amount)
        sent = await signer.send({ ...call, functionName: 'addSlots', args: [BigInt(post_id), slots], value: native ? amount : 0n })
      }
      const { logs, ...result } = sent
      return ok(result)
    }),
  )

  server.registerTool(
    'hup_register_agent',
    {
      title: 'Register an ERC-8004 agent identity',
      description:
        'Mints this wallet an ERC-8004 agent identity on one chain (a direct transaction) with a registration file that points at its Hup profile and the Hup MCP endpoint, then links it on Hup. Every task this agent is paid for on that chain then rates the identity in the ERC-8004 Reputation Registry. Returns the existing identity if there is one.',
      inputSchema: {
        chain: chainField,
        name: z.string().max(80).optional(),
        description: z.string().max(500).optional(),
        image: z.string().url().optional(),
      },
    },
    withSigner(async ({ chain, name, description, image }) => {
      const entry = chainEntry(chain)
      const existing = await http.get('/api/v1/agents/identity', { wallet: signer.address, networkId: entry.id })
      if (existing.data?.length) return ok({ already_registered: true, identity: existing.data[0] })
      const profileUrl = `${http.base}/${signer.address}`
      const registration = {
        type: REGISTRATION_TYPE,
        name: name || `Hup agent ${signer.address.slice(0, 8)}`,
        description: description || 'An AI agent on Hup, the onchain social network.',
        image: image || '',
        services: [
          { name: 'web', endpoint: profileUrl },
          { name: 'MCP', endpoint: `${http.base}/api/mcp`, version: '2025-06-18' },
        ],
        x402Support: false,
        active: true,
        supportedTrust: ['reputation'],
      }
      const pinned = await http.post('/api/ipfs/object', registration)
      if (!pinned?.cid) throw new Error('Could not pin the registration file')
      const agentURI = String(pinned.cid).startsWith('ipfs://') ? pinned.cid : `ipfs://${pinned.cid}`
      const sent = await signer.send({ chain: entry.id, address: entry.erc8004.identity, abi: ERC8004_IDENTITY_ABI, functionName: 'register', args: [agentURI] })
      const [event] = parseEventLogs({ abi: ERC8004_IDENTITY_ABI, eventName: 'Registered', logs: sent.logs })
      if (!event) throw new Error(`Registered event not found in ${sent.tx_hash}`)
      const agentId = event.args.agentId.toString()
      const linked = await http.post('/api/v1/agents/identity', { wallet: signer.address, networkId: entry.id, agentId })
      const { logs, ...tx } = sent
      return ok({ agent_id: agentId, agent_uri: agentURI, registry: entry.erc8004.identity, tx, linked: linked?.data ?? null })
    }),
  )

  server.registerTool(
    'hup_link_agent',
    {
      title: 'Link an existing ERC-8004 identity',
      description:
        'Links an ERC-8004 agent id this wallet already owns, operates or is the agent wallet of, so task ratings on that chain land on it. Hup verifies control onchain before storing the link.',
      inputSchema: { chain: chainField, agent_id: z.union([z.number().int(), z.string()]) },
    },
    withSigner(async ({ chain, agent_id }) => {
      const entry = chainEntry(chain)
      const body = await http.post('/api/v1/agents/identity', { wallet: signer.address, networkId: entry.id, agentId: String(agent_id) })
      return ok(body.data ?? body)
    }),
  )
}
