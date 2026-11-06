import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError } from 'viem'

// LSP0ERC725Account, checked on the social graph's LUKSO client.
const LSP0_INTERFACE_ID = '0x24871b3d'
const erc165Abi = [{
  type: 'function',
  name: 'supportsInterface',
  stateMutability: 'view',
  inputs: [{ name: 'interfaceId', type: 'bytes4' }],
  outputs: [{ name: '', type: 'bool' }],
}]

export async function isOnchainFollowAccount(client, address) {
  if (!client) throw new Error('The LUKSO connection is unavailable')
  const code = await client.getCode({ address })
  if (!code || code === '0x') return false

  try {
    return await client.readContract({ address, abi: erc165Abi, functionName: 'supportsInterface', args: [LSP0_INTERFACE_ID] })
  } catch (error) {
    // Other smart wallets may not implement ERC165. Transport failures must never
    // silently send a Universal Profile down the offchain route.
    const unsupported = error instanceof BaseError && error.walk((cause) =>
      cause instanceof ContractFunctionRevertedError || cause instanceof ContractFunctionZeroDataError
    )
    if (unsupported instanceof ContractFunctionRevertedError || unsupported instanceof ContractFunctionZeroDataError) return false
    throw error
  }
}
