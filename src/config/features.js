/**
 * @file config/features.js
 * @description Switches for finished work that isn't public yet.
 *
 * A flag here means the feature is complete and indexed, not half-built: the contract is
 * deployed, cidex is filling its tables, and the surfaces exist — they are simply not shown.
 * That is deliberately different from a half-merged feature, because the way to test one of
 * these is to flip the flag locally and use the real thing.
 *
 * Dependency-free on purpose (same reason config/contracts.js is): API routes, stores, and
 * components all read these, and none of them should drag wallet code in behind the import.
 */

/**
 * Hup Polls. Everything works end to end, but the build carrying voter requirements is not
 * deployed anywhere yet, and shipping a poll composer that points at a superseded contract
 * would be worse than not shipping one. Set NEXT_PUBLIC_POLLS_ENABLED=true to turn every poll
 * surface on — the sidebar row, the home tab, the composer button, /polls, and the in-post
 * card — without touching code.
 */
export const POLLS_ENABLED = process.env.NEXT_PUBLIC_POLLS_ENABLED === 'true'
