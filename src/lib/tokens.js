// Plain shared config (importable from both client components and server routes — no wagmi/window
// dependencies). Single source of truth for HupStore deployments and per-chain USDC.

// HupStore deployment per chainId. Server routes (decrypt, x402) resolve the contract from here
// instead of trusting a client-supplied address. Keep in sync with CONTRACTS in config/wagmi.js.
export const STORE_ADDRESSES = {
  42: '0x377ECa68C0E1654d8c0B74135F187250A1702eDC', // lukso
  143: '', // monad
  42220: '', // celo
  8453: '', // base
  56: '', // bnb
  10143: '', // monad-testnet
}

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
