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
export const GASLESS_POLICY = {
  create: { cooldownMs: 60000, windowMs: 3600000, max: 20 },
  chat: { cooldownMs: 0, windowMs: 60000, max: 30 },
}

export const gaslessPolicyFor = (bucket) => GASLESS_POLICY[bucket] ?? GASLESS_POLICY.chat

// Which bucket a relayed Hup call belongs to; anything absent here is not sponsored.
// Creating content is the only sponsored Hup action — likes stay on the user's own key.
export const GASLESS_BUCKETS = {
  create: 'create',
}

/** "45 seconds" / "2 minutes" — for user-facing throttle messages. */
export const formatWait = (seconds) => {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} seconds`

  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}
