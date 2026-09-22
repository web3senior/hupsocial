/**
 * @file config/actionFees.js
 * @description What each user action costs in gas, from real receipts (median gasUsed of Hup
 * create/batchLike on LUKSO, Base, Celo and Arbitrum, and LSP3 setData on LUKSO Universal
 * Profiles, 2026-09-22). Dependency-free so the fees route and the page share one table.
 */

// Arbitrum-stack receipts fold the L1 data cost into gasUsed, so their figures run higher
const ARBITRUM_STACK = [42161, 4663]

/**
 * `onchainOn` null = every chain with Hup deployed; a list = only there, a signature elsewhere.
 * `sponsored` = the gas tank can pay it. `calldataBytes` sizes the OP-stack L1 data fee quote.
 */
export const ACTION_FEES = [
  {
    id: 'post',
    label: 'Post',
    plural: 'Posts',
    gas: 235000n,
    arbitrumGas: 281000n,
    calldataBytes: 420n,
    onchainOn: null,
    sponsored: true,
  },
  {
    // Onchain the image is only a content id inside the post, so it costs what a post costs
    id: 'image-post',
    label: 'Post with image',
    plural: 'Image posts',
    gas: 235000n,
    arbitrumGas: 281000n,
    calldataBytes: 420n,
    onchainOn: null,
    sponsored: true,
    storage: true,
  },
  {
    id: 'like',
    label: 'Like',
    plural: 'Likes',
    gas: 61600n,
    arbitrumGas: 62000n,
    calldataBytes: 200n,
    onchainOn: null,
    sponsored: true,
  },
  {
    // Saved on Hup with a signature everywhere; a LUKSO Universal Profile also writes LSP3 onchain
    id: 'profile',
    label: 'Profile update',
    plural: 'Profile updates',
    gas: 70100n,
    arbitrumGas: 70100n,
    calldataBytes: 260n,
    onchainOn: [42],
    sponsored: false,
  },
  {
    id: 'username',
    label: 'Username',
    plural: 'Usernames',
    gas: 0n,
    arbitrumGas: 0n,
    calldataBytes: 0n,
    onchainOn: [],
    sponsored: false,
  },
]

/** Gas an action uses on `chainId`. */
export const actionGas = (action, chainId) => (ARBITRUM_STACK.includes(Number(chainId)) ? action.arbitrumGas : action.gas)

/** Whether `action` is a transaction on `chainId`, rather than a free signature. */
export const isOnchainOn = (action, chainId) => action.onchainOn === null || action.onchainOn.includes(Number(chainId))
