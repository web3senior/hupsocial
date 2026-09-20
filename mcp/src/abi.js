/**
 * @file mcp/src/abi.js
 * The fragments an agent calls. Subsets of src/abi/post.json, src/abis/Forwarder.json and
 * src/abis/LSP26FollowerSystem.json in the app.
 */

export const HUP_ABI = [
  {
    type: 'function',
    name: 'create',
    stateMutability: 'payable',
    inputs: [
      { name: '_owner', type: 'address' },
      { name: '_type', type: 'uint8' },
      { name: '_metadata', type: 'string' },
      { name: '_parentId', type: 'uint256' },
      { name: '_allowedComments', type: 'bool' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'update',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_owner', type: 'address' },
      { name: '_id', type: 'uint256' },
      { name: '_metadata', type: 'string' },
      { name: '_allowedComments', type: 'bool' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'deleteContent',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_owner', type: 'address' },
      { name: '_id', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'batchLike',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_owner', type: 'address' },
      { name: '_ids', type: 'uint256[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'unlike',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_owner', type: 'address' },
      { name: '_id', type: 'uint256' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'fee', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    type: 'function',
    name: 'maxMetadataBytes',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'isTrustedForwarder',
    stateMutability: 'view',
    inputs: [{ name: 'forwarder', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'ContentCreated',
    anonymous: false,
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'cType', type: 'uint8', indexed: true },
      { name: 'parentId', type: 'uint256', indexed: false },
      { name: 'metadata', type: 'string', indexed: false },
      { name: 'allowedComments', type: 'bool', indexed: false },
      { name: 'createdAt', type: 'uint256', indexed: false },
    ],
  },
]

export const FORWARDER_ABI = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

export const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
}

export const LSP26_ABI = [
  { type: 'function', name: 'follow', stateMutability: 'nonpayable', inputs: [{ name: 'addr', type: 'address' }], outputs: [] },
  { type: 'function', name: 'unfollow', stateMutability: 'nonpayable', inputs: [{ name: 'addr', type: 'address' }], outputs: [] },
  {
    type: 'function',
    name: 'isFollowing',
    stateMutability: 'view',
    inputs: [
      { name: 'follower', type: 'address' },
      { name: 'addr', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'followerCount',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'followingCount',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

export const CONTENT_TYPE = { post: 0, comment: 1, repost: 2 }
