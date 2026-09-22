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

/** HupTasks: micro bounties keyed by the post they ride on. Subset of src/abis/HupTasks.json. */
export const TASKS_ABI = [
  {
    type: 'function',
    name: 'postTask',
    stateMutability: 'payable',
    inputs: [
      { name: '_postId', type: 'uint256' },
      { name: '_category', type: 'string' },
      { name: '_paymentToken', type: 'address' },
      { name: '_isLsp7', type: 'bool' },
      { name: '_rewardPerSlot', type: 'uint256' },
      { name: '_slots', type: 'uint32' },
      { name: '_deadline', type: 'uint64' },
      { name: '_taskPubKey', type: 'bytes' },
    ],
    outputs: [{ name: 'escrowed', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_postId', type: 'uint256' },
      {
        name: '_approvals',
        type: 'tuple[]',
        components: [
          { name: 'replyId', type: 'uint256' },
          { name: 'agentId', type: 'uint256' },
          { name: 'rating', type: 'uint8' },
          { name: 'revealKey', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
  },
  { type: 'function', name: 'addSlots', stateMutability: 'payable', inputs: [{ name: '_postId', type: 'uint256' }, { name: '_extra', type: 'uint32' }], outputs: [] },
  { type: 'function', name: 'extendDeadline', stateMutability: 'nonpayable', inputs: [{ name: '_postId', type: 'uint256' }, { name: '_deadline', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'cancel', stateMutability: 'nonpayable', inputs: [{ name: '_postId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'reclaim', stateMutability: 'nonpayable', inputs: [{ name: '_postId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'taskFeeBps', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'taskPubKeys', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'bytes' }] },
  {
    type: 'function',
    name: 'getTask',
    stateMutability: 'view',
    inputs: [{ name: '_postId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'poster', type: 'address' },
          { name: 'deadline', type: 'uint64' },
          { name: 'slots', type: 'uint32' },
          { name: 'paymentToken', type: 'address' },
          { name: 'paidSlots', type: 'uint32' },
          { name: 'feeBps', type: 'uint16' },
          { name: 'isLsp7', type: 'bool' },
          { name: 'isSealed', type: 'bool' },
          { name: 'closed', type: 'bool' },
          { name: 'hidden', type: 'bool' },
          { name: 'createdAt', type: 'uint64' },
          { name: 'rewardPerSlot', type: 'uint256' },
          { name: 'feePerSlot', type: 'uint256' },
          { name: 'category', type: 'string' },
        ],
      },
    ],
  },
  // Custom errors, so a revert reaches the agent by name
  ...[
    'CancelLocked', 'CommentsDisabled', 'EnforcedPause', 'InsufficientGasForFeedback', 'InvalidBatch', 'InvalidCategory',
    'InvalidPubKey', 'InvalidRating', 'InvalidReward', 'InvalidSlots', 'InvalidWindow', 'NoSlotsLeft', 'NotAPost',
    'NotPostCreator', 'NotPoster', 'RevealKeyTooLarge', 'RevealNotAllowed', 'TaskExists', 'TaskIsClosed', 'TaskNotFound',
    'TaskStillOpen', 'TransferFailed', 'UnexpectedNativePayment', 'UnsupportedToken',
  ].map((name) => ({ type: 'error', name, inputs: [] })),
  ...['AlreadyPaid', 'NotASubmission', 'SelfApproval'].map((name) => ({ type: 'error', name, inputs: [{ name: 'replyId', type: 'uint256' }] })),
  { type: 'error', name: 'InsufficientPayment', inputs: [{ name: 'provided', type: 'uint256' }, { name: 'required', type: 'uint256' }] },
]

export const ERC20_ABI = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
]

// LSP7 is operator-based: authorizedAmountFor(operator, owner)
export const LSP7_OPERATOR_ABI = [
  { type: 'function', name: 'authorizedAmountFor', stateMutability: 'view', inputs: [{ name: 'operator', type: 'address' }, { name: 'tokenOwner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'authorizeOperator', stateMutability: 'nonpayable', inputs: [{ name: 'operator', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'operatorNotificationData', type: 'bytes' }], outputs: [] },
]

export const ERC8004_IDENTITY_ABI = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'agentURI', type: 'string' }], outputs: [{ name: 'agentId', type: 'uint256' }] },
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
