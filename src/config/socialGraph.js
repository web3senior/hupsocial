/**
 * @file config/socialGraph.js
 * @description Where the follow graph lives. Following is offchain: a follow or unfollow is a row in
 * the `follows` table, written through the signed-in session (api/v1/follows), free and the same on
 * every chain. The one onchain follow system kept is LSP26 on LUKSO, the canonical registry the rest
 * of the Universal Profile ecosystem reads. cidex indexes it into the same table, so a LUKSO follow
 * made anywhere counts here too. Dependency-free apart from the contract map, so server routes and
 * the browser can both import it.
 */

import { CONTRACTS } from './contracts'

export const SOCIAL_GRAPH_CHAIN_ID = 42

/** LUKSO's LSP26 registry, or undefined when it is not configured. */
export const socialGraphAddress = () => CONTRACTS[`chain${SOCIAL_GRAPH_CHAIN_ID}`]?.followerSystem || undefined

/* Offchain rows share the `follows` table with cidex's indexed ones, under a network id no chain uses
   and the zero address as their contract, so every reader that aggregates the table picks them up
   and cidex's own upserts can never collide with them. */
export const OFFCHAIN_FOLLOW_NETWORK_ID = 0
export const OFFCHAIN_FOLLOW_CONTRACT = '0x0000000000000000000000000000000000000000'

/** How many accounts one follow request may name — the size of a batch follow. */
export const MAX_FOLLOW_TARGETS = 50
