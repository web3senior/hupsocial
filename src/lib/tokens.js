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
// authorizeOperator instead of approve. `erc677: true` → pays in a single transaction via
// transferAndCall, skipping approve entirely; only set it for tokens the chain's HupTipper has
// whitelisted with setErc677Token, since the contract rejects any other caller. Decimals are read
// onchain at tip time, not trusted from here.
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
  // Base Sepolia — switched off across the app
  // 84532: [
  //   // Circle testnet USDC
  //   { symbol: 'USDC', address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
  // ],
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
    { symbol: 'G$', address: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A', erc677: true }, // GoodDollar
  ],
  // 143 (monad), 4663 (robinhood): no curated tokens yet
}

// Curated swap-page tokens per chainId — what the token picker offers up front alongside the
// native coin. Launch tokens arrive from /api/v1/launches and anything else via the picker's
// custom-address input, so this list stays short: majors with real v3 liquidity. Decimals are
// read onchain at swap time, not trusted from here. WNATIVE is deliberately absent — pairing
// it against the native coin is a wrap, not a swap, and the swap form rejects that pair.
export const SWAP_TOKENS = {
  // Mainnet entries reuse the TIP_TOKENS addresses above (verified onchain 2026-07-17)
  1: [
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  ],
  56: [
    { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955' }, // 18 decimals
    { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' }, // Binance-Peg, 18 decimals
  ],
  8453: [
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }, // native Circle USDC
  ],
  42161: [
    { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' }, // native Circle USDC
    { symbol: 'USD₮0', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' },
  ],
  42220: [
    { symbol: 'USDC', address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C' }, // native Circle USDC
    { symbol: 'USDm', address: '0x765DE816845861e75A25fCA122bb6898B8B1282a' }, // ex-cUSD (Mento)
  ],
  // 143 (monad): no canonical USDC configured yet — picker offers WMON-paired pastes only
}

// Curated quote assets per chainId — what a creator can pair a Hup Launch against besides the
// chain's native coin. The factory's own allowlist is the authority (HupLaunch.quoteOpeningValue,
// set by an admin per asset); this list only supplies the candidates to read that mapping for, so
// an asset appears in the picker exactly when an admin has priced it onchain.
//
// Wrapped native is deliberately absent: the native coin is already a v4 currency in its own
// right, so a WETH-quoted launch would split its liquidity against the native pool for nothing.
//
// Unlike the lists above, these rows DO carry decimals — every figure a launch renders (price,
// market cap, volume) is raw base units of its quote asset, so a server route with no chain
// access still has to divide by the right power of ten. They are display values: anything about
// to spend money reads decimals onchain and prefers that (hooks/useQuoteAsset). Getting one wrong
// is not subtle — Base's USDC is 6 where BNB's is 18, and a 12-place slip reads as a plausible
// market cap rather than as an error.
//
// Every address verified against DefiLlama (symbol + decimals) on 2026-09-10; Base Sepolia's was
// read onchain, being a testnet DefiLlama does not price.
export const LAUNCH_QUOTES = {
  1: [
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
  ],
  56: [
    { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 }, // Binance-Peg
    { symbol: 'BTCB', address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', decimals: 18 },
  ],
  8453: [
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 }, // native Circle USDC
    { symbol: 'cbBTC', address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8 },
  ],
  42161: [
    { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 }, // native Circle USDC
    { symbol: 'USD₮0', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    { symbol: 'ARB', address: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18 },
  ],
  42220: [
    { symbol: 'USDC', address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6 }, // native Circle USDC
    { symbol: 'USDm', address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18 }, // ex-cUSD (Mento)
    { symbol: 'G$', address: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A', decimals: 18 }, // GoodDollar
  ],
  4663: [
    { symbol: 'USDG', address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', decimals: 6 }, // verified onchain
  ],
  84532: [
    { symbol: 'USDC', address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6 }, // Circle testnet USDC
  ],
  // Robinhood Chain's tokenized equities are NOT listed here — there are ~194 of them and the set
  // changes, so they come from the issuer's live registry via lib/stockTokens.js.
  //
  // 42 (lukso): no Uniswap v4, so no launches at all. 143 (monad): no canonical stablecoin yet.
}
