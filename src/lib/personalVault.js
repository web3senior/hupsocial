import { concat, decodeEventLog, encodeFunctionData, erc20Abi, getAddress, hexToString, isAddress, keccak256, pad, parseAbi, toHex, zeroAddress } from 'viem'
import { erc725yGetDataAbi, LSP4_TOKEN_SYMBOL_KEY } from '@/lib/lsp4'
import safeArtifact from '@safe-global/safe-contracts/build/artifacts/contracts/SafeL2.sol/SafeL2.json'
import factoryArtifact from '@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json'
import safe130 from 'safe-contracts-v130/build/artifacts/contracts/GnosisSafeL2.sol/GnosisSafeL2.json'
import factory130 from 'safe-contracts-v130/build/artifacts/contracts/proxies/GnosisSafeProxyFactory.sol/GnosisSafeProxyFactory.json'

export const safeAbi = safeArtifact.abi
export const factoryAbi = factoryArtifact.abi
export const safeAbiFor = (deployment) => deployment?.version === '1.3.0' ? safe130.abi : safeAbi
export const factoryAbiFor = (deployment) => deployment?.version === '1.3.0' ? factory130.abi : factoryAbi
export const VAULT_SIGNER_LIMITS = Object.freeze({ min: 2, max: 10, defaultThreshold: 2 })
export const lsp7Abi = parseAbi([
  'function transfer(address from, address to, uint256 amount, bool force, bytes data)',
])

export function validAddress(value) {
  if (typeof value !== 'string' || !isAddress(value) || value.toLowerCase() === zeroAddress) throw new Error('Enter a valid, nonzero wallet address.')
  return getAddress(value)
}

export function vaultSetup(rawOwners, threshold, connected) {
  const owners = rawOwners.map((owner) => validAddress(owner.trim()))
  if (owners.length < VAULT_SIGNER_LIMITS.min || owners.length > VAULT_SIGNER_LIMITS.max) throw new Error(`Choose between ${VAULT_SIGNER_LIMITS.min} and ${VAULT_SIGNER_LIMITS.max} signing wallets.`)
  if (new Set(owners.map((owner) => owner.toLowerCase())).size !== owners.length) throw new Error('Each signing wallet must be different.')
  if (owners.some((owner) => BigInt(owner) === 1n)) throw new Error('The sentinel address cannot be a signer.')
  if (!Number.isInteger(threshold) || threshold < VAULT_SIGNER_LIMITS.min || threshold > owners.length) throw new Error(`Require at least ${VAULT_SIGNER_LIMITS.min} approvals, up to the number of signers.`)
  if (!connected || !owners.some((owner) => owner.toLowerCase() === connected.toLowerCase())) throw new Error('Include your connected wallet as a signer.')
  return { owners, threshold, initializer: encodeFunctionData({ abi: safeAbi, functionName: 'setup', args: [owners, BigInt(threshold), zeroAddress, '0x', zeroAddress, zeroAddress, 0n, zeroAddress] }) }
}

function uint(value, positive = false) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(value)) throw new Error('Invalid proposal amount or nonce.')
  const parsed = BigInt(value)
  if (parsed >= 2n ** 256n || (positive && parsed === 0n)) throw new Error('Invalid proposal amount or nonce.')
  return parsed
}

// Rebuild calldata from a restricted transfer description. Never accept arbitrary shared calldata.
export function normalizeProposal(input, chainId, vault) {
  if (!input || input.version !== 1 || input.chainId !== chainId || validAddress(input.vault) !== validAddress(vault)) throw new Error('This proposal belongs to a different vault or network.')
  if (!['native', 'erc20', 'lsp7'].includes(input.kind)) throw new Error('Unsupported transfer type.')
  const recipient = validAddress(input.recipient)
  if (recipient === validAddress(vault)) throw new Error('Choose a recipient other than this vault.')
  const token = input.kind === 'native' ? zeroAddress : validAddress(input.token)
  if (token === validAddress(vault)) throw new Error('The vault is not a token contract.')
  uint(input.amount, true)
  uint(input.nonce)
  return { version: 1, chainId, vault: validAddress(vault), kind: input.kind, token, recipient, amount: input.amount, nonce: input.nonce }
}

export function transferCall(proposal) {
  const p = normalizeProposal(proposal, proposal.chainId, proposal.vault)
  if (p.kind === 'native') return { to: p.recipient, value: BigInt(p.amount), data: '0x' }
  const data = p.kind === 'erc20'
    ? encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [p.recipient, BigInt(p.amount)] })
    : encodeFunctionData({ abi: lsp7Abi, functionName: 'transfer', args: [p.vault, p.recipient, BigInt(p.amount), true, '0x'] })
  return { to: p.token, value: 0n, data }
}

export function transactionArgs(proposal) {
  const { to, value, data } = transferCall(proposal)
  return [to, value, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress]
}

export async function simulateTransfer(client, proposal) {
  const call = transferCall(proposal)
  if (proposal.kind === 'native') return
  const args = proposal.kind === 'erc20'
    ? [proposal.recipient, BigInt(proposal.amount)]
    : [proposal.vault, proposal.recipient, BigInt(proposal.amount), true, '0x']
  const result = await client.simulateContract({ account: proposal.vault, address: call.to, abi: proposal.kind === 'erc20' ? erc20Abi : lsp7Abi, functionName: 'transfer', args })
  if (proposal.kind === 'erc20' && result.result !== true) throw new Error('This ERC20 token did not report a successful transfer. It is unsupported.')
}

export function approvalSignatures(owners) {
  const sorted = [...new Set(owners.map((owner) => validAddress(owner)))].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)
  return concat(sorted.map((owner) => concat([pad(owner, { size: 32 }), pad('0x00', { size: 32 }), toHex(1, { size: 1 })])))
}

export async function verifyDeployment(client, deployment, options = {}) {
  if (!deployment) throw new Error('Safe deployment is unavailable on this network.')
  for (const item of [deployment.singleton, deployment.factory]) {
    const code = await client.getCode({ address: item.address, ...options })
    if (!code || keccak256(code) !== item.codeHash) throw new Error('Safe deployment verification failed. No transaction was sent.')
  }
}

export async function readVault(client, vault, deployment, options = {}) {
  await verifyDeployment(client, deployment, options)
  const [code, slot] = await Promise.all([client.getCode({ address: vault, ...options }), client.getStorageAt({ address: vault, slot: toHex(0, { size: 32 }), ...options })])
  if (!code || keccak256(code) !== deployment.proxyCodeHash || !slot || getAddress(`0x${slot.slice(-40)}`) !== getAddress(deployment.singleton.address)) throw new Error('This address is not a supported Safe vault on this network.')
  const read = (functionName) => client.readContract({ address: vault, abi: safeAbi, functionName, ...options })
  const [owners, threshold, nonce, balance] = await Promise.all([read('getOwners'), read('getThreshold'), read('nonce'), client.getBalance({ address: vault, ...options })])
  if (threshold < 2n) throw new Error('This vault does not require multiple approvals.')
  return { owners, threshold: Number(threshold), nonce, balance }
}

export async function proposalStatus(client, proposal, snapshot) {
  if (BigInt(proposal.nonce) !== snapshot.nonce) throw new Error('This proposal is stale. Create a new transfer using the current vault nonce.')
  const call = transferCall(proposal)
  if (proposal.kind !== 'native') {
    const code = await client.getCode({ address: proposal.token })
    if (!code || code === '0x') throw new Error('The token address has no contract on this network.')
  }
  const hash = await client.readContract({ address: proposal.vault, abi: safeAbi, functionName: 'getTransactionHash', args: [...transactionArgs(proposal), BigInt(proposal.nonce)] })
  const approvals = await Promise.all(snapshot.owners.map(async (owner) => {
    const approved = await client.readContract({ address: proposal.vault, abi: safeAbi, functionName: 'approvedHashes', args: [owner, hash] })
    return { owner, approved: approved > 0n }
  }))
  return { hash, call, approvals }
}

export function receiptEvent(receipt, address, abi, eventName) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics })
      if (decoded.eventName === eventName) return decoded.args
    } catch { /* Other contract events are unrelated. */ }
  }
  return null
}

export async function readToken(client, token, vault) {
  validAddress(token)
  const code = await client.getCode({ address: token })
  if (!code || code === '0x') throw new Error('Token contract not found.')
  const read = (functionName, args = []) => client.readContract({ address: token, abi: erc20Abi, functionName, args })
  const readSymbol = () => read('symbol').catch(async () => {
    const bytes = await client.readContract({ address: token, abi: erc725yGetDataAbi, functionName: 'getData', args: [LSP4_TOKEN_SYMBOL_KEY] })
    return bytes && bytes !== '0x' ? hexToString(bytes) : 'TOKEN'
  }).catch(() => 'TOKEN')
  const [decimals, balance, symbol] = await Promise.all([read('decimals'), read('balanceOf', [vault]), readSymbol()])
  return { decimals, balance, symbol: String(symbol).slice(0, 40) }
}

export const historyEvents = safeAbi.filter((item) => item.type === 'event' && ['SafeReceived', 'ExecutionSuccess', 'ExecutionFailure'].includes(item.name))
export const historyEventsFor = (deployment) => safeAbiFor(deployment).filter((item) => item.type === 'event' && ['SafeReceived', 'ExecutionSuccess', 'ExecutionFailure'].includes(item.name))
