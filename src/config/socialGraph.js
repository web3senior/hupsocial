/**
 * @file config/socialGraph.js
 * @description Universal Profiles follow onchain through LUKSO's canonical LSP26 registry.
 * Other wallets follow offchain through api/v1/follows. cidex indexes LSP26 into the same
 * `follows` table as offchain rows, so lists, counts and feeds aggregate both routes.
 * Dependency-free apart from the contract map, for server and browser imports.
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
