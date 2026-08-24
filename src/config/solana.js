/**
 * The Solana clusters Hup runs on.
 *
 * Solana has no EIP-155 chain id, so the app keys its clusters by SLIP-44's coin type for
 * Solana (501) — the number Phantom and OKX already use as a "chain index" — with 503 for devnet,
 * echoing Solana's own 101/103 cluster-id pattern. These ids are what the `networks` table and
 * every indexed row carry; they never reach a wallet.
 *
 * Each entry is shaped like a wagmi chain object (id, name, iconUrl, primaryColor, textColor,
 * nativeCurrency, blockExplorers) so the network picker, the active-chain hook and the post
 * badge can hold one alongside the EVM chains without special-casing — `isSolana` is the one
 * flag that tells the write paths to build a Solana transaction instead of a contract call.
 *
 * The EVM chains stay in config/contracts.js. The program address lives here rather than in
 * CONTRACTS so nothing EVM-shaped (`0x`, 42 chars, lowercased) ever handles it — base58 is
 * case-sensitive. Dependency-free on purpose: API routes import it too.
 */
export const SOLANA_MAINNET_ID = 501
export const SOLANA_DEVNET_ID = 503

// Solana is not a wagmi chain, so its mark has no home to borrow from. Three slanted bars in
// the brand gradient, on a dark disc so it reads against pale token artwork.
export const SOLANA_ICON = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#0B0B14"/><defs><linearGradient id="sol" x1="7" y1="22.5" x2="24" y2="9.5" gradientUnits="userSpaceOnUse"><stop stop-color="#9945FF"/><stop offset="1" stop-color="#14F195"/></linearGradient></defs><path d="M9.6 20.4a.7.7 0 0 1 .5-.2h13a.35.35 0 0 1 .25.6l-2.55 2.55a.7.7 0 0 1-.5.2h-13a.35.35 0 0 1-.25-.6l2.55-2.55Z" fill="url(#sol)"/><path d="M9.6 8.45a.72.72 0 0 1 .5-.2h13a.35.35 0 0 1 .25.6l-2.55 2.55a.7.7 0 0 1-.5.2h-13a.35.35 0 0 1-.25-.6L9.6 8.45Z" fill="url(#sol)"/><path d="M20.85 14.39a.7.7 0 0 0-.5-.2h-13a.35.35 0 0 0-.25.6l2.55 2.55a.7.7 0 0 0 .5.2h13a.35.35 0 0 0 .25-.6l-2.55-2.55Z" fill="url(#sol)"/></svg>`
export const SOLANA_ICON_URL = `data:image/svg+xml,${encodeURIComponent(SOLANA_ICON)}`

const SOLANA_PRIMARY_COLOR = '#9945FF'
const SOLANA_TEXT_COLOR = '#ffffff'
const SOLANA_EXPLORER_URL = 'https://explorer.solana.com'

const solanaChain = ({ id, name, cluster, walletChain, rpcUrl, isTestnet, hupProgramId }) => ({
  id,
  name,
  cluster,
  // The Wallet Standard chain identifier a wallet signs against
  walletChain,
  rpcUrl,
  explorerUrl: SOLANA_EXPLORER_URL,
  currencySymbol: 'SOL',
  nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
  blockExplorers: { default: { name: 'Solana Explorer', url: SOLANA_EXPLORER_URL } },
  isTestnet,
  testnet: isTestnet,
  isSolana: true,
  icon: SOLANA_ICON,
  iconUrl: SOLANA_ICON_URL,
  primaryColor: SOLANA_PRIMARY_COLOR,
  textColor: SOLANA_TEXT_COLOR,
  hupProgramId,
})

export const SOLANA_NETWORKS = {
  [SOLANA_MAINNET_ID]: solanaChain({
    id: SOLANA_MAINNET_ID,
    name: 'Solana',
    cluster: 'mainnet-beta',
    walletChain: 'solana:mainnet',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    isTestnet: false,
    // Not deployed yet
    hupProgramId: '',
  }),
  [SOLANA_DEVNET_ID]: solanaChain({
    id: SOLANA_DEVNET_ID,
    name: 'Solana Devnet',
    cluster: 'devnet',
    walletChain: 'solana:devnet',
    rpcUrl: 'https://api.devnet.solana.com',
    isTestnet: true,
    // Deployed from Solana Playground 2026-08-24 (see src/contracts/solana/hup/README.md)
    hupProgramId: '9kNAEGDmFZ5iCrmPJRpcEjtFAfPUEhydLAm3YYEcDo5L',
  }),
}

/** Only the clusters Hup is actually deployed on — what the pickers list. */
export const SOLANA_CHAINS = Object.values(SOLANA_NETWORKS).filter((chain) => chain.hupProgramId)

export const isSolanaNetworkId = (networkId) => Object.hasOwn(SOLANA_NETWORKS, Number(networkId))

/** @returns {object|null} The chain-shaped entry for a Solana network id, or null. */
export const solanaChainFor = (networkId) => SOLANA_NETWORKS[Number(networkId)] ?? null

export const isSolanaChain = (chain) => Boolean(chain?.isSolana)

/** The PDA seed of the program's single config account. */
export const HUP_SOLANA_CONFIG_SEED = 'config'

/** Same values as IHup.sol's ContentType, so a row's content_type means one thing on every chain. */
export const HUP_SOLANA_KIND = { POST: 0, COMMENT: 1, REPOST: 2 }

/**
 * Anchor instruction discriminators: sha256("global:<name>")[..8]. Derived from the instruction
 * names in programs/hup/src/lib.rs, so they only change if an instruction is renamed.
 */
export const HUP_SOLANA_DISCRIMINATORS = {
  create: [24, 30, 200, 40, 5, 28, 7, 119],
  update: [219, 200, 88, 176, 158, 63, 253, 127],
  delete: [165, 204, 60, 98, 134, 15, 83, 134],
  like: [116, 148, 16, 9, 250, 48, 5, 114],
  unlike: [140, 55, 191, 17, 60, 100, 149, 8],
}

/**
 * How many `like` instructions fit in one transaction with room to spare under Solana's
 * 1232-byte limit (each is ~20 bytes plus the shared header and two signatures).
 */
export const MAX_SOLANA_BATCH_LIKE = 24

/**
 * Explorer link for a transaction or address on a Solana cluster. Mainnet needs no cluster
 * query; every other cluster does, which is why the EVM `${explorer_url}/tx/${hash}` shape
 * can't be reused as-is.
 * @param {number} networkId
 * @param {'tx'|'address'} kind
 * @param {string} value - Signature or base58 address.
 * @returns {string|null}
 */
export const solanaExplorerUrl = (networkId, kind, value) => {
  const network = solanaChainFor(networkId)
  if (!network || !value) return null
  const cluster = network.cluster === 'mainnet-beta' ? '' : `?cluster=${network.cluster}`
  return `${network.explorerUrl}/${kind}/${value}${cluster}`
}
