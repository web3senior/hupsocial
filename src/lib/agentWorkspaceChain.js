/**
 * @file lib/agentWorkspaceChain.js
 * @description Saving a hosted agent's workspace onchain, and restoring it. Browser-only.
 *
 * A snapshot is the whole workspace (lib/agentWorkspaceFiles.js) as one JSON document, encrypted
 * here with AES-256-GCM under a key derived from the owner's Key Vault (hup:agent:<n>:workspace:v2)
 * and bound to the agent's address. It is written through ChainKeep, on whichever network the owner
 * picks, by the agent's own wallet, which owns the file and pays in that network's coin. Only the owner's wallet and passphrase can decrypt
 * it, on any device; ChainKeep and Hup only ever see ciphertext.
 */

import { ethers } from 'ethers'
import { hexToBytes } from '@noble/hashes/utils.js'
import { readStored, storeWithNative } from 'chainkeep'
import { config } from '@/config/wagmi'
import { deriveChildV2, KEY_LABELS } from './keyDerivationV2.mjs'
import { ensureMasterV2 } from './keyVaultV2'
import { walletForAgent } from './agentWallet'
import { WORKSPACE_FORMAT, WORKSPACE_VERSION } from './agentWorkspaceFiles'

/** The network a snapshot goes to unless the owner picks another: LUKSO, where agents already hold LYX. */
export const WORKSPACE_CHAIN_ID = 42

// "HUPW", then a version byte: lets a reader refuse anything that is not one of these snapshots
const MAGIC = [0x48, 0x55, 0x50, 0x57]
const SEAL_VERSION = 1
const IV_BYTES = 12

const chainkeepBase = () => `${window.location.origin}/api/v1/chainkeep`

const chainFor = (chainId) => {
  const chain = config.chains.find((item) => item.id === Number(chainId))
  if (!chain) throw new Error('That network is not available in this app')
  return chain
}

const providerFor = (chainId) => {
  const chain = chainFor(chainId)
  return new ethers.JsonRpcProvider(chain.rpcUrls.default.http[0], chain.id, { staticNetwork: true })
}

/**
 * The networks a snapshot can go to: those ChainKeep stores on that this app also knows, LUKSO first.
 * @returns {Promise<{id: number, name: string, symbol: string}[]>}
 */
// Asked once per page: the list changes almost never, and every Files tab opened after reuses it
let storageChainsRequest = null

export const storageChains = () => {
  storageChainsRequest ??= loadStorageChains().catch((error) => {
    // A failure is not remembered, so the next tab opened asks again
    storageChainsRequest = null
    throw error
  })
  return storageChainsRequest
}

const loadStorageChains = async () => {
  const response = await fetch(`${chainkeepBase()}/api/v1/uploads/config`)
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.enabled) throw new Error('ChainKeep is not taking uploads right now')
  return (body.chains ?? [])
    .map(({ chainId }) => config.chains.find((chain) => chain.id === chainId))
    .filter(Boolean)
    .map((chain) => ({ id: chain.id, name: chain.name, symbol: chain.nativeCurrency?.symbol ?? '' }))
    .sort((left, right) => (left.id === WORKSPACE_CHAIN_ID ? -1 : right.id === WORKSPACE_CHAIN_ID ? 1 : 0))
}

const workspaceKey = async (agent) => {
  const masterHex = await ensureMasterV2({ reason: 'Encrypting your agent’s workspace' })
  const raw = deriveChildV2(hexToBytes(masterHex), KEY_LABELS.agentWorkspace(agent.index))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// The agent's address as additional data: a snapshot cannot be passed off as another agent's
const boundTo = (agent) => new TextEncoder().encode(agent.address.toLowerCase())

/** The workspace as encrypted bytes, ready to store. */
export const sealWorkspace = async (agent, files) => {
  const document = { format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, agent: agent.address.toLowerCase(), savedAt: new Date().toISOString(), files }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: boundTo(agent) },
    await workspaceKey(agent),
    new TextEncoder().encode(JSON.stringify(document)),
  )
  return new Uint8Array([...MAGIC, SEAL_VERSION, ...iv, ...new Uint8Array(ciphertext)])
}

/** A snapshot's files, decrypted. */
export const openWorkspace = async (agent, bytes) => {
  const header = MAGIC.length + 1
  if (bytes.length <= header + IV_BYTES || MAGIC.some((byte, index) => bytes[index] !== byte) || bytes[MAGIC.length] !== SEAL_VERSION) {
    throw new Error('That file is not one of this agent’s workspace snapshots')
  }
  let plain
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(header, header + IV_BYTES), additionalData: boundTo(agent) },
      await workspaceKey(agent),
      bytes.slice(header + IV_BYTES),
    )
  } catch {
    throw new Error('This snapshot cannot be opened with your current Key Vault passphrase')
  }
  const document = JSON.parse(new TextDecoder().decode(plain))
  if (document?.format !== WORKSPACE_FORMAT || typeof document.files !== 'object') throw new Error('That snapshot is not a workspace')
  return document
}

/** What storing `size` bytes on `chainId` costs right now, in the network's coin (wei). */
export const quoteSnapshot = async (size, chainId = WORKSPACE_CHAIN_ID) => {
  const response = await fetch(`${chainkeepBase()}/api/v1/uploads/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chainId: Number(chainId), size }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'ChainKeep could not price this right now')
  return BigInt(body.amount)
}

/**
 * Seals the workspace and writes it onchain, paid by the agent's wallet on `chainId`.
 * @param {{agent: object, files: Record<string, string>, chainId?: number, onStep?: Function}} params
 * @returns {Promise<{fileId: string, txHash: string, size: number}>}
 */
export const saveWorkspaceOnchain = async ({ agent, files, chainId = WORKSPACE_CHAIN_ID, onStep = () => {} }) => {
  const chain = chainFor(chainId)
  const bytes = await sealWorkspace(agent, files)
  const wallet = await walletForAgent(agent, 'Saving your agent’s workspace onchain')
  try {
    const stored = await storeWithNative({
      baseUrl: chainkeepBase(),
      signer: wallet.connect(providerFor(chain.id)),
      bytes,
      name: 'hup-agent-workspace.bin',
      type: 'application/octet-stream',
      chainId: chain.id,
      // Already encrypted here under the Key Vault; ChainKeep's own per-file key would be one more secret to lose
      encrypted: false,
      onStep,
    })
    return { fileId: stored.fileId, txHash: stored.paid.tx, size: bytes.length }
  } catch (error) {
    if (/insufficient funds/i.test(error?.shortMessage || error?.message || '')) {
      const symbol = chain.nativeCurrency?.symbol ?? 'coin'
      throw new Error(`${agent.name}'s wallet does not hold enough ${symbol} on ${chain.name} for this, plus gas. Send ${symbol} to it there first.`)
    }
    throw error
  }
}

/** Reads a snapshot back from the chain, verified against its onchain commitments, and opens it. */
export const readWorkspaceOnchain = async ({ agent, fileId, chainId = WORKSPACE_CHAIN_ID }) => {
  const read = await readStored({ baseUrl: chainkeepBase(), provider: providerFor(chainId), chainId: Number(chainId), fileId })
  if (read.owner && read.owner.toLowerCase() !== agent.address.toLowerCase()) throw new Error('That snapshot belongs to a different wallet')
  return openWorkspace(agent, read.bytes)
}
