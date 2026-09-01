/**
 * @file lib/walletErrors.js
 * @description Turns a wallet or RPC failure into one sentence a person can act on.
 *
 * viem wraps anything it can't classify as `UnknownRpcError`, whose shortMessage is the famously
 * useless "An unknown RPC error occurred." — the real reason, when there is one, sits further
 * down the `cause` chain in a `details` field no UI ever reads. This walks that chain, skips the
 * placeholder lines, and returns the first thing that actually says something.
 *
 * Deliberately dependency-free (no viem import): the Universal Profile extension rejects with
 * plain objects that never pass through viem's error classes at all, and this has to read those
 * the same way it reads a BaseError.
 */

/** What a wallet or node says when it has nothing — matching one means keep digging. */
const PLACEHOLDER_MESSAGES = [
  /^an unknown rpc error occurred/i,
  /^an error occurred when attempting to execute this operation/i,
  /^an internal error was received/i,
  /^internal (json-)?rpc error/i,
  /^unknown error/i,
  /^execution reverted\.?$/i,
  /^error$/i,
]

/** Longest line a toast can carry before it stops being readable. */
const MAX_LENGTH = 220

/** The first line only — viem appends Request Arguments, Docs, and Version blocks below it. */
const firstLine = (value) => (typeof value === 'string' ? value.split('\n')[0].trim() : '')

/** True when a candidate carries nothing the reader could act on. */
const isPlaceholder = (text) => !text || PLACEHOLDER_MESSAGES.some((pattern) => pattern.test(text))

const clamp = (text) => (text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1).trimEnd()}…` : text)

/**
 * The error and every cause beneath it, outermost first. Depth-capped and cycle-safe because
 * connectors have been known to hand back errors that point at themselves.
 */
const errorChain = (error) => {
  const links = []
  const seen = new Set()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current) && links.length < 12) {
    seen.add(current)
    links.push(current)
    current = current.cause ?? current.error ?? current.data?.originalError
  }
  return links
}

const REJECTION_PATTERN = /user rejected|user denied|rejected the request|request rejected|denied transaction/i

// Node throttling, not a contract failure. Writes go through the wallet's own RPC, so the app's
// fallback endpoints cannot rescue it; -32005 is the code every major node uses for it.
const RATE_LIMIT_PATTERN = /exceeds defined limit|rate.?limit|too many requests|429|request limit|compute units?/i

const isRateLimited = (error) =>
  errorChain(error).some(
    (link) =>
      link.code === -32005 ||
      link.status === 429 ||
      RATE_LIMIT_PATTERN.test(`${firstLine(link.shortMessage)} ${firstLine(link.details)} ${firstLine(link.message)}`)
  )

const DEFAULT_RATE_LIMITED =
  'The network’s RPC is rate-limiting this wallet. Wait a few seconds and try again — if it keeps happening, switch the RPC for this network in your wallet.'

/** A wallet-level "no thanks", which should never be dressed up as a failure. */
export const isUserRejection = (error) =>
  errorChain(error).some(
    (link) =>
      link.code === 4001 ||
      link.name === 'UserRejectedRequestError' ||
      REJECTION_PATTERN.test(`${firstLine(link.shortMessage)} ${firstLine(link.message)}`)
  )

/**
 * The same sentence, re-cased to sit mid-line after a dash or colon. describeWalletError always
 * returns something that reads as its own sentence, and half the callers want it as a clause.
 */
export const asClause = (sentence) => `${String(sentence).charAt(0).toLowerCase()}${String(sentence).slice(1)}`

const DEFAULT_FALLBACK =
  'Your wallet turned the transaction down without saying why. Check you’re on the right network and have enough of its coin for gas, then try again.'

const DEFAULT_REJECTION = 'You rejected the request in your wallet.'

/**
 * One sentence describing why a write failed.
 *
 * @param {unknown} error - whatever the write threw
 * @param {object} [options]
 * @param {Record<string, string>} [options.known] - custom-error name → the sentence to show for
 *   it. A contract's own reverts reach the client as a bare error name (or raw hex), so the only
 *   place their meaning can live is a map like this one, owned by the caller that knows the ABI.
 * @param {string} [options.fallback] - shown when the whole chain turns out to be placeholders
 * @param {string} [options.rejection] - shown when the user simply declined in their wallet
 * @param {string} [options.rateLimited] - shown when the node throttled the request (-32005/429)
 * @returns {string} never empty, never longer than a toast can hold
 */
export const describeWalletError = (error, options = {}) => {
  if (!error) return ''
  const { known = {}, fallback = DEFAULT_FALLBACK, rejection = DEFAULT_REJECTION, rateLimited = DEFAULT_RATE_LIMITED } = options

  if (isUserRejection(error)) return rejection
  // Before the custom-error map: a throttled node never reached the contract
  if (isRateLimited(error)) return rateLimited

  const links = errorChain(error)

  // Custom reverts are matched against the whole chain flattened: the name can surface as the
  // error's own `name`, inside a details string, or buried in a metaMessages line, and which one
  // depends entirely on how far the node bothered to decode it.
  const haystack = links
    .map((link) => [link.name, link.shortMessage, link.details, link.message, link.metaMessages?.join(' ')].filter(Boolean).join(' '))
    .join(' ')
  const hit = Object.keys(known).find((name) => haystack.includes(name))
  if (hit) return known[hit]

  // `details` is where a node puts its own words, `shortMessage` is viem's classification, and
  // the first line of `message` is the last thing left before we'd be guessing.
  for (const link of links) {
    for (const candidate of [firstLine(link.details), firstLine(link.shortMessage), firstLine(link.reason), firstLine(link.message)]) {
      if (!isPlaceholder(candidate)) return clamp(candidate)
    }
  }

  return fallback
}
