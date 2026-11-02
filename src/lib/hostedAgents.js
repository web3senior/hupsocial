/**
 * @file lib/hostedAgents.js
 * @description Hosted agents' records, after Zentra's agent store (lib/zentra/store.js): config,
 * private memory, a pause switch, its model, its credits and the conversation. Server-only.
 *
 * The agent's key never reaches this file. It is derived in the owner's browser from Key Vault v2
 * (hup:agent:<n>:v2), which is why this table only maps an address to its owner and index.
 *
 * A Universal Profile owner's agents are of the other kind, 'controller': a random LSP6 key on the
 * owner's profile, kept in their browser, acting only as that profile (lib/lsp6.js). Its address is
 * the agent's id for good; the key acting for it is controller_address, which a new device replaces.
 */

import { ethers } from 'ethers'
import { z } from 'zod'
import pool from '@/lib/db'
import { isEvmAddress, normalizeAddress } from '@/lib/address'
import { AGENT_LIMIT, AGENT_NAME_MAX, AGENT_PERSONA_MAX, agentKeyMessage, agentOwnershipMessage } from '@/lib/hostedAgentMessages'
import { INTERFACEID_LSP0 } from '@/lib/drops'
import { getServerProvider } from '@/lib/serverRpc'
import { DEFAULT_AGENT_MODEL, isAgentModel } from '@/config/agentModels'
import { AVATAR_MAX_SIZE, resolveAvatarImageUrl } from '@/lib/storageHelper'
import { BOT_TRAITS, isBotTraits } from '@/lib/botAvatar'

export const MEMORY_MAX = 12000

export class AgentError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const createSchema = z.object({
  address: z.string().refine(isEvmAddress),
  index: z.number().int().min(0).max(AGENT_LIMIT - 1),
  name: z.string().trim().min(1).max(AGENT_NAME_MAX),
  persona: z.string().trim().min(1).max(AGENT_PERSONA_MAX),
  proof: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  // Only for an imported wallet: its key, encrypted in the owner's browser (lib/agentWallet.js)
  keyCiphertext: z.string().regex(/^[A-Za-z0-9+/=._-]{40,2000}$/).optional(),
  kind: z.enum(['wallet', 'controller']).default('wallet'),
  // The creation fee's payment, for an owner who already has an agent (lib/agentBilling.js); the
  // browser sends null when the agent is free
  fee: z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), chainId: z.number().int().positive() }).nullish(),
})

const keySchema = z.object({
  key: z.string().refine(isEvmAddress),
  proof: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
})

const LUKSO_CHAIN_ID = 42

/* Asked of the chain, not the client: a controller agent is only meaningful on a real profile, and
   the owner is whoever the chat session says, which can be an EOA. */
const isUniversalProfileOwner = async (owner) => {
  const provider = await getServerProvider(LUKSO_CHAIN_ID)
  if (!provider) throw new AgentError(503, 'LUKSO is unreachable right now. Try again in a moment.')
  try {
    const erc165 = new ethers.Contract(owner, ['function supportsInterface(bytes4) view returns (bool)'], provider)
    return Boolean(await erc165.supportsInterface(INTERFACEID_LSP0))
  } catch {
    return false
  }
}

const updateSchema = z.object({
  name: z.string().trim().min(1).max(AGENT_NAME_MAX).optional(),
  persona: z.string().trim().min(1).max(AGENT_PERSONA_MAX).optional(),
  paused: z.boolean().optional(),
  showOwner: z.boolean().optional(),
  model: z.string().refine(isAgentModel).optional(),
  // Only the known traits are kept, so the stored JSON stays small and exactly what draws. null
  // goes back to the look the address picks — what an uploaded picture does
  avatar: z
    .union([z.null(), z.custom(isBotTraits).transform((traits) => Object.fromEntries(Object.keys(BOT_TRAITS).map((name) => [name, traits[name]])))])
    .optional(),
})

const parseAvatar = (value) => {
  try {
    const parsed = value ? JSON.parse(value) : null
    return isBotTraits(parsed) ? parsed : null
  } catch {
    return null
  }
}

const present = (row) => ({
  address: row.agent_address,
  index: Number(row.agent_index),
  name: row.name,
  persona: row.persona,
  showOwner: Boolean(row.show_owner),
  paused: Boolean(row.paused),
  // A model since removed from the list falls back to the default rather than failing the run
  model: isAgentModel(row.model) ? row.model : DEFAULT_AGENT_MODEL,
  credits: Number(row.credits ?? 0),
  // An imported wallet's key, encrypted under the owner's Key Vault; null for a derived one
  keyCiphertext: row.key_ciphertext ?? null,
  // The robot look the owner picked; null means the one the address picks (lib/botAvatar.js)
  avatar: parseAvatar(row.avatar),
  createdAt: new Date(row.created_at).toISOString(),
  kind: row.kind === 'controller' ? 'controller' : 'wallet',
  // The key acting for a controller agent right now; null for a wallet agent, which is its own key
  controllerAddress: row.kind === 'controller' ? (row.controller_address ?? row.agent_address) : null,
})

/**
 * Each agent's current profile picture, keyed by lowercased address. Read from `users` on its own
 * rather than joined: the two tables' address columns use different collations.
 */
const picturesFor = async (addresses) => {
  if (addresses.length === 0) return new Map()
  const [rows] = await pool.execute(
    `SELECT LOWER(wallet_address) AS address, profileImage FROM users WHERE LOWER(wallet_address) IN (${addresses.map(() => '?').join(', ')})`,
    addresses,
  )
  return new Map(rows.filter((row) => row.profileImage).map((row) => [row.address, resolveAvatarImageUrl(row.profileImage, AVATAR_MAX_SIZE)]))
}

export const listAgents = async (owner) => {
  const [rows] = await pool.execute('SELECT * FROM hosted_agents WHERE owner_address = ? ORDER BY agent_index', [owner])
  const pictures = await picturesFor(rows.map((row) => row.agent_address))
  // null means no picture yet; the card shows the default robot
  return rows.map((row) => ({ ...present(row), picture: pictures.get(row.agent_address) ?? null }))
}

/** One of the owner's agents, with its memory. Someone else's agent is a 404, never a 403. */
export const getAgent = async (owner, address) => {
  const [[row]] = await pool.execute('SELECT * FROM hosted_agents WHERE owner_address = ? AND agent_address = ?', [owner, normalizeAddress(address)])
  if (!row) throw new AgentError(404, 'Agent not found')
  return { ...present(row), memory: row.memory ?? '' }
}

/**
 * Registers a new agent. `payment` is its creation fee, already checked onchain by the route
 * (lib/agentBilling.js verifyCreationFee); it is stored with the agent in one transaction, keyed
 * by its hash, so one payment can never create two agents.
 */
export const createAgent = async (owner, input, payment = null) => {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) throw new AgentError(400, 'Check the agent’s name and instructions')
  const { address, index, name, persona, proof, keyCiphertext = null, kind } = parsed.data
  if (kind === 'controller' && keyCiphertext) throw new AgentError(400, 'A Universal Profile agent has no wallet to import')

  let signer
  try {
    signer = ethers.verifyMessage(agentOwnershipMessage({ agent: address, owner, index }), proof)
  } catch {
    throw new AgentError(401, 'The agent’s signature did not check out')
  }
  if (normalizeAddress(signer) !== normalizeAddress(address)) throw new AgentError(401, 'The agent’s signature did not check out')

  const [[{ count }]] = await pool.execute('SELECT COUNT(*) AS count FROM hosted_agents WHERE owner_address = ?', [owner])
  if (Number(count) >= AGENT_LIMIT) throw new AgentError(409, `You can have up to ${AGENT_LIMIT} agents`)
  if (kind === 'controller' && !(await isUniversalProfileOwner(owner))) {
    throw new AgentError(400, 'Only a Universal Profile can have controller agents')
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await connection.execute(
      'INSERT INTO hosted_agents (agent_address, owner_address, agent_index, kind, controller_address, key_ciphertext, name, persona) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [normalizeAddress(address), owner, index, kind, kind === 'controller' ? normalizeAddress(address) : null, keyCiphertext, name, persona],
    )
    if (payment) {
      try {
        await connection.execute(
          'INSERT INTO agent_creation_fees (tx_hash, network_id, owner_address, agent_address, amount_wei, usd_price) VALUES (?, ?, ?, ?, ?, ?)',
          [payment.txHash, payment.networkId, owner, normalizeAddress(address), payment.amountWei, payment.usdPrice],
        )
      } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') throw Object.assign(new AgentError(409, 'That payment already created an agent'), { code: 'FEE_USED' })
        throw error
      }
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    if (error?.code !== 'ER_DUP_ENTRY') throw error
    // Say which clash it was: the wallet is already an agent (here or under another owner), or
    // this owner's slot is taken — never a name, which agents may share
    const [[taken]] = await pool.execute('SELECT name, owner_address FROM hosted_agents WHERE agent_address = ?', [normalizeAddress(address)])
    if (taken) {
      throw new AgentError(409, taken.owner_address === owner ? `That wallet is already your agent ${taken.name}` : 'That wallet is already an agent on Hup')
    }
    throw new AgentError(409, 'That agent slot is taken. Reload the page and try again.')
  } finally {
    connection.release()
  }
  return getAgent(owner, address)
}

export const updateAgent = async (owner, address, input) => {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) throw new AgentError(400, 'Check the agent’s settings')
  await getAgent(owner, address)

  const columns = { name: 'name', persona: 'persona', paused: 'paused', showOwner: 'show_owner', model: 'model', avatar: 'avatar' }
  const entries = Object.entries(parsed.data).filter(([, value]) => value !== undefined)
  if (entries.length) {
    await pool.execute(
      `UPDATE hosted_agents SET ${entries.map(([key]) => `${columns[key]} = ?`).join(', ')} WHERE owner_address = ? AND agent_address = ?`,
      [...entries.map(([, value]) => (typeof value === 'boolean' ? Number(value) : value && typeof value === 'object' ? JSON.stringify(value) : value)), owner, normalizeAddress(address)],
    )
  }
  return getAgent(owner, address)
}

/**
 * Points a Universal Profile agent at a new key — the one a new device made and swapped in on the
 * profile. The new key signs for itself, so a session alone cannot hand an agent to a stranger's key.
 * Whether the profile actually lets the key act is the profile's own business, checked onchain.
 */
export const setAgentKey = async (owner, address, input) => {
  const parsed = keySchema.safeParse(input)
  if (!parsed.success) throw new AgentError(400, 'Check the new key')
  const agent = await getAgent(owner, address)
  if (agent.kind !== 'controller') throw new AgentError(400, 'Only a Universal Profile agent changes keys')

  const { key, proof } = parsed.data
  let signer
  try {
    signer = ethers.verifyMessage(agentKeyMessage({ agent: agent.address, owner, key }), proof)
  } catch {
    throw new AgentError(401, 'The new key’s signature did not check out')
  }
  if (normalizeAddress(signer) !== normalizeAddress(key)) throw new AgentError(401, 'The new key’s signature did not check out')

  try {
    await pool.execute('UPDATE hosted_agents SET controller_address = ? WHERE owner_address = ? AND agent_address = ?', [normalizeAddress(key), owner, agent.address])
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') throw new AgentError(409, 'That key already acts for another agent')
    throw error
  }
  return getAgent(owner, address)
}

/**
 * Removes an agent from Hup: its settings, chat, drafts, tasks, workspace files, usage and snapshot
 * cache. What lives onchain stays — its wallet and anything in it, its profile and posts, and its
 * workspace snapshots — and a derived agent can be made again at the same index to reach them.
 * Top-ups are kept as the record of money received.
 */
export const deleteAgent = async (owner, address) => {
  const agent = await getAgent(owner, address)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    for (const table of ['agent_messages', 'agent_sessions', 'agent_proposals', 'agent_tasks', 'agent_files', 'agent_usage', 'agent_snapshots']) {
      await connection.execute(`DELETE FROM ${table} WHERE agent_address = ?`, [agent.address])
    }
    await connection.execute('DELETE FROM hosted_agents WHERE owner_address = ? AND agent_address = ?', [owner, agent.address])
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export const setMemory = async (address, notes) => {
  if (typeof notes !== 'string' || notes.length > MEMORY_MAX) throw new AgentError(400, 'Notes are too long')
  await pool.execute('UPDATE hosted_agents SET memory = ? WHERE agent_address = ?', [notes, normalizeAddress(address)])
}

// --- Sessions ---

const SESSION_LIST_SIZE = 30
const SESSION_TITLE_MAX = 80

const toSession = (row) => ({
  id: Number(row.id),
  kind: row.kind,
  taskId: row.task_id === null ? null : Number(row.task_id),
  title: row.title,
  summary: row.summary ?? null,
  summarizedThrough: row.summarized_through === null || row.summarized_through === undefined ? null : Number(row.summarized_through),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
})

/** A new session: a chat the owner opened, or one task run. A chat's title comes from its first message. */
export const createSession = async (address, { kind = 'chat', taskId = null, title = '' } = {}) => {
  const [result] = await pool.execute('INSERT INTO agent_sessions (agent_address, kind, task_id, title) VALUES (?, ?, ?, ?)', [
    normalizeAddress(address),
    kind,
    taskId,
    String(title).slice(0, SESSION_TITLE_MAX),
  ])
  return Number(result.insertId)
}

/** One of the agent's sessions, or a 404 — a session id from another agent is never followed. */
export const getSession = async (address, id) => {
  const [[row]] = await pool.execute('SELECT * FROM agent_sessions WHERE id = ? AND agent_address = ?', [Number(id), normalizeAddress(address)])
  if (!row) throw new AgentError(404, 'Session not found')
  return toSession(row)
}

/** The agent's recent sessions, newest activity first, without their summaries. */
export const listSessions = async (address, limit = SESSION_LIST_SIZE) => {
  const [rows] = await pool.execute(
    `SELECT id, kind, task_id, title, created_at, updated_at FROM agent_sessions WHERE agent_address = ? ORDER BY updated_at DESC, id DESC LIMIT ${Number(limit)}`,
    [normalizeAddress(address)],
  )
  return rows.map(toSession)
}

/** The chat session the owner was last in, or null for none yet. */
export const latestChatSession = async (address) => {
  const [[row]] = await pool.execute("SELECT * FROM agent_sessions WHERE agent_address = ? AND kind = 'chat' ORDER BY updated_at DESC, id DESC LIMIT 1", [
    normalizeAddress(address),
  ])
  return row ? toSession(row) : null
}

/**
 * Removes one of the owner's sessions with its messages and the drafts made in it, so the agent no
 * longer counts them as waiting. Posts already published stay onchain.
 */
export const deleteSession = async (owner, address, id) => {
  const agent = await getAgent(owner, address)
  const session = await getSession(agent.address, id)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    for (const table of ['agent_messages', 'agent_proposals']) {
      await connection.execute(`DELETE FROM ${table} WHERE agent_address = ? AND session_id = ?`, [agent.address, session.id])
    }
    await connection.execute('DELETE FROM agent_sessions WHERE agent_address = ? AND id = ?', [agent.address, session.id])
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

/** Stores a recap of the session's turns up to message `throughId`, which later turns read instead of them. */
export const setSessionSummary = async (sessionId, summary, throughId) => {
  await pool.execute('UPDATE agent_sessions SET summary = ?, summarized_through = ? WHERE id = ?', [summary, Number(throughId), Number(sessionId)])
}

// --- Messages ---

const SESSION_MESSAGE_CAP = 500

/**
 * A session's messages, oldest first. `afterId` skips what a summary already covers.
 * @returns {Promise<{id: number, role: string, content: string, createdAt: string}[]>}
 */
export const readMessages = async (address, sessionId, { afterId = null } = {}) => {
  const [rows] = await pool.execute(
    `SELECT * FROM (
       SELECT id, role, content, created_at FROM agent_messages
        WHERE agent_address = ? AND session_id = ?${afterId ? ' AND id > ?' : ''}
        ORDER BY id DESC LIMIT ${SESSION_MESSAGE_CAP}
     ) recent ORDER BY id`,
    afterId ? [normalizeAddress(address), Number(sessionId), Number(afterId)] : [normalizeAddress(address), Number(sessionId)],
  )
  return rows.map((row) => ({ id: Number(row.id), role: row.role, content: row.content, createdAt: new Date(row.created_at).toISOString() }))
}

/** Adds a message to a session and marks the session active; a chat's first message names it. */
export const appendMessage = async (address, role, content, sessionId) => {
  await pool.execute('INSERT INTO agent_messages (agent_address, session_id, role, content) VALUES (?, ?, ?, ?)', [normalizeAddress(address), Number(sessionId), role, content])
  if (role === 'user') {
    const title = content.replace(/s+/g, ' ').trim().slice(0, SESSION_TITLE_MAX)
    await pool.execute("UPDATE agent_sessions SET title = IF(title = '', ?, title), updated_at = NOW() WHERE id = ?", [title, Number(sessionId)])
  } else {
    await pool.execute('UPDATE agent_sessions SET updated_at = NOW() WHERE id = ?', [Number(sessionId)])
  }
}

// --- Proposals ---

const PROPOSAL_HISTORY = 20

const toProposal = (row) => ({
  id: Number(row.id),
  kind: row.kind,
  postId: row.post_id === null ? null : String(row.post_id),
  networkId: row.network_id === null ? null : Number(row.network_id),
  text: row.text,
  originalText: row.original_text,
  allowComments: row.allow_comments === null ? null : Boolean(row.allow_comments),
  // A tip or transfer: how much of the network's coin, and to whom
  amount: row.amount ?? null,
  recipient: row.recipient ?? null,
  status: row.status,
  txHash: row.tx_hash,
  createdAt: new Date(row.created_at).toISOString(),
})

/**
 * Something the agent drafted, waiting for its owner: a new post, an edit or removal of one of its
 * own posts, a reply to, like of or tip on any post (`target` from readAgentPost or readPost), or a
 * transfer of `amount` of a network's coin to `recipient`.
 * @param {string} address The agent.
 * @param {{kind?: string, text?: string, target?: object, sessionId?: number, amount?: string, recipient?: string, networkId?: number}} draft
 */
export const addProposal = async (address, { kind = 'post', text = '', target = null, sessionId = null, amount = null, recipient = null, networkId = null }) => {
  const row = {
    kind,
    post_id: target?.id ?? null,
    network_id: target?.networkId ?? networkId,
    text,
    original_text: target?.text ?? null,
    allow_comments: target?.allowComments === undefined ? null : Number(target.allowComments),
    amount,
    recipient: recipient ?? target?.author ?? null,
  }
  const [result] = await pool.execute(
    'INSERT INTO agent_proposals (agent_address, session_id, kind, post_id, network_id, text, original_text, allow_comments, amount, recipient) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [normalizeAddress(address), sessionId, row.kind, row.post_id, row.network_id, row.text, row.original_text, row.allow_comments, row.amount, row.recipient],
  )
  return toProposal({ ...row, id: result.insertId, status: 'pending', tx_hash: null, created_at: new Date() })
}

/**
 * The agent's recent drafts, oldest first, like the conversation: one session's, or with no
 * session, all of them — what the agent checks for drafts still waiting on its owner.
 */
export const readProposals = async (address, { sessionId = null, limit = PROPOSAL_HISTORY } = {}) => {
  const [rows] = await pool.execute(
    `SELECT * FROM (
       SELECT * FROM agent_proposals WHERE agent_address = ?${sessionId ? ' AND session_id = ?' : ''} ORDER BY id DESC LIMIT ${Number(limit)}
     ) recent ORDER BY id`,
    sessionId ? [normalizeAddress(address), Number(sessionId)] : [normalizeAddress(address)],
  )
  return rows.map(toProposal)
}

const resolveSchema = z.object({
  status: z.enum(['published', 'discarded']),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  networkId: z.number().int().positive().optional(),
})

/**
 * Records what the owner did with a draft. Only a pending draft changes, so a published post can
 * never be marked discarded afterwards.
 */
export const resolveProposal = async (owner, address, id, input) => {
  const parsed = resolveSchema.safeParse(input)
  if (!parsed.success || (parsed.data.status === 'published' && !parsed.data.txHash)) throw new AgentError(400, 'Invalid change')

  const agent = await getAgent(owner, address)
  const { status, txHash = null, networkId = null } = parsed.data
  const [result] = await pool.execute(
    "UPDATE agent_proposals SET status = ?, tx_hash = ?, network_id = ? WHERE id = ? AND agent_address = ? AND status = 'pending'",
    [status, txHash, networkId, Number(id), agent.address],
  )
  if (result.affectedRows === 0) throw new AgentError(409, 'This draft was already handled')
}

// --- The agent's own posts ---

const AGENT_POSTS_MAX = 10

/** The words of a post: its text elements, joined. Agent posts are text only. */
const postText = (content) => {
  try {
    const parsed = JSON.parse(content)
    return (parsed?.elements ?? [])
      .filter((element) => element?.type === 'text')
      .map((element) => String(element.data?.text ?? ''))
      .join('\n')
      .trim()
  } catch {
    return ''
  }
}

const toAgentPost = (row) => ({
  id: String(row.id),
  networkId: Number(row.network_id),
  text: postText(row.content),
  allowComments: row.allow_comment === null ? true : Boolean(row.allow_comment),
  createdAt: new Date(row.created_at).toISOString(),
})

// Top-level posts only: a repost has no words of its own to edit, and comments are not agent work
const OWN_POST_FILTER = 'wallet_address = ? AND is_deleted = 0 AND is_repost IS NULL AND is_comment IS NULL AND content_type = 0'

/** The agent's latest posts, newest first, as the index has them. */
export const listAgentPosts = async (address, limit = AGENT_POSTS_MAX) => {
  const [rows] = await pool.execute(
    `SELECT id, network_id, content, allow_comment, created_at FROM posts WHERE ${OWN_POST_FILTER} ORDER BY created_at DESC LIMIT ${Number(limit)}`,
    [normalizeAddress(address)],
  )
  return rows.map(toAgentPost)
}

/**
 * Any live, public post or comment, for a reply, like or tip: not deleted, not in a community
 * (whose posts Hupi never reads either). `author` is the wallet that wrote it.
 * @returns {Promise<object|null>}
 */
export const readPost = async (networkId, postId) => {
  const [[row]] = await pool.execute(
    `SELECT p.id, p.network_id, p.content, p.wallet_address, p.allow_comment, p.created_at, u.name
       FROM posts p LEFT JOIN users u ON u.wallet_address = p.wallet_address
      WHERE p.network_id = ? AND p.id = ? AND p.is_deleted = 0 AND p.community_id IS NULL LIMIT 1`,
    [Number(networkId), String(postId)],
  )
  if (!row) return null
  return { ...toAgentPost(row), author: normalizeAddress(row.wallet_address), authorName: row.name || null }
}

/**
 * Who a transfer goes to: a wallet address as given, or a Hup @username looked up. Null when the
 * name is unknown, so the agent never guesses an address.
 * @returns {Promise<{address: string, name: string|null}|null>}
 */
export const resolveRecipient = async (value) => {
  const text = String(value ?? '').trim()
  if (isEvmAddress(text)) {
    const [[row]] = await pool.execute('SELECT name FROM users WHERE wallet_address = ? LIMIT 1', [normalizeAddress(text)])
    return { address: normalizeAddress(text), name: row?.name || null }
  }
  const username = text.replace(/^@/, '')
  if (!/^[A-Za-z0-9_]{1,20}$/.test(username)) return null
  const [[row]] = await pool.execute('SELECT wallet_address, name FROM users WHERE username = ? LIMIT 1', [username])
  return row ? { address: normalizeAddress(row.wallet_address), name: row.name || `@${username}` } : null
}

/** One live post of the agent's own, or null — never someone else's, never a deleted one. */
export const readAgentPost = async (address, networkId, postId) => {
  const [[row]] = await pool.execute(
    `SELECT id, network_id, content, allow_comment, created_at FROM posts WHERE ${OWN_POST_FILTER} AND network_id = ? AND id = ? LIMIT 1`,
    [normalizeAddress(address), Number(networkId), String(postId)],
  )
  return row ? toAgentPost(row) : null
}
