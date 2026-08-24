/**
 * @file config/gasless.js
 * @description Spend policy for the gasless trial, shared by the client helper
 * (lib/relayGasless.js) and the relay route so the UI's pre-check and the server's
 * enforcement can never drift apart. Dependency-free on purpose: the API route must not
 * pull in wallet code, the same reason config/contracts.js exists.
 */

/**
 * The chains we sponsor, and the ONLY place that list lives — NEXT_PUBLIC_GASLESS_CHAINS in
 * .env. Nothing is excluded in code: leave a chain off the env list and it is off, which is
 * how Ethereum mainnet stays out. An unset or empty variable means the trial is off
 * everywhere, so a deploy that forgets it falls back to users paying rather than silently
 * sponsoring an L1.
 */
export const gaslessChainIds = () => {
  const raw = process.env.NEXT_PUBLIC_GASLESS_CHAINS
  if (!raw) return []

  return raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
}

export const isGaslessChainId = (networkId) => {
  const id = Number(networkId)
  return Boolean(id) && gaslessChainIds().includes(id)
}

// Per sponsored action:
//   cooldownMs — minimum gap between two of them from one account
//   max/windowMs — ceiling over a longer stretch
// Posting has no natural bound the way a like does (a like can only land once per post), so
// the cooldown is what keeps one account from emptying the relayer.
//
// The interaction buckets have no cooldown on purpose: someone scrolling a feed hearts
// several posts seconds apart, and each heart is its own transaction. The window cap is the
// brake instead — every like goes out as batchLike([id]), so it caps hearts one-to-one, and
// 60 an hour is a heavy scroller's pace rather than a farm's. Past it the wallet pays.
//
// Unlike gets its own deliberately small window, and that asymmetry is the whole defense
// against heart-toggle farming: a like→unlike→like drain cycle needs exactly one sponsored
// unlike per round, so cycles are capped at the unlike max per account per chain per hour.
// Real users unlike a mistap now and then; past the cap the app falls back to the user's
// own wallet, so nothing breaks — it just stops being on us. The two remaining backstops
// are the pre-send simulation (a toggle the contract would revert never costs gas) and the
// tank itself: relayer balances are kept small per chain, so the worst any farm can do is
// empty a tank and turn the trial back into user-paid.
//
// A poll vote is the cheapest tap on the platform and, unlike a like, it is final onchain —
// there is no unvote to farm a cycle with, so the window only has to bound how many polls one
// account can answer in an hour.
export const GASLESS_POLICY = {
  create: { cooldownMs: 60000, windowMs: 3600000, max: 20 },
  like: { cooldownMs: 0, windowMs: 3600000, max: 60 },
  unlike: { cooldownMs: 0, windowMs: 3600000, max: 5 },
  repost: { cooldownMs: 0, windowMs: 3600000, max: 30 },
  poll: { cooldownMs: 0, windowMs: 3600000, max: 40 },
  chat: { cooldownMs: 0, windowMs: 60000, max: 30 },
}

export const gaslessPolicyFor = (bucket) => GASLESS_POLICY[bucket] ?? GASLESS_POLICY.chat

// Which bucket a relayed Hup call belongs to; anything absent here is not sponsored.
// Creating content, liking, unliking and reposting are sponsored. Un-repost is deliberately
// not: it rides deleteContent, a selector that deletes ANY of the caller's content, and
// sponsoring deletions is a different decision from sponsoring taps. batchLike is the only
// like selector listed because it is the only one the app sends — even a single heart goes
// out as batchLike([id]).
export const GASLESS_BUCKETS = {
  create: 'create',
  batchLike: 'like',
  unlike: 'unlike',
}

// Sponsored selectors on the HupPolls contract. Deliberately a separate map from
// GASLESS_BUCKETS: that one is resolved against the Hup Core ABI on both sides of the wire,
// so a poll function name looked up there would throw rather than simply miss. Only `vote`
// is here — createPoll writes a string to storage and closePoll is a moderation-shaped
// action, and neither is a tap the trial exists to make free.
export const GASLESS_POLL_BUCKETS = {
  vote: 'poll',
}

// ContentType.Repost in the Hup contract, mirrored here because this file must stay
// dependency-free (see header).
export const CONTENT_TYPE_REPOST = 2

/**
 * Rate-limit bucket for a sponsored call. A repost rides the `create` selector with
 * ContentType.Repost and empty metadata, so `create` splits on the call's type argument —
 * a repost is throttled like the tap it is, not like authoring a post. `args` is index 1 =
 * content type, which holds both for the client's plain args array and for the route's
 * decoded calldata.
 */
export const gaslessBucketFor = (functionName, args) => {
  const bucket = GASLESS_BUCKETS[functionName] ?? GASLESS_POLL_BUCKETS[functionName]
  if (bucket === 'create' && Number(args?.[1]) === CONTENT_TYPE_REPOST) return 'repost'
  return bucket
}

/** "45 seconds" / "2 minutes" — for user-facing throttle messages. */
export const formatWait = (seconds) => {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} seconds`

  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}
