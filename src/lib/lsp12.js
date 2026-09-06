import { concatHex, pad, slice, toHex } from 'viem'

/**
 * LSP12IssuedAssets — the list a Universal Profile keeps of what it created.
 *
 * A collection names its creator in LSP4Creators[]; explorers only call that creator verified
 * once the profile names the collection back here. The engine cannot write it (the profile's
 * data keys belong to its controller), so the app asks the creator to sign it after a drop.
 */

/** keccak256('LSP12IssuedAssets[]') */
export const LSP12_ISSUED_ASSETS_KEY = '0x7c8c3416d6cda87cd42c71ea1843df28ac4850354f988d55ee2eaa47b6dc05cd'

/** bytes10(keccak256('LSP12IssuedAssetsMap')) + 2 zero bytes; the asset address completes the key. */
export const LSP12_ISSUED_ASSETS_MAP_PREFIX = '0x74ac2555c10b9349e78f0000'

export const INTERFACEID_LSP7 = '0xc52d6008'
export const INTERFACEID_LSP8 = '0x3a271706'

export const ERC725Y_GET_DATA_BATCH_ABI = [
  { name: 'getDataBatch', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32[]' }], outputs: [{ type: 'bytes[]' }] },
]

// LSP0's setData is payable; the write sends no value
export const ERC725Y_SET_DATA_BATCH_ABI = [
  {
    name: 'setDataBatch',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'dataKeys', type: 'bytes32[]' },
      { name: 'dataValues', type: 'bytes[]' },
    ],
    outputs: [],
  },
]

/** LSP2 array element key: the first half of the array key, then the index as uint128. */
export const issuedAssetsElementKeyAt = (index) => concatHex([slice(LSP12_ISSUED_ASSETS_KEY, 0, 16), pad(toHex(index), { size: 16 })])

/** LSP2 mapping key: the map prefix, then the asset address. */
export const issuedAssetsMapKey = (asset) => concatHex([LSP12_ISSUED_ASSETS_MAP_PREFIX, asset])

/** The ERC165 id a Hup drop collection carries, which is what the map entry records. */
export const issuedAssetInterfaceId = (isLsp8) => (isLsp8 ? INTERFACEID_LSP8 : INTERFACEID_LSP7)

/**
 * Whether `profile` already lists `asset`, and how long its list is. An address with no ERC725Y
 * behind it reads as an empty list rather than an error.
 * @returns {Promise<{ count: number, listed: boolean }>}
 */
export async function readIssuedAssetListing(publicClient, profile, asset) {
  const [countBytes, mapBytes] = await publicClient
    .readContract({
      address: profile,
      abi: ERC725Y_GET_DATA_BATCH_ABI,
      functionName: 'getDataBatch',
      args: [[LSP12_ISSUED_ASSETS_KEY, issuedAssetsMapKey(asset)]],
    })
    .catch(() => ['0x', '0x'])

  const count = countBytes && countBytes !== '0x' ? Number(BigInt(countBytes)) : 0

  return { count, listed: Boolean(mapBytes && mapBytes !== '0x') }
}

/**
 * The three writes that append one asset to a profile's list: the new length, the element at
 * the old length, and the map entry pointing back at that index. Same LSP2 shape the collection
 * uses for LSP4Creators[], read from the other side.
 * @param {{ asset: string, interfaceId: string, count: number }} entry `count` is the list length before the append.
 * @returns {{ keys: string[], values: string[] }} One setDataBatch on the profile.
 */
export const encodeIssuedAssetAppend = ({ asset, interfaceId, count }) => ({
  keys: [LSP12_ISSUED_ASSETS_KEY, issuedAssetsElementKeyAt(count), issuedAssetsMapKey(asset)],
  values: [pad(toHex(count + 1), { size: 16 }), asset, concatHex([interfaceId, pad(toHex(count), { size: 16 })])],
})
