/**
 * @file lib/erc8004.js
 * @description ERC-8004 Trustless Agents registries, as deployed by the 8004 team. Mainnets share
 * one CREATE2 pair and testnets another; both verified onchain on every Hup chain.
 */

const MAINNET = {
  identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
}

const TESTNET = {
  identity: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
}

const TESTNET_IDS = new Set([84532, 4201, 10143, 11155111])

/** The registry pair for a chain id. */
export const erc8004For = (chainId) => (TESTNET_IDS.has(Number(chainId)) ? TESTNET : MAINNET)

/** CAIP-style registry reference used in 8004 registration files: eip155:<chainId>:<identity>. */
export const agentRegistryRef = (chainId) => `eip155:${Number(chainId)}:${erc8004For(chainId).identity}`

export const REGISTRATION_TYPE = 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1'

/** tag1 HupTasks writes on every rating; tag2 is the task's category. */
export const HUP_FEEDBACK_TAG = 'starred'

export const identityRegistryAbi = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'agentURI', type: 'string' }], outputs: [{ name: 'agentId', type: 'uint256' }] },
  { type: 'function', name: 'setAgentURI', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'newURI', type: 'string' }], outputs: [] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'getAgentWallet', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  {
    type: 'function',
    name: 'isAuthorizedOrOwner',
    stateMutability: 'view',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
]

export const reputationRegistryAbi = [
  {
    type: 'function',
    name: 'getSummary',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
    ],
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'summaryValue', type: 'int128' },
      { name: 'summaryValueDecimals', type: 'uint8' },
    ],
  },
]

/**
 * True when `wallet` controls `agentId` on the chain `client` reads: owner, approved operator, or
 * the agent's registered wallet. The same test HupTasks applies before rating an agent.
 */
export async function controlsAgent(client, chainId, wallet, agentId) {
  const { identity } = erc8004For(chainId)
  const id = BigInt(agentId)
  try {
    const authorized = await client.readContract({ address: identity, abi: identityRegistryAbi, functionName: 'isAuthorizedOrOwner', args: [wallet, id] })
    if (authorized) return true
  } catch {
    return false
  }
  try {
    const agentWallet = await client.readContract({ address: identity, abi: identityRegistryAbi, functionName: 'getAgentWallet', args: [id] })
    return String(agentWallet).toLowerCase() === String(wallet).toLowerCase()
  } catch {
    return false
  }
}
