/**
 * @file lib/filebase.js
 * @description The Filebase IPFS RPC upload, with the retry the pinning path was missing.
 *
 * Filebase is the primary pin target for every upload in the app; Pinata is only a fallback, and
 * on an account over its plan limits it is not even that. That made a single connection blip on
 * Filebase — undici's `TypeError: fetch failed`, which says nothing about the file and everything
 * about the socket — into a total upload failure, reported as a confusing pair of errors where
 * the actionable half was transient and the permanent half was irrelevant.
 *
 * One transient failure is not a reason to give up on the only working provider, so it retries
 * here before anything falls back.
 */

/* Connection-level failures get another go; a 4xx that is not rate limiting is the request's own
   fault and will fail identically on every attempt. */
const ATTEMPTS = 3
const BACKOFF_MS = [400, 1200]
/* A hung socket used to sit until the platform killed the whole request. Bounded per attempt, and
   deliberately well under a third of the callers' 60s maxDuration: three of these plus the backoff
   is ~38s worst case, which still leaves the Pinata fallback room to run inside the budget. Raise
   this and the last retry gets killed mid-flight instead of failing over. */
const ATTEMPT_TIMEOUT_MS = 12_000

const FILEBASE_RPC_ADD = 'https://rpc.filebase.io/api/v0/add'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Whether another attempt could plausibly succeed.
 * @param {Error & {status?: number}} error
 * @returns {boolean}
 */
function isRetryable(error) {
  /* An HTTP status means Filebase answered: only server-side trouble and rate limiting are
     worth repeating. A rejected token or a malformed body will say the same thing every time. */
  if (error?.status) return error.status >= 500 || error.status === 429

  /* No status at all — the request never completed. That is the `fetch failed` case this
     exists for, plus timeouts. */
  return true
}

/**
 * One `/api/v0/add` call, retried.
 *
 * @param {() => FormData} buildForm Builds the multipart body. A factory rather than a value
 *   because a FormData carrying a Blob is consumed by the attempt that sends it — reusing one
 *   across retries sends an empty body on the second try.
 * @param {{search?: string, timeoutMs?: number, attempts?: number}} [options]
 * @returns {Promise<Array<{Name: string, Hash: string, Size: string}>>} One entry per added
 *   object: the RPC answers with a JSON object per line, and a single file is the one-line case.
 * @throws The last error, with `.attempts` set, when every attempt fails.
 */
async function postAdd(buildForm, { search = '', timeoutMs = ATTEMPT_TIMEOUT_MS, attempts = ATTEMPTS } = {}) {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`${FILEBASE_RPC_ADD}${search}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.FILEBASE_IPFS_RPC_TOKEN}` },
        body: buildForm(),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!res.ok) {
        const error = new Error(`Filebase RPC ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
        error.status = res.status
        throw error
      }

      const entries = (await res.text())
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line))

      if (entries.length === 0) throw new Error('Filebase RPC returned no CID')

      if (attempt > 1) console.log(`[filebase] added on attempt ${attempt}`)

      return entries
    } catch (error) {
      lastError = error

      if (attempt === attempts || !isRetryable(error)) break

      console.warn(`[filebase] attempt ${attempt}/${attempts} failed (${error.message}); retrying`)
      await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length) - 1])
    }
  }

  /* Carried so the error copy can say "after 3 tries" — a reader who has just lost an upload
     deserves to know it was not one unlucky packet. */
  lastError.attempts = attempts
  throw lastError
}

/**
 * Pin one file to Filebase, retrying transient failures.
 * @param {() => FormData} buildForm See {@link postAdd}.
 * @param {{timeoutMs?: number, attempts?: number}} [options]
 * @returns {Promise<string>} The raw CID (no `ipfs://` prefix).
 */
export async function addToFilebase(buildForm, options) {
  const [entry] = await postAdd(buildForm, options)
  if (!entry?.Hash) throw new Error('Filebase RPC returned no CID')

  console.log('[filebase] uploaded, CID:', entry.Hash)
  return entry.Hash
}

/**
 * Pin a set of files as one IPFS DIRECTORY and return its root CID — what a numbered
 * collection needs, since `ipfs://<cid>/7.json` resolves only when <cid> is a directory
 * listing. Part filenames become the entry names, so append them flat.
 * @param {() => FormData} buildForm See {@link postAdd}.
 * @param {{timeoutMs?: number, attempts?: number}} [options]
 * @returns {Promise<string>} The directory CID (no `ipfs://` prefix).
 */
export async function addFolderToFilebase(buildForm, options) {
  const entries = await postAdd(buildForm, { ...options, search: '?wrap-with-directory=true&cid-version=1' })

  /* The wrapper carries no name, and the RPC emits it after every child it contains. */
  const root = entries.findLast((entry) => !entry.Name)
  if (!root?.Hash) throw new Error('Filebase RPC returned no directory CID')

  console.log(`[filebase] pinned folder of ${entries.length - 1} files, CID: ${root.Hash}`)
  return root.Hash
}
