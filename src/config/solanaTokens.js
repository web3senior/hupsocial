/**
 * @file config/solanaTokens.js
 * @description The curated Solana mints Hup renders a cashtag card for.
 *
 * Explicit by design: a symbol is not a unique key on Solana. Searching Jupiter for "ANSEM"
 * returns twenty mints, three of which copy the real token's symbol *and* its name ("The Black
 * Bull") at a fraction of a percent of its market cap. Any lookup that resolves a cashtag by
 * symbol therefore points someone at a spoof sooner or later, so a cashtag renders nothing
 * unless its mint is listed here and the API only ever answers for this list.
 *
 * `source` picks the price upstream. Jupiter answers for verified, well-routed mints and
 * returns every figure the card needs in one call, but a mint it does not route comes back
 * priceless no matter how much liquidity actually exists — TBULL trades ~$65k on Meteora and
 * still reads $0 there. Those are pinned to DexScreener. See lib/solanaPrices.js.
 */

/** Wrapped SOL. Native SOL has no mint of its own, and wSOL is what every venue quotes. */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112'

/**
 * Cashtag symbol (uppercase) → mint. Every entry here was confirmed against Jupiter's token
 * index for holder count and verification, and against DexScreener for real pool liquidity,
 * before being added. Do not add a mint to this file that has not been checked both ways.
 */
export const SOLANA_TOKENS = {
  SOL: {
    mint: WSOL_MINT,
    name: 'Solana',
    decimals: 9,
    source: 'jupiter',
    // The one entry that is not really an SPL position: cards should read "SOL", not "Wrapped SOL"
    native: true,
  },
  ANSEM: {
    mint: '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump',
    name: 'The Black Bull',
    decimals: 6,
    source: 'jupiter',
  },
  TBULL: {
    mint: 'Gmb2t5kLfSfVTKSqy8fzkxfHPkNBF4YcuaZYnMK4SdvS',
    name: 'tBULL',
    decimals: 6,
    // Jupiter indexes the mint but routes no price for it; DexScreener sees the Meteora pool
    source: 'dexscreener',
  },
  BONK: {
    // Replaces a placeholder that was never a valid address — the old value carried a capital
    // 'O', which base58 excludes, so every $BONK hover resolved to nothing
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    name: 'Bonk',
    decimals: 5,
    source: 'jupiter',
  },
}

/** Base58 alphabet excludes 0, O, I and l — the check that would have caught the old BONK entry. */
const BASE58_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** True when a string is shaped like a Solana mint. Shape only; says nothing about existence. */
export const isMint = (value) => typeof value === 'string' && BASE58_MINT.test(value)

/** The allowlist entry for a cashtag symbol, or null when Hup does not carry that token. */
export const solanaTokenFor = (symbol) => SOLANA_TOKENS[String(symbol || '').toUpperCase()] ?? null

/** Every symbol the allowlist covers — used to decide which cashtags route to Solana at all. */
export const SOLANA_SYMBOLS = Object.keys(SOLANA_TOKENS)
