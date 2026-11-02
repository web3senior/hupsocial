/**
 * @file lib/agentWallet.js
 * @description Browser side of hosted agents. An agent's key is hup:agent:<n>:v2 under the owner's
 * Key Vault v2 — derived here when needed and never sent anywhere — so the owner's wallet + passphrase
 * bring every agent back on any device.
 *
 * What runs here: registering an agent (its proof of ownership and its Hup profile, both signed
 * by the agent itself), and carrying out a draft the owner approved — a new post, or an edit or
 * removal of one of the agent's posts — through the gasless relay with the agent as the signer.
 */

import { ethers } from 'ethers'
import { getAccount, getPublicClient } from 'wagmi/actions'
import { config, CONTRACTS } from '@/config/wagmi'
import hupAbi from '@/abi/post.json'
import { ContentType } from './content'
import { uploadFileToIPFS, uploadObjectToIPFS, withAuthor } from './ipfs'
import { hexToBytes } from '@noble/hashes/utils.js'
import { deriveChildV2, KEY_LABELS } from './keyDerivationV2.mjs'
import { deriveKeyFromMasterV2, ensureMasterV2, rejectMasterV2 } from './keyVaultV2'
import { AGENT_LIMIT, AGENT_POST_MAX, agentKeyMessage, agentOwnershipMessage } from './hostedAgentMessages'
import { profileUpdateMessage } from './profileSignature'
import { isGaslessEnabled, relayHupAction } from './relayGasless'
import { agentBillingAddress, TOP_UP_CHAIN_ID } from '@/config/agentModels'
import { botAvatarPng, resolveBotTraits } from './botAvatar'
import { erc8004For, identityRegistryAbi, REGISTRATION_TYPE } from './erc8004'
import { encodeFunctionData } from 'viem'
import { lukso } from 'wagmi/chains'
import { grantAgentController, hupCallPayload, readAgentController, rotateAgentController, signRelayCall, upExecuteAbi } from './lsp6'
import { createAgentKey, forgetAgentKey, parseAgentKey, readAgentKey, saveAgentKey } from './agentKeys'

// The connected wallet — a Universal Profile agent's key is stored under its owner
const getConnectedOwner = () => getAccount(config)?.address ?? null

const authHeaders = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` })

const readJson = async (response, fallback) => {
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.success === false) throw Object.assign(new Error(data.error || fallback), { status: response.status })
  return data
}

/**
 * The agent at `index` as an ethers wallet, opening Key Vault v2 if it is locked.
 *
 * With `expected` (the agent's registered address) a mismatch means the vault opened with a
 * different passphrase than the one the agent was made with — typed the same wrong way twice on a
 * new device. The master is dropped so the next try asks again, instead of signing as a stranger.
 */
export const agentWalletAt = async (index, reason = 'Using your agent', expected = null) => {
  const masterHex = await ensureMasterV2({ reason })
  const wallet = new ethers.Wallet(deriveKeyFromMasterV2(masterHex, KEY_LABELS.agent(index)))
  if (expected && wallet.address.toLowerCase() !== expected.toLowerCase()) {
    rejectMasterV2()
    throw Object.assign(new Error('That passphrase is not the one this agent was made with. Try again.'), { code: 'WRONG_PASSPHRASE' })
  }
  return wallet
}

// --- Imported wallets ---

const IMPORT_SEAL_VERSION = 'v1'

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes))
const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0))

const importKeyCipher = async (masterHex) =>
  crypto.subtle.importKey('raw', deriveChildV2(hexToBytes(masterHex), KEY_LABELS.importedAgentKeys), 'AES-GCM', false, ['encrypt', 'decrypt'])

// Bound to the agent's address, so a stored key cannot be swapped onto another agent's row
const boundTo = (address) => new TextEncoder().encode(address.toLowerCase())

/** An imported private key, encrypted under the owner's Key Vault, as "v1.<iv>.<ciphertext>". */
const sealImportedKey = async (masterHex, address, privateKey) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: boundTo(address) }, await importKeyCipher(masterHex), new TextEncoder().encode(privateKey))
  return `${IMPORT_SEAL_VERSION}.${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`
}

const openImportedKey = async (masterHex, address, sealed) => {
  const [version, iv, ciphertext] = String(sealed).split('.')
  if (version !== IMPORT_SEAL_VERSION || !iv || !ciphertext) throw new Error('This agent’s stored key is not readable')
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: boundTo(address) }, await importKeyCipher(masterHex), fromBase64(ciphertext))
    return new TextDecoder().decode(plain)
  } catch {
    rejectMasterV2()
    throw Object.assign(new Error('That passphrase is not the one this agent was imported with. Try again.'), { code: 'WRONG_PASSPHRASE' })
  }
}

/**
 * Any agent's wallet: derived from the Key Vault, or — for one made from an existing wallet — its
 * stored key, decrypted with the Key Vault. Either way the vault opens if locked, and the result is
 * checked against the agent's registered address before anything is signed.
 */
export const walletForAgent = async (agent, reason = 'Using your agent') => {
  // A Universal Profile agent's key is in this browser or nowhere: no vault, no passphrase
  if (agent.kind === 'controller') {
    const wallet = await readAgentKey(agent.owner ?? getConnectedOwner(), agent.controllerAddress)
    if (!wallet) {
      throw Object.assign(new Error(`${agent.name}’s key is on another device or browser. Restore it here from its card.`), { code: 'AGENT_KEY_ELSEWHERE' })
    }
    return wallet
  }
  if (!agent.keyCiphertext) return agentWalletAt(agent.index, reason, agent.address)
  const masterHex = await ensureMasterV2({ reason })
  const wallet = new ethers.Wallet(await openImportedKey(masterHex, agent.address, agent.keyCiphertext))
  if (wallet.address.toLowerCase() !== agent.address.toLowerCase()) throw new Error('This agent’s stored key belongs to a different wallet')
  return wallet
}

/**
 * Creates a Universal Profile agent: a fresh key in this browser, registered with Hup by its own
 * signature, then made a controller of the owner's profile (lib/lsp6.js). No vault, no profile of
 * its own. The grant is a separate transaction from the profile — if it is declined the agent
 * exists without permissions, and its card offers the grant again.
 *
 * With `privateKey`, an existing controller is brought in instead of a fresh key — but only one
 * the profile already limits to AGENT_PERMISSIONS (or has not granted at all). A wider key (the
 * extension's own controller, say) is refused before it is stored: this browser keeps agent keys
 * without a passphrase. The grant still runs, pinning AllowedCalls to Hup's `create`.
 * @returns {Promise<{agent: object, granted: boolean, grantError: Error|null}>}
 */
export const createControllerAgent = async ({ token, owner, index, name, persona, privateKey = null }) => {
  let wallet
  if (privateKey) {
    const imported = parseAgentKey(privateKey)
    const control = await readAgentController(owner, imported.address)
    if (control.isOverPermitted) {
      throw new Error(`${imported.address} can do more than post on your Universal Profile, so Hup will not hold it. Create a new agent instead, or narrow its permissions in your Universal Profile extension first.`)
    }
    wallet = await saveAgentKey(owner, imported)
  } else {
    wallet = await createAgentKey(owner)
  }
  const proof = await wallet.signMessage(agentOwnershipMessage({ agent: wallet.address, owner, index }))

  const { agent } = await readJson(
    await fetch('/api/v1/agents/hosted', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ address: wallet.address, index, name, persona, proof, kind: 'controller' }),
    }),
    'Your agent could not be created',
  )

  try {
    await grantAgentController({ profile: owner, agent: wallet.address })
    return { agent, granted: true, grantError: null }
  } catch (grantError) {
    return { agent, granted: false, grantError }
  }
}

/**
 * Brings a Universal Profile agent back on a device that does not hold its key: a new key here,
 * swapped in for the old one on the profile in one transaction, then recorded with Hup. The agent
 * keeps its id, chats, tasks and credits. LYX left on the old key stays with that key.
 * @returns {Promise<object>} The agent, now pointing at the new key.
 */
export const restoreControllerAgent = async ({ token, owner, agent }) => {
  const wallet = await createAgentKey(owner)
  // The profile first: it is the step most likely to be declined, and until it lands Hup keeps the old key
  await rotateAgentController({ profile: owner, from: agent.controllerAddress, to: wallet.address })

  const proof = await wallet.signMessage(agentKeyMessage({ agent: agent.address, owner, key: wallet.address }))
  const { agent: updated } = await readJson(
    await fetch(`/api/v1/agents/hosted/${agent.address}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ controllerKey: wallet.address, proof }),
    }),
    'Your profile now uses the new key, but Hup did not record it. Try restoring again.',
  )
  forgetAgentKey(owner, agent.controllerAddress)
  return updated
}

/** The agent's private key, for the owner to take its wallet elsewhere. Opens the vault. */
export const exportAgentKey = async (agent) => (await walletForAgent(agent, 'Exporting your agent’s key')).privateKey

/** The lowest agent index the owner has not used yet, or null at the limit. */
export const nextAgentIndex = (agents) => {
  const used = new Set(agents.map((agent) => agent.index))
  for (let index = 0; index < AGENT_LIMIT; index += 1) if (!used.has(index)) return index
  return null
}

// --- API ---

export const fetchAgents = async (token) => (await readJson(await fetch('/api/v1/agents/hosted', { headers: authHeaders(token) }), 'Your agents could not be loaded')).agents

/** The agent, one chat session (the latest chat unless `sessionId` names another) and its recent sessions. */
export const fetchAgent = async (token, address, sessionId = null) =>
  readJson(
    await fetch(`/api/v1/agents/hosted/${address}${sessionId ? `?session=${sessionId}` : ''}`, { headers: authHeaders(token) }),
    'This agent could not be loaded',
  )

/** Deletes one chat or task-run session, with its messages and drafts. */
export const deleteAgentSession = async (token, address, id) =>
  readJson(await fetch(`/api/v1/agents/hosted/${address}/sessions/${id}`, { method: 'DELETE', headers: authHeaders(token) }), 'The chat could not be deleted')

export const updateAgent = async (token, address, changes) =>
  (await readJson(await fetch(`/api/v1/agents/hosted/${address}`, { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(changes) }), 'The change was not saved')).agent

/**
 * Records the owner's decision on a draft: `{ status: 'discarded' }`, or `{ status: 'published',
 * txHash, networkId }` once the post is sent.
 */
export const resolveAgentProposal = async (token, address, id, decision) =>
  readJson(
    await fetch(`/api/v1/agents/hosted/${address}/proposals/${id}`, { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(decision) }),
    'The draft could not be updated',
  )

// --- Tasks ---

const tasksUrl = (address, id = '') => `/api/v1/agents/hosted/${address}/tasks${id === '' ? '' : `/${id}`}`

export const fetchTasks = async (token, address) => (await readJson(await fetch(tasksUrl(address), { headers: authHeaders(token) }), 'Tasks could not be loaded')).tasks

export const createAgentTask = async (token, address, task) =>
  (await readJson(await fetch(tasksUrl(address), { method: 'POST', headers: authHeaders(token), body: JSON.stringify(task) }), 'The task was not saved')).task

export const updateAgentTask = async (token, address, id, changes) =>
  (await readJson(await fetch(tasksUrl(address, id), { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(changes) }), 'The task was not saved')).task

export const deleteAgentTask = async (token, address, id) =>
  readJson(await fetch(tasksUrl(address, id), { method: 'DELETE', headers: authHeaders(token) }), 'The task was not deleted')

/** One run now. Resolves once it finished; its reply and drafts are then in the agent's chat. */
export const runAgentTask = async (token, address, id) =>
  readJson(await fetch(`${tasksUrl(address, id)}/run`, { method: 'POST', headers: authHeaders(token) }), 'The task could not run')

// --- Workspace ---

const workspaceUrl = (address, suffix = '') => `/api/v1/agents/hosted/${address}/workspace${suffix}`

/** Every workspace file and the snapshot history. */
export const fetchWorkspace = async (token, address) => readJson(await fetch(workspaceUrl(address), { headers: authHeaders(token) }), 'The workspace could not be loaded')

export const writeWorkspaceFile = async (token, address, path, content) =>
  readJson(await fetch(workspaceUrl(address), { method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ path, content }) }), 'The file was not saved')

export const deleteWorkspaceSkill = async (token, address, path) =>
  readJson(await fetch(workspaceUrl(address, `?path=${encodeURIComponent(path)}`), { method: 'DELETE', headers: authHeaders(token) }), 'The skill was not removed')

export const restoreWorkspaceFiles = async (token, address, files) =>
  readJson(await fetch(workspaceUrl(address, '/restore'), { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ files }) }), 'The workspace was not restored')

export const recordWorkspaceSnapshot = async (token, address, snapshot) =>
  readJson(await fetch(workspaceUrl(address, '/snapshots'), { method: 'POST', headers: authHeaders(token), body: JSON.stringify(snapshot) }), 'The snapshot was not noted')

// --- Credits ---

export const fetchCredits = async (token, address) =>
  readJson(await fetch(`/api/v1/agents/hosted/${address}/credits`, { headers: authHeaders(token) }), 'Credits could not be loaded')

/**
 * Tops up the agent's credits from its own wallet: the agent's key, derived here, sends `amount`
 * LYX on LUKSO to Hup's billing address, and the server credits the confirmed transfer at the USD
 * price of the moment. Crediting is retried briefly, since a node can answer the receipt late.
 * @returns {Promise<{credits: number, balance: number}>}
 */
export const topUpAgent = async ({ token, agent, amount }) => {
  const billing = agentBillingAddress()
  if (!billing) throw new Error('Top-ups are not set up on this deployment')
  const chain = chainById(TOP_UP_CHAIN_ID)
  if (!chain) throw new Error('LUKSO is not available in this app')

  let value
  try {
    value = ethers.parseEther(String(amount))
  } catch {
    throw new Error('Enter an amount of LYX')
  }
  if (value <= 0n) throw new Error('Enter an amount of LYX')

  const wallet = await walletForAgent(agent, 'Topping up your agent’s credits')
  const provider = new ethers.JsonRpcProvider(chain.rpcUrls.default.http[0], chain.id, { staticNetwork: true })
  let tx
  try {
    tx = await wallet.connect(provider).sendTransaction({ to: billing, value })
  } catch (error) {
    if (/insufficient funds/i.test(error?.shortMessage || error?.message || '')) {
      throw new Error(`Your agent's wallet does not hold enough LYX for that, plus gas. Send LYX to it first.`)
    }
    throw error
  }
  await tx.wait()

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readJson(
        await fetch(`/api/v1/agents/hosted/${agent.address}/credits`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ txHash: tx.hash }) }),
        'The top-up could not be credited',
      )
    } catch (error) {
      // Not seen by the server's node yet: wait a moment. Anything else, or a third miss, is final —
      // the transfer is onchain and can be credited later from its hash.
      if (error.status !== 404 || attempt >= 2) throw Object.assign(error, { txHash: tx.hash })
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }
}

// --- Profile ---

const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const PICTURE_MAX_BYTES = 5 * 1024 * 1024

/**
 * An agent's robot (lib/botAvatar.js) as a PNG file — the look its owner picked, or the one its
 * address picks. PNG because profile pictures are moderated, and that reads raster images.
 */
const robotPictureFile = async (agentAddress, traits = null) =>
  new File([await botAvatarPng(resolveBotTraits(agentAddress, traits))], 'agent.png', { type: 'image/png' })

/**
 * Gives the agent its Hup profile: a name, its owner's description of it, the `ai-agent` tag
 * lib/agentProfile.js turns into the AI Agent chip, and — when `picture` is given — a new profile
 * picture. Without one the stored picture stays as it is. Signed by the agent, through the same
 * challenge-and-burn every profile save uses.
 * @param {{name: string, description: string, picture?: File}} profile
 */
const writeAgentProfile = async (wallet, { name, description, picture }) => {
  const address = wallet.address
  await fetch(`/api/v1/users/profile/${address}`, { method: 'POST' })

  const profileImage = picture ? await uploadFileToIPFS(picture, { address }) : ''

  const { nonce } = await readJson(
    await fetch('/api/v1/auth/nonce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet_address: address }) }),
    'Could not start the profile save',
  )
  const issuedAt = Date.now()
  const form = new FormData()
  form.set('name', name)
  form.set('description', description)
  form.set('tags', JSON.stringify(['ai-agent']))
  // Empty keeps the stored picture: the profile API never clears one on an empty field
  form.set('profileImage', profileImage)
  form.set('nonce', nonce)
  form.set('issuedAt', String(issuedAt))
  form.set('signature', await wallet.signMessage(profileUpdateMessage({ address, nonce, issuedAt })))

  await readJson(await fetch(`/api/v1/users/profile/${address}`, { method: 'PUT', body: form }), 'The agent’s profile was not saved')
}

/** A profile description: the persona's first line, which owners tend to write as a summary. */
const describe = (persona) => {
  const first = persona.split('\n').find((line) => line.trim()) ?? ''
  return first.length > 160 ? `${first.slice(0, 157)}…` : first
}

/**
 * Creates an agent: derives its wallet, registers it with a proof only the owner's vault could
 * make, then writes its profile.
 * @returns {Promise<object>} The stored agent.
 */
export const createHostedAgent = async ({ token, owner, index, name, persona, privateKey = null }) => {
  let wallet
  let keyCiphertext
  if (privateKey) {
    // An existing wallet: its key cannot be derived, so it is stored encrypted under the Key Vault
    try {
      wallet = new ethers.Wallet(privateKey.trim().startsWith('0x') ? privateKey.trim() : `0x${privateKey.trim()}`)
    } catch {
      throw new Error('That is not a valid private key')
    }
    const masterHex = await ensureMasterV2({ reason: 'Importing a wallet as your agent' })
    keyCiphertext = await sealImportedKey(masterHex, wallet.address, wallet.privateKey)
  } else {
    wallet = await agentWalletAt(index, 'Creating your agent')
  }
  const proof = await wallet.signMessage(agentOwnershipMessage({ agent: wallet.address, owner, index }))

  const { agent } = await readJson(
    await fetch('/api/v1/agents/hosted', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ address: wallet.address, index, name, persona, proof, keyCiphertext }),
    }),
    'Your agent could not be created',
  )

  // An imported wallet keeps the picture it already has; a new one starts as its own robot
  await writeAgentProfile(wallet, { name, description: describe(persona), picture: privateKey ? undefined : await robotPictureFile(wallet.address) })
  return agent
}

/** Removes the agent from Hup (see lib/hostedAgents.js deleteAgent). Its wallet and posts stay onchain. */
export const deleteHostedAgent = async (token, address) =>
  readJson(await fetch(`/api/v1/agents/hosted/${address}`, { method: 'DELETE', headers: authHeaders(token) }), 'The agent was not removed')

// --- ERC-8004 identity ---

/** Networks where the ERC-8004 Identity Registry is deployed (checked onchain) and this app knows. */
const IDENTITY_CHAIN_IDS = [42, 8453, 143, 56, 42161, 42220]
export const identityChains = () => IDENTITY_CHAIN_IDS.map(chainById).filter(Boolean)

/** The ERC-8004 identities Hup has verified for the agent's wallet, one per network. */
export const fetchAgentIdentities = async (address) => {
  const response = await fetch(`/api/v1/agents/identity?wallet=${encodeURIComponent(address)}`)
  const body = await response.json().catch(() => ({}))
  return response.ok && body.success ? body.data : []
}

const linkIdentity = async (address, chainId, agentId) =>
  (
    await readJson(
      await fetch('/api/v1/agents/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, networkId: chainId, agentId: String(agentId) }),
      }),
      'The identity could not be linked',
    )
  ).data

/**
 * Mints the agent an ERC-8004 identity on one network, owned by its own wallet, which signs and
 * pays the gas. The registration file is the one Hup's MCP tool writes — the agent's name, bio,
 * picture, its Hup profile and Hup's MCP endpoint — so tasks it is paid for rate this identity.
 * @returns {Promise<object>} The linked identity, as the chip shows it.
 */
export const registerAgentIdentity = async ({ agent, chainId }) => {
  const chain = chainById(chainId)
  if (!chain || !IDENTITY_CHAIN_IDS.includes(chain.id)) throw new Error('ERC-8004 is not available on that network')

  const origin = window.location.origin
  const registration = {
    type: REGISTRATION_TYPE,
    name: agent.name,
    description: describe(agent.persona),
    image: agent.picture || '',
    services: [
      { name: 'web', endpoint: `${origin}/${agent.address}` },
      { name: 'MCP', endpoint: `${origin}/api/mcp`, version: '2025-06-18' },
    ],
    x402Support: false,
    active: !agent.paused,
    supportedTrust: ['reputation'],
  }
  const cid = await uploadObjectToIPFS(registration)
  const agentURI = String(cid).startsWith('ipfs://') ? cid : `ipfs://${cid}`

  const wallet = (await walletForAgent(agent, 'Registering your agent on ERC-8004')).connect(
    new ethers.JsonRpcProvider(chain.rpcUrls.default.http[0], chain.id, { staticNetwork: true }),
  )
  const registry = new ethers.Contract(erc8004For(chain.id).identity, identityRegistryAbi, wallet)
  let receipt
  try {
    receipt = await (await registry.register(agentURI)).wait()
  } catch (error) {
    if (/insufficient funds/i.test(error?.shortMessage || error?.message || '')) {
      const symbol = chain.nativeCurrency?.symbol ?? 'coin'
      throw new Error(`${agent.name}'s wallet needs a little ${symbol} on ${chain.name} for gas. Send some to it there first.`)
    }
    throw error
  }

  const registered = receipt.logs.map((log) => registry.interface.parseLog(log)).find((parsed) => parsed?.name === 'Registered')
  if (!registered) throw new Error('The identity was minted, but its id could not be read. Link it by its id.')
  return linkIdentity(agent.address, chain.id, registered.args.agentId)
}

/** Links an ERC-8004 id the agent's wallet already owns, operates or receives for; Hup checks it onchain. */
export const linkAgentIdentity = async ({ agent, chainId, agentId }) => {
  if (!/^\d{1,78}$/.test(String(agentId).trim())) throw new Error('Enter the agent id, a number')
  return linkIdentity(agent.address, Number(chainId), String(agentId).trim())
}

// --- Withdraw ---

/**
 * Sends coins out of the agent's wallet on one network, signed by its key here. `amount` is in the
 * network's coin, or 'max' for everything minus a gas reserve.
 * @returns {Promise<{txHash: string, value: bigint}>}
 */
export const withdrawFromAgent = async ({ agent, chainId, to, amount }) => {
  if (!ethers.isAddress(to)) throw new Error('Enter a valid address to send to')
  const chain = chainById(chainId)
  if (!chain) throw new Error('That network is not available in this app')

  const wallet = (await walletForAgent(agent, 'Withdrawing from your agent')).connect(
    new ethers.JsonRpcProvider(chain.rpcUrls.default.http[0], chain.id, { staticNetwork: true }),
  )
  const [balance, fees] = await Promise.all([wallet.provider.getBalance(wallet.address), wallet.provider.getFeeData()])
  const gasPrice = fees.maxFeePerGas ?? fees.gasPrice ?? 0n
  // A plain transfer costs 21,000 gas; doubled so a fee rise between reading and sending still fits
  const reserve = 21000n * gasPrice * 2n

  let value
  if (amount === 'max') {
    value = balance - reserve
  } else {
    try {
      value = ethers.parseEther(String(amount))
    } catch {
      throw new Error('Enter an amount')
    }
  }
  const symbol = chain.nativeCurrency?.symbol ?? 'coin'
  if (value <= 0n) throw new Error(`Not enough ${symbol} on ${chain.name} to cover gas`)
  if (value + reserve > balance) throw new Error(`${agent.name} holds ${ethers.formatEther(balance)} ${symbol} on ${chain.name}, which does not cover that plus gas`)

  const tx = await wallet.sendTransaction({ to, value, gasLimit: 21000n })
  await tx.wait()
  return { txHash: tx.hash, value }
}

/**
 * Replaces the agent's profile picture with an image the owner picked. The agent's own key signs
 * the profile save, so its vault opens if it is locked.
 * @param {object} agent
 * @param {File} file PNG, JPEG, GIF or WebP, at most 5 MB.
 */
export const changeAgentPicture = async (agent, file) => {
  if (!file || !PICTURE_TYPES.includes(file.type)) throw new Error('Pick a PNG, JPEG, GIF or WebP image')
  if (file.size > PICTURE_MAX_BYTES) throw new Error('Pick an image under 5 MB')
  const wallet = await walletForAgent(agent, 'Changing your agent’s picture')
  await writeAgentProfile(wallet, { name: agent.name, description: describe(agent.persona), picture: file })
}

/**
 * Saves the robot look the owner picked and makes it the agent's profile picture. The look is
 * stored first, so a cancelled profile signature still keeps it on the card.
 * @returns {Promise<object>} The updated agent.
 */
export const saveAgentLook = async (token, agent, traits) => {
  const updated = await updateAgent(token, agent.address, { avatar: traits })
  // A Universal Profile agent has no profile of its own: the look is only how Hup draws it
  if (agent.kind !== 'controller') await changeAgentPicture(agent, await robotPictureFile(agent.address, traits))
  return updated
}

// --- Chat ---

/**
 * One chat turn, read as it streams (see api/v1/agents/hosted/[address]/chat).
 * @param {{onDelta: Function, onStatus: Function, onProposal: Function}} handlers
 */
export const streamAgentChat = async (token, address, message, { sessionId = null, onSession = () => {}, onDelta, onStatus, onProposal }) => {
  const response = await fetch(`/api/v1/agents/hosted/${address}/chat`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ message, sessionId }) })
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}))
    throw Object.assign(new Error(data?.error || 'Your agent could not answer right now'), { status: response.status })
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let finished = false

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += value
    const lines = buffer.split('\n')
    // The last piece may be half a line; it waits for the next chunk
    buffer = lines.pop()

    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line)
      if (event.type === 'delta') onDelta(event.text)
      else if (event.type === 'status') onStatus(event.text)
      else if (event.type === 'proposal') onProposal(event.proposal)
      else if (event.type === 'session') onSession(event.id)
      else if (event.type === 'done') finished = true
      else if (event.type === 'error') throw new Error(event.error)
    }
  }

  if (!finished) throw new Error('The answer was cut off, try again')
}

// --- Publishing ---

const chainById = (networkId) => config.chains.find((chain) => chain.id === Number(networkId)) ?? null

/**
 * Sends one Hup call as the agent: through the gasless relay, signed by the agent's key, and
 * where the relay cannot serve it, paid from the agent's own balance on that chain.
 * @returns {Promise<string>} The transaction hash.
 */
const sendAgentAction = async ({ wallet, chain, functionName, args, verb }) => {
  const contracts = CONTRACTS[`chain${chain.id}`]
  if (!contracts?.hup) throw new Error(`Hup is not deployed on ${chain.name}`)
  const publicClient = getPublicClient(config, { chainId: chain.id })

  // Why the free path was skipped, so a failed fallback can say so instead of only "no balance"
  let relayReason = isGaslessEnabled(chain.id) ? '' : 'it is turned off for you on this network'
  if (!relayReason) {
    try {
      return await relayHupAction({ chain, publicClient, owner: wallet.address, functionName, args, localSigner: wallet })
    } catch (error) {
      // Already sent: paying again would do it twice
      if (error.code === 'RELAY_SUBMITTED' && error.txHash) return error.txHash
      if (error.code === 'RELAY_COOLDOWN') throw error
      relayReason = error.message
      console.warn(`Gasless agent ${functionName} unavailable:`, error.message)
    }
  }

  const provider = new ethers.JsonRpcProvider(chain.rpcUrls.default.http[0], chain.id, { staticNetwork: true })
  const contract = new ethers.Contract(contracts.hup, hupAbi, wallet.connect(provider))
  try {
    const tx = await contract[functionName](...args)
    await tx.wait()
    return tx.hash
  } catch (error) {
    if (/insufficient funds/i.test(error?.shortMessage || error?.message || '')) {
      throw new Error(`Free ${verb} failed (${relayReason}), and your agent has no ${chain.nativeCurrency?.symbol ?? 'balance'} on ${chain.name} to pay gas.`)
    }
    throw error
  }
}

/**
 * An agent post's content: its text, moderated, pinned with the agent as author and an `agent`
 * label in the metadata — every agent post says so itself, not only its profile.
 * @returns {Promise<string>} The metadata URI.
 */
const pinAgentContent = async (wallet, text, author = wallet.address) => {
  const body = String(text ?? '').trim()
  if (!body || body.length > AGENT_POST_MAX) throw new Error(`A post needs text of at most ${AGENT_POST_MAX} characters`)

  const content = {
    version: '1',
    elements: [
      { type: 'text', data: { text: body } },
      { type: 'media', data: { items: [] } },
    ],
    // Posting as its owner's profile, the post still names the agent that wrote it
    agent: author === wallet.address ? { kind: 'ai-agent' } : { kind: 'ai-agent', address: wallet.address },
  }

  const verdict = await fetch('/api/moderation/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) })
    .then((response) => response.json())
    .catch(() => ({}))
  if (verdict?.blocked) throw new Error('This content can’t be published on Hup.')

  return uploadObjectToIPFS(withAuthor(content, author))
}

/**
 * A new post made by the agent as its owner's Universal Profile, through the profile's Key
 * Manager (lib/lsp6.js). Relayed when gasless is on; otherwise the agent sends UP.execute itself
 * and pays the LYX, which the Key Manager checks through LSP20.
 */
const postAsProfile = async ({ wallet, profile, canRelay, metadata }) => {
  const data = encodeFunctionData({ abi: hupAbi, functionName: 'create', args: [profile, ContentType.Post, metadata, 0n, true] })
  const payload = hupCallPayload(data)

  let relayReason = isGaslessEnabled(lukso.id) ? '' : 'it is turned off for you on this network'
  if (!relayReason && !canRelay) relayReason = 'the agent is not allowed relay calls on your profile'
  if (!relayReason) {
    const { nonce, validityTimestamps, signature } = await signRelayCall({ wallet, profile, payload })
    const response = await fetch('/api/v1/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'lsp25', chainId: lukso.id, profile, signature, payload, nonce: nonce.toString(), validityTimestamps: validityTimestamps.toString() }),
    })
    const result = await response.json().catch(() => ({}))
    if (response.ok && result.txHash) return result.txHash
    if (response.status === 429) throw Object.assign(new Error(result.error), { code: 'RELAY_COOLDOWN' })
    relayReason = result.error || 'the relayer did not answer'
    console.warn('Gasless profile post unavailable:', relayReason)
  }

  const provider = new ethers.JsonRpcProvider(lukso.rpcUrls.default.http[0], lukso.id, { staticNetwork: true })
  const account = new ethers.Contract(profile, upExecuteAbi, wallet.connect(provider))
  try {
    const tx = await account.execute(0n, CONTRACTS[`chain${lukso.id}`].hup, 0n, data)
    await tx.wait()
    return tx.hash
  } catch (error) {
    if (/insufficient funds/i.test(error?.shortMessage || error?.message || '')) {
      throw new Error(`Free posting failed (${relayReason}), and your agent has no LYX to pay gas.`)
    }
    throw error
  }
}

/**
 * Carries out a draft the owner approved: a new post on `chain`, or an edit or removal of the
 * agent's post on the network that post lives on. The agent's key signs, here, after the derived
 * address is checked against the agent's registered one.
 *
 * A Universal Profile agent's post goes out as the profile on LUKSO, signed by its key in this
 * browser; it makes no edits or removals.
 *
 * @param {{agent: {index: number, address: string}, proposal: object, chain: object, owner?: string}} params
 *   `chain` is where a new post goes; edits and removals use the post's own network. `owner` is
 *   the connected wallet, checked for a Universal Profile the agent controls.
 * @returns {Promise<{txHash: string, networkId: number}>}
 */
export const carryOutProposal = async ({ agent, proposal, chain, owner = null }) => {
  /* A Universal Profile agent acts only as the profile, which lives on LUKSO, and it is allowed
     nothing but new posts there. Its grant is read fresh, so a revoked agent fails here, not onchain. */
  const isController = agent.kind === 'controller'
  if (isController && proposal.kind !== 'post') throw new Error(`${agent.name} can only make new posts as your Universal Profile`)
  if (isController && !owner) throw new Error('Connect your Universal Profile to post as it')
  const grant = isController ? await readAgentController(owner, agent.controllerAddress) : null
  if (isController && !grant.isController) throw new Error(`${agent.name} is not a controller of your Universal Profile. Add it from its card.`)

  const target = isController ? chainById(lukso.id) : proposal.kind === 'post' ? chain : chainById(proposal.networkId)
  if (!target) throw new Error('This post lives on a network this app does not support')

  const reason = { post: 'Posting as your agent', edit: 'Editing your agent’s post', delete: 'Removing your agent’s post' }[proposal.kind]
  const wallet = await walletForAgent(agent, reason)

  let txHash
  if (isController) {
    const metadata = await pinAgentContent(wallet, proposal.text, owner)
    txHash = await postAsProfile({ wallet, profile: owner, canRelay: grant.canRelay, metadata })
  } else if (proposal.kind === 'post') {
    const metadata = await pinAgentContent(wallet, proposal.text)
    txHash = await sendAgentAction({ wallet, chain: target, functionName: 'create', args: [wallet.address, ContentType.Post, metadata, 0n, true], verb: 'posting' })
  } else if (proposal.kind === 'edit') {
    const metadata = await pinAgentContent(wallet, proposal.text)
    const args = [wallet.address, BigInt(proposal.postId), metadata, proposal.allowComments ?? true]
    txHash = await sendAgentAction({ wallet, chain: target, functionName: 'update', args, verb: 'editing' })
  } else {
    txHash = await sendAgentAction({ wallet, chain: target, functionName: 'deleteContent', args: [wallet.address, BigInt(proposal.postId)], verb: 'removal' })
  }

  return { txHash, networkId: target.id }
}
