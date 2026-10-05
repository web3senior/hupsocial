/**
 * Readable (readable.name): onchain numbers like `+0 4242 1230` that a wallet holds and chooses
 * as its primary name. A profile shows the one its wallet chose, read from readable.name's API.
 */
export const readable = {
  // Without a trailing slash; NEXT_PUBLIC_ values are inlined only when referenced literally
  api: (process.env.NEXT_PUBLIC_READABLE_API || 'https://readable.name').replace(/\/+$/, ''),
  // A wallet changes its primary name rarely; a profile visit doesn't need it fresher than this
  staleMs: 300_000,
}
