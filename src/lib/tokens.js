// Plain shared config (importable from both client components and server routes — no wagmi/window
// dependencies). Single source of truth for HupBazaar deployments and per-chain USDC.

// HupBazaar deployment per chainId. Server routes (decrypt, x402) resolve the contract from here
// instead of trusting a client-supplied address. Keep in sync with CONTRACTS in config/wagmi.js.
export const STORE_ADDRESSES = {
  42: '0x377ECa68C0E1654d8c0B74135F187250A1702eDC', // lukso
  143: '', // monad
  42220: '', // celo
  8453: '', // base
  56: '', // bnb
  10143: '0x85765350FF07802155a35fFf261DFfaAb0ffA366', // monad-testnet
}

// Sales/revenue event indexing lives in cidex (runBazaarSync) — deploy blocks are recorded
// there in the indexer_state table (see cidex/scripts/add-hupbazaar-contracts.sql).

// Canonical USDC per chainId. `eip3009: true` means the token supports EIP-3009
// transferWithAuthorization and can therefore settle x402 payments. `lsp7: true` means the
// token is an LSP7 Digital Asset (LUKSO) — paid via authorizeOperator, not approve.
export const USDC = {
  42: { address: '0xe0c2e4f894d4cd33626e33b24582559f3156e1ab', eip3009: false, lsp7: true }, // Bridged USDC (Hyperlane) — LSP7, no EIP-3009
  8453: { address: '', eip3009: true }, // native Circle USDC
  42220: { address: '', eip3009: true }, // native Circle USDC
  56: { address: '', eip3009: false }, // Binance-Peg USDC — 18 decimals, no EIP-3009
  // 143 (monad), 10143 (monad-testnet): no canonical USDC configured yet
}

// x402 network identifiers per chainId (the `network` field in payment requirements)
export const X402_NETWORKS = {
  8453: 'base',
  42220: 'celo',
}

// Curated tip tokens per chainId — listed by name in the TipModal's token select so users
// never paste contract addresses for well-known tokens (the custom-address option stays for
// everything else). Every address verified onchain (symbol/decimals read) on 2026-07-17;
// symbols mirror what the token reports today (Arbitrum USDT rebranded to USD₮0, Celo's
// old cUSD address now reports USDm). `lsp7: true` → LSP7 Digital Asset (LUKSO), paid via
// authorizeOperator instead of approve. Decimals are read onchain at tip time, not trusted
// from here.
export const TIP_TOKENS = {
  1: [
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  ],
  42: [
    { symbol: 'USDC', address: '0xe0c2e4f894d4cd33626e33b24582559f3156e1ab', lsp7: true }, // Bridged USDC (Hyperlane)
  ],
  56: [
    { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955' }, // 18 decimals
    { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' }, // Binance-Peg, 18 decimals
  ],
  8453: [
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }, // native Circle USDC
  ],
  10143: [
    { symbol: 'HUP', address: '0x88C0963857049368470E2851aFf5EDFc2D32346C' }, // HupTestToken faucet
  ],
  42161: [
    { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' }, // native Circle USDC
    { symbol: 'USD₮0', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' },
  ],
  42220: [
    { symbol: 'USDC', address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C' }, // native Circle USDC
    { symbol: 'USDm', address: '0x765DE816845861e75A25fCA122bb6898B8B1282a' }, // ex-cUSD (Mento)
    { symbol: 'G$', address: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A' }, // GoodDollar
  ],
  // 143 (monad), 4663 (robinhood): no curated tokens yet
}
