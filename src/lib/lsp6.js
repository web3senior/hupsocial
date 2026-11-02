/**
 * @file lib/lsp6.js
 * @description An agent as an LSP6 controller of its owner's Universal Profile.
 *
 * The grant is deliberately the narrowest one that lets an agent post as the profile: CALL plus
 * EXECUTE_RELAY_CALL, with AllowedCalls pinned to one function — Hup's `create` on LUKSO. No SIGN
 * (it cannot be scoped: the agent's key could sign anything as the profile, on any app), no
 * SETDATA, no value transfers. A leaked agent key can post in the profile's name and nothing more,
 * and the owner can take that away in one transaction.
 *
 * Posting goes through the profile's Key Manager either way: relayed (LSP25 executeRelayCall,
 * sponsored by Hup's relayer like any other gasless action), or sent by the agent itself through
 * UP.execute, which the Key Manager checks via LSP20.
 */

import { concat, encodeFunctionData, encodePacked, isAddressEqual, keccak256, numberToHex, pad, size, slice, toFunctionSelector } from 'viem'
import { getAccount, getPublicClient, switchChain, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { lukso } from 'wagmi/chains'
import { config, CONTRACTS } from '@/config/wagmi'
import { isUniversalProfile } from './lsp3'

// --- Keys ---

// keccak256('AddressPermissions[]'); entries live at its first 16 bytes + uint128 index
const PERMISSIONS_ARRAY_KEY = '0xdf30dba06db6a30e65354d9a64c609861f089545ca58c6b4dbe31a5f338cb0e3'
const PERMISSIONS_ARRAY_PREFIX = slice(PERMISSIONS_ARRAY_KEY, 0, 16)
// AddressPermissions:Permissions:<address> and AddressPermissions:AllowedCalls:<address>
const PERMISSIONS_PREFIX = '0x4b80742de2bf82acb3630000'
const ALLOWED_CALLS_PREFIX = '0x4b80742de2bf393a64c70000'

const permissionsKey = (controller) => concat([PERMISSIONS_PREFIX, controller])
const allowedCallsKey = (controller) => concat([ALLOWED_CALLS_PREFIX, controller])
const arrayIndexKey = (index) => concat([PERMISSIONS_ARRAY_PREFIX, pad(numberToHex(index), { size: 16 })])

// --- Permissions ---

const CALL = 0x800n
const EXECUTE_RELAY_CALL = 0x400000n
export const AGENT_PERMISSIONS = CALL | EXECUTE_RELAY_CALL

// AllowedCalls entry: <callTypes 4><address 20><interfaceId 4><selector 4>, CompactBytesArray-prefixed
const CALL_TYPE_CALL = '0x00000002'
const ANY_INTERFACE = '0xffffffff'
const HUP_CREATE = toFunctionSelector('create(address,uint8,string,uint256,bool)')

/** The one call an agent may make as the profile: Hup's `create` on LUKSO. */
const agentAllowedCalls = (hup) => concat(['0x0020', CALL_TYPE_CALL, hup, ANY_INTERFACE, HUP_CREATE])

const hupOnLukso = () => {
  const hup = CONTRACTS[`chain${lukso.id}`]?.hup
  if (!hup) throw new Error('Hup is not deployed on LUKSO')
  return hup
}

// --- ABIs ---

const erc725yAbi = [
  { type: 'function', name: 'getDataBatch', stateMutability: 'view', inputs: [{ name: 'dataKeys', type: 'bytes32[]' }], outputs: [{ name: '', type: 'bytes[]' }] },
  {
    type: 'function',
    name: 'setDataBatch',
    stateMutability: 'payable',
    inputs: [
      { name: 'dataKeys', type: 'bytes32[]' },
      { name: 'dataValues', type: 'bytes[]' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
]

export const upExecuteAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'operationType', type: 'uint256' },
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes' }],
  },
]

const keyManagerAbi = [
  {
    type: 'function',
    name: 'getNonce',
    stateMutability: 'view',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'channelId', type: 'uint128' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

// --- Reads ---

const luksoClient = () => {
  const client = getPublicClient(config, { chainId: lukso.id })
  if (!client) throw new Error('LUKSO is unreachable right now')
  return client
}

const getDataBatch = (client, profile, keys) => client.readContract({ address: profile, abi: erc725yAbi, functionName: 'getDataBatch', args: [keys] })

const toBigInt = (bytes) => (bytes && bytes !== '0x' ? BigInt(bytes) : 0n)

/** Whether the owner can have controller agents at all: only a Universal Profile has LSP6 permissions. */
export const ownerIsUniversalProfile = (owner) => isUniversalProfile(getPublicClient(config, { chainId: lukso.id }), owner)

/**
 * What the agent may do on the owner's profile, read from the profile itself.
 * `isOverPermitted` flags any permission beyond AGENT_PERMISSIONS — a key Hup must not hold.
 * @returns {Promise<{isController: boolean, canRelay: boolean, isOverPermitted: boolean}>}
 */
export const readAgentController = async (profile, agent) => {
  const [permissions] = await getDataBatch(luksoClient(), profile, [permissionsKey(agent)])
  const bits = toBigInt(permissions)
  return { isController: (bits & CALL) !== 0n, canRelay: (bits & EXECUTE_RELAY_CALL) !== 0n, isOverPermitted: (bits & ~AGENT_PERMISSIONS) !== 0n }
}

// --- Writes (signed by the owner's profile) ---

/* setDataBatch on the profile itself, from the connected profile: the UP extension wraps it in
   the controller's own execute, the same way the LSP3 profile sync writes. */
const writeProfileData = async (profile, keys, values) => {
  if (getAccount(config).chainId !== lukso.id) await switchChain(config, { chainId: lukso.id })
  const hash = await writeContract(config, { address: profile, abi: erc725yAbi, functionName: 'setDataBatch', args: [keys, values], chainId: lukso.id })
  const receipt = await waitForTransactionReceipt(config, { chainId: lukso.id, hash })
  if (receipt.status !== 'success') throw new Error('Your Universal Profile did not accept the change')
  return hash
}

/**
 * Makes the agent a controller of the profile with AGENT_PERMISSIONS and the single allowed call.
 * An agent already listed keeps its place in AddressPermissions[] and has its grant reset to this one.
 */
export const grantAgentController = async ({ profile, agent }) => {
  const [permissions, length] = await getDataBatch(luksoClient(), profile, [permissionsKey(agent), PERMISSIONS_ARRAY_KEY])

  const keys = [permissionsKey(agent), allowedCallsKey(agent)]
  const values = [pad(numberToHex(AGENT_PERMISSIONS), { size: 32 }), agentAllowedCalls(hupOnLukso())]

  // A new controller is also appended to the list wallets read to show who controls a profile
  if (toBigInt(permissions) === 0n) {
    const count = toBigInt(length)
    keys.push(arrayIndexKey(count), PERMISSIONS_ARRAY_KEY)
    values.push(agent, pad(numberToHex(count + 1n), { size: 16 }))
  }

  return writeProfileData(profile, keys, values)
}

/**
 * Takes the agent's permissions away and removes it from AddressPermissions[], moving the last
 * entry into its slot so the list stays dense.
 */
export const revokeAgentController = async ({ profile, agent }) => {
  const client = luksoClient()
  const [length] = await getDataBatch(client, profile, [PERMISSIONS_ARRAY_KEY])
  const count = toBigInt(length)
  const indexKeys = Array.from({ length: Number(count) }, (_, index) => arrayIndexKey(BigInt(index)))
  const entries = indexKeys.length ? await getDataBatch(client, profile, indexKeys) : []
  const position = entries.findIndex((entry) => size(entry) === 20 && isAddressEqual(entry, agent))

  const keys = [permissionsKey(agent), allowedCallsKey(agent)]
  const values = ['0x', '0x']

  if (position !== -1) {
    const last = Number(count) - 1
    if (position !== last) {
      keys.push(indexKeys[position])
      values.push(entries[last])
    }
    keys.push(indexKeys[last], PERMISSIONS_ARRAY_KEY)
    values.push('0x', pad(numberToHex(count - 1n), { size: 16 }))
  }

  return writeProfileData(profile, keys, values)
}

/**
 * Swaps an agent's key for a new one in a single transaction: the new key takes the old one's place
 * in AddressPermissions[] and gets the agent grant, and the old key loses everything. What a new
 * device does to bring back the same agent.
 */
export const rotateAgentController = async ({ profile, from, to }) => {
  const client = luksoClient()
  const [length] = await getDataBatch(client, profile, [PERMISSIONS_ARRAY_KEY])
  const count = toBigInt(length)
  const indexKeys = Array.from({ length: Number(count) }, (_, index) => arrayIndexKey(BigInt(index)))
  const entries = indexKeys.length ? await getDataBatch(client, profile, indexKeys) : []
  const position = from ? entries.findIndex((entry) => size(entry) === 20 && isAddressEqual(entry, from)) : -1

  const keys = [permissionsKey(to), allowedCallsKey(to)]
  const values = [pad(numberToHex(AGENT_PERMISSIONS), { size: 32 }), agentAllowedCalls(hupOnLukso())]

  if (position !== -1) {
    keys.push(indexKeys[position])
    values.push(to)
  } else {
    // The old key was already gone from the list (revoked by hand): the new one is simply added
    keys.push(arrayIndexKey(count), PERMISSIONS_ARRAY_KEY)
    values.push(to, pad(numberToHex(count + 1n), { size: 16 }))
  }
  if (from) {
    keys.push(permissionsKey(from), allowedCallsKey(from))
    values.push('0x', '0x')
  }

  return writeProfileData(profile, keys, values)
}

// --- Acting as the profile (signed by the agent) ---

/** The profile's `execute` payload for one Hup call. */
export const hupCallPayload = (data) => encodeFunctionData({ abi: upExecuteAbi, functionName: 'execute', args: [0n, hupOnLukso(), 0n, data] })

const LSP25_VERSION = 25n

/**
 * An LSP25 relay call signed by the agent: EIP-191 version 0, with the profile's Key Manager as
 * the intended validator. Channel 0 keeps the nonces sequential; no validity window.
 * @param {import('ethers').Wallet} wallet The agent.
 * @returns {Promise<{keyManager: string, nonce: bigint, validityTimestamps: bigint, signature: string}>}
 */
export const signRelayCall = async ({ wallet, profile, payload }) => {
  const client = luksoClient()
  const keyManager = await client.readContract({ address: profile, abi: erc725yAbi, functionName: 'owner' })
  const nonce = await client.readContract({ address: keyManager, abi: keyManagerAbi, functionName: 'getNonce', args: [wallet.address, 0n] })
  const validityTimestamps = 0n

  const digest = keccak256(
    encodePacked(
      ['bytes1', 'bytes1', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes'],
      ['0x19', '0x00', keyManager, LSP25_VERSION, BigInt(lukso.id), nonce, validityTimestamps, 0n, payload],
    ),
  )
  // A raw digest, not a message: the Key Manager recovers it as-is
  const signature = wallet.signingKey.sign(digest).serialized

  return { keyManager, nonce, validityTimestamps, signature }
}
