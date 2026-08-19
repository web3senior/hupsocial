/**
 * @file config/cashtags.js
 * @description The tokens a $CASHTAG resolves to, and the only ones that get a live card.
 *
 * Every row's `key` is a DefiLlama coin key — the same format lib/prices.js already builds —
 * which is what lets one batched request price and chart Ethereum natives, ERC20s on five
 * chains, and Solana SPL mints together. Adding a row means adding a key, not a data source.
 *
 * Every key in this file was verified against the live DefiLlama chart API before being
 * committed. That check is not ceremony: the hand-maintained map this replaces carried at
 * least three addresses that resolve to nothing — BONK's was not even valid base58, and
 * AAVE's pointed at an address that has never been AAVE. A cashtag that quotes the wrong
 * token is worse than one that quotes nothing, so a row that cannot be verified stays out.
 *
 * `source: 'dex'` marks the tokens DefiLlama indexes too thinly to chart, which fall back to
 * GeckoTerminal pool data. See lib/priceHistory.js.
 */

export const CASHTAGS = {
  // --- Native coins and majors ---
  BTC: { name: "Bitcoin", key: 'coingecko:bitcoin' },
  ETH: { name: "Ethereum", key: 'coingecko:ethereum' },
  BNB: { name: "BNB", key: 'coingecko:binancecoin' },
  SOL: { name: "Solana", key: 'coingecko:solana' },
  XRP: { name: "XRP", key: 'coingecko:ripple' },
  ADA: { name: "Cardano", key: 'coingecko:cardano' },
  DOGE: { name: "Dogecoin", key: 'coingecko:dogecoin' },
  TRX: { name: "TRON", key: 'coingecko:tron' },
  DOT: { name: "Polkadot", key: 'coingecko:polkadot' },
  AVAX: { name: "Avalanche", key: 'coingecko:avalanche-2' },
  TON: { name: "Toncoin", key: 'coingecko:the-open-network' },
  LTC: { name: "Litecoin", key: 'coingecko:litecoin' },
  BCH: { name: "Bitcoin Cash", key: 'coingecko:bitcoin-cash' },
  XLM: { name: "Stellar", key: 'coingecko:stellar' },
  XMR: { name: "Monero", key: 'coingecko:monero' },
  HBAR: { name: "Hedera", key: 'coingecko:hedera-hashgraph' },
  SUI: { name: "Sui", key: 'coingecko:sui' },
  APT: { name: "Aptos", key: 'coingecko:aptos' },
  LYX: { name: "LUKSO", key: 'coingecko:lukso-token-2' },
  CELO: { name: "Celo", key: 'coingecko:celo' },
  KAS: { name: "Kaspa", key: 'coingecko:kaspa' },
  ICP: { name: "Internet Computer", key: 'coingecko:internet-computer' },
  ETC: { name: "Ethereum Classic", key: 'coingecko:ethereum-classic' },

  // --- Tokens, keyed by DefiLlama chain slug ---
  NEAR: { name: "NEAR Protocol", key: 'ethereum:0x85f17cf997934a597031b2e18a9ab6ebd4b9f6a4' },
  USDT: { name: "Tether", key: 'ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7' },
  USDC: { name: "USD Coin", key: 'ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
  DAI: { name: "Dai", key: 'ethereum:0x6b175474e89094c44da98b954eedeac495271d0f' },
  LINK: { name: "Chainlink", key: 'ethereum:0x514910771af9ca656af840dff83e8264ecf986ca' },
  SHIB: { name: "Shiba Inu", key: 'ethereum:0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce' },
  UNI: { name: "Uniswap", key: 'ethereum:0x1f9840a85d5af5bf1d1762f925bdaddc4201f984' },
  PEPE: { name: "Pepe", key: 'ethereum:0x6982508145454ce325ddbe47a25d4ec3d2311933' },
  AAVE: { name: "Aave", key: 'ethereum:0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9' },
  ARB: { name: "Arbitrum", key: 'arbitrum:0x912ce59144191c1204e64559fe8253a0e49e6548' },
  OP: { name: "Optimism", key: 'optimism:0x4200000000000000000000000000000000000042' },
  FET: { name: "Artificial Superintelligence", key: 'ethereum:0xaea46a60368a7bd060eec7df8cba43b7ef41ad85' },
  POL: { name: "Polygon", key: 'polygon:0x0000000000000000000000000000000000001010' },
  STETH: { name: "Lido Staked ETH", key: 'ethereum:0xae7ab96520de3a18e5e111b5eaab095312d7fe84' },
  WBTC: { name: "Wrapped Bitcoin", key: 'ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' },
  LEO: { name: "LEO Token", key: 'ethereum:0x2af5d2ad76741191d15dfe7bf6ac92d4bd912ca3' },
  MKR: { name: "Maker", key: 'ethereum:0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2' },
  TAO: { name: "Bittensor", key: 'ethereum:0x77e06c9eccf2e797fd462a92b6d7642ef85b0a44' },
  IMX: { name: "Immutable", key: 'ethereum:0xf57e7e7c23978c3caec3c3548e3d615c346e79ff' },
  GTC: { name: "Gitcoin", key: 'ethereum:0xde30da39c46104798bb5aa3fe8b9e0e1f348163f' },
  G: { name: "GoodDollar", key: 'celo:0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a' },

  // --- Solana ---
  // Symbols are not unique on Solana and the popular ones all have same-symbol, same-name
  // spoofs, so these mints are pinned explicitly and never resolved by search.
  ANSEM: { name: 'The Black Bull', key: 'solana:9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump' },
  BONK: { name: 'Bonk', key: 'solana:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
  // DefiLlama has no history for this one — too thin to index — so it charts from its
  // deepest GeckoTerminal pool instead
  TBULL: { name: 'tBULL', key: 'solana:Gmb2t5kLfSfVTKSqy8fzkxfHPkNBF4YcuaZYnMK4SdvS', source: 'dex' },
}

/**
 * DefiLlama chain slug -> chainId, for the pieces of the app that key on chainId: TrustWallet
 * logo URLs, GeckoTerminal lookups, explorer links. Solana has no chainId and is absent here
 * on purpose — callers branch on that rather than inventing a number for it.
 */
export const SLUG_CHAIN_IDS = {
  ethereum: 1,
  bsc: 56,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
  base: 8453,
  celo: 42220,
  lukso: 42,
}

/** The cashtag registry entry for a symbol, or null when Hup does not carry that token. */
export const cashtagFor = (symbol) => CASHTAGS[String(symbol || '').toUpperCase()] ?? null

/** Every symbol that can render a card. */
export const CASHTAG_SYMBOLS = Object.keys(CASHTAGS)

/** Splits a DefiLlama key into its chain and address halves, for logos and explorer links. */
export const splitKey = (key) => {
  const at = String(key).indexOf(':')
  return { chain: key.slice(0, at), address: key.slice(at + 1) }
}
