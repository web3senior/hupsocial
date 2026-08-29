import { fetchIPFS } from '@/lib/ipfsGateways'
import { shortUploadError } from '@/lib/uploadErrors'

// The reason a response was not OK, in the short form every caller's toast shows verbatim. Our
// routes carry it as JSON `error`; the storage edge answers a presigned request with S3 XML.
async function readFailure(res, fallback) {
  const body = await res.text().catch(() => '')
  return shortUploadError(body, `${fallback} (${res.status})`)
}

const abortError = () => new DOMException('Upload cancelled', 'AbortError')

// fetch() cannot report upload progress, so the byte-moving requests go through XMLHttpRequest.
// The resolved object mimics the slice of Response the rest of this module reads (ok, status,
// text(), json()); a network failure rejects with the same TypeError fetch would throw, so
// shortUploadError translates it the same way; a cancelled transfer rejects with an AbortError.
function sendUpload({ method, url, body, headers = {}, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())

    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
      }
    }

    xhr.onload = () =>
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        text: async () => xhr.responseText,
        json: async () => JSON.parse(xhr.responseText),
      })
    xhr.onerror = () => reject(new TypeError('Failed to fetch'))
    xhr.onabort = () => reject(abortError())

    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

// Upload through the server-side /api/ipfs/file route (Filebase primary, Pinata fallback).
// Subject to the Vercel 4.5 MB function payload limit.
async function uploadViaServer(file, filename, { onProgress, signal }) {
  const form = new FormData()
  form.append('file', file, filename)
  const res = await sendUpload({ method: 'POST', url: '/api/ipfs/file', body: form, onProgress, signal })
  if (!res.ok) throw new Error(await readFailure(res, 'Upload failed'))
  const { cid } = await res.json()
  if (!cid) throw new Error('CID not found in server upload response')
  return cid
}

// Anything at or above this goes straight to a presigned upload. The server route rejects
// bodies over Vercel's 4.5 MB function payload limit, and it rejects them *after* the whole
// file has been sent — so routing a 60 MB video through it first would upload 60 MB just to
// earn a 413, then upload them all over again on the fallback.
const PRESIGN_THRESHOLD_BYTES = 4 * 1024 * 1024

// Ask the server for somewhere to upload to. Filebase (S3) and Pinata sign uploads
// differently, so the response says which shape came back.
async function requestPresign(file, filename, signal) {
  const res = await fetch('/api/ipfs/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: filename, mimeType: file.type, size: file.size }),
    signal,
  })
  if (!res.ok) throw new Error(await readFailure(res, 'Could not create an upload URL'))
  return res.json()
}

// S3 presigned PUT: the body is the raw file, and the headers have to match what was signed
// or the edge rejects the request. Filebase attaches the CID as object metadata once pinning
// finishes, so the key is resolved to a CID in a second step.
/* Filebase pins after the PUT returns, and one /api/ipfs/cid call only waits a few seconds — a
   100 MB video can need longer. Asking again costs a request; giving up costs the whole upload
   over again, since the browser has nothing but the key to show for it. */
const CID_LOOKUPS = 12
const CID_LOOKUP_GAP_MS = 2000

async function resolveFilebaseCid(key, signal) {
  for (let attempt = 1; ; attempt++) {
    const cidRes = await fetch(`/api/ipfs/cid?key=${encodeURIComponent(key)}`, { signal })
    if (cidRes.ok) {
      const { cid } = await cidRes.json()
      if (!cid) throw new Error('CID not found in Filebase response')
      return cid
    }

    const body = await cidRes.text().catch(() => '')
    let pending = false
    try {
      pending = JSON.parse(body)?.pending === true
    } catch {
      /* Not JSON — a proxy or platform error page, and nothing to wait for */
    }
    if (!pending || attempt >= CID_LOOKUPS) {
      throw new Error(shortUploadError(body, `Uploaded, but the CID could not be resolved (${cidRes.status})`))
    }
    await new Promise((resolve) => setTimeout(resolve, CID_LOOKUP_GAP_MS))
  }
}

/* The storage edge answers a bad presigned PUT before it has read the body, and the browser then
   loses the response body when the connection drops mid-upload — so the status is often all that
   arrives. A 403 on a presigned PUT has three causes, none of them the file itself. */
const describeEdgeRejection = (status) =>
  status === 403
    ? 'Storage rejected the upload (403): stale Filebase keys, an expired upload link, or a header mismatch'
    : `Storage rejected the upload (${status})`

async function uploadViaFilebasePresign(file, { url, key }, { onProgress, signal }) {
  const uploadRes = await sendUpload({
    method: 'PUT',
    url,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
    onProgress,
    signal,
  })
  if (!uploadRes.ok) throw new Error(await readFailure(uploadRes, describeEdgeRejection(uploadRes.status)))

  return resolveFilebaseCid(key, signal)
}

// Pinata's signed URL takes a multipart POST and answers with the CID directly.
async function uploadViaPinataPresign(file, filename, { url }, { onProgress, signal }) {
  /* The v3 uploads endpoint expects the same form shape the Pinata SDK sends:
     network and name alongside the file, not the file alone */
  const form = new FormData()
  form.append('file', file, filename)
  form.append('network', 'public')
  form.append('name', filename)
  const uploadRes = await sendUpload({ method: 'POST', url, body: form, onProgress, signal })
  if (!uploadRes.ok) throw new Error(await readFailure(uploadRes, 'Storage rejected the upload'))

  const { data } = await uploadRes.json()
  return `ipfs://${data.cid}`
}

async function uploadViaPresign(file, filename, transfer) {
  const presigned = await requestPresign(file, filename, transfer.signal)

  return presigned.provider === 'filebase'
    ? uploadViaFilebasePresign(file, presigned, transfer)
    : uploadViaPinataPresign(file, filename, presigned, transfer)
}

/**
 * Upload a File/Blob to IPFS. Returns the CID as "ipfs://<hash>".
 * @param {File|Blob} file
 * @param {{ onProgress?: (fraction: number) => void, signal?: AbortSignal }} [transfer]
 *   `onProgress` receives the share of the file's bytes sent (0–1); `signal` cancels the transfer,
 *   which then rejects with an AbortError the caller can tell apart from a failure.
 */
export async function uploadFileToIPFS(file, transfer = {}) {
  const filename = file.name ?? 'upload'

  try {
    /* Large files skip the server route entirely — it cannot accept them, and finding that out
       costs a full upload. Small ones keep going through it: that route transcodes HEIC before
       pinning, which a direct-to-storage upload would bypass. */
    if (file.size >= PRESIGN_THRESHOLD_BYTES) {
      return await uploadViaPresign(file, filename, transfer)
    }

    try {
      return await uploadViaServer(file, filename, transfer)
    } catch (e) {
      if (e?.name === 'AbortError') throw e
      console.warn('[ipfs] server upload failed, falling back to presigned upload:', e.message)
      return await uploadViaPresign(file, filename, transfer)
    }
  } catch (error) {
    /* A cancelled transfer is the caller's own doing — hand it back untouched */
    if (error?.name === 'AbortError') throw error
    /* Callers put error.message straight into a toast, so a fetch that never reached storage
       ("Failed to fetch") is translated here; the original stays on `cause` for the console */
    throw new Error(shortUploadError(error), { cause: error })
  }
}

/* Metadata JSON is tiny, so a slow answer means the pinning service is struggling, not that
   the payload is large. Generous enough to ride out a retry, short enough that a wedged
   provider surfaces as an error the caller can report. */
const OBJECT_UPLOAD_TIMEOUT_MS = 30000

/**
 * Stamps the publishing wallet onto a metadata payload just before it is pinned.
 *
 * A CID is content-addressed: it says what the document is and nothing about who wrote it. The
 * transaction that carries it is not a reliable answer either — a gasless post arrives from the
 * relayer, a Universal Profile calls through its own ERC725X `execute()`, and a burner session
 * key signs for its owner. Carrying the author inside the document keeps the two together no
 * matter which of those paths the CID travelled, and survives being read straight off a gateway.
 *
 * Two things deliberately opt out, and both are encrypted: chat, and posts to an encrypted
 * community. Neither is stamped at all — not on the envelope, and not inside the ciphertext
 * either. Encryption keeps a secret only as long as its key does, and a key outlives the moment
 * it was used: it gets rotated to someone who joins later, and it can leak. An author sealed
 * inside is a record that only has to be decrypted once to name everyone; an author never
 * written down cannot be recovered at all. Anything Hup publishes openly is stamped.
 *
 * See the payload map in src/tests/README.md for which documents carry the key.
 *
 * @param {Object} payload The metadata about to be pinned.
 * @param {string} [author] Connected wallet — a checksummed EVM address, or base58 for Solana.
 * @returns {Object} `payload` with `author` appended, or `payload` untouched when unconnected.
 */
export const withAuthor = (payload, author) => (typeof author === 'string' && author ? { ...payload, author } : payload)

/**
 * Uploads a plain JSON object through the server-side /api/ipfs/object route and returns the
 * CID string — used for post/community metadata payloads (small, so no presign needed).
 * Rejects rather than hanging if the service does not answer within `timeoutMs`.
 */
export async function uploadObjectToIPFS(contentObj, { timeoutMs = OBJECT_UPLOAD_TIMEOUT_MS } = {}) {
  try {
    const res = await fetch('/api/ipfs/object', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contentObj),
      // Unlike the digest above this one is required — but it still needs a deadline, or a
      // wedged pinning service leaves the caller's submit button spinning with no way back
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(await readFailure(res, 'Upload failed'))
    const { cid } = await res.json()
    if (!cid) throw new Error('CID not found')
    return cid
  } catch (error) {
    throw new Error(shortUploadError(error), { cause: error })
  }
}

/**
 * Pins a set of files as one IPFS DIRECTORY and returns its root CID — what a numbered
 * collection's reveal needs, since tokenURI resolves as baseURI + tokenId + suffix and only a
 * directory root can serve `<cid>/7.json`. File names are flattened to their basename server
 * side, so a folder picked with webkitdirectory lands flat under the root.
 *
 * Goes through the server route rather than a presign: the presigned paths pin objects
 * individually and produce no directory root. That caps a folder at the platform's request
 * body limit, which is ample for a JSON manifest and not for thousands of images — for those,
 * pin externally and paste the CID.
 *
 * @param {File[]|FileList} files
 * @returns {Promise<string>} The directory CID (bare, no `ipfs://` prefix).
 */
export async function uploadFolderToIPFS(files) {
  try {
    const form = new FormData()
    for (const file of Array.from(files)) form.append('files', file, file.webkitRelativePath || file.name)

    const res = await fetch('/api/ipfs/folder', { method: 'POST', body: form })
    if (!res.ok) throw new Error(await readFailure(res, 'Folder upload failed'))

    const { cid } = await res.json()
    if (!cid) throw new Error('CID not found')
    return cid
  } catch (error) {
    throw new Error(shortUploadError(error), { cause: error })
  }
}

/* Hashing asks a gateway for bytes that were pinned seconds ago, which is the slowest thing a
   gateway ever does — freshly pinned content often is not servable yet, and the request can sit
   until the far end gives up. The digest is optional by design (its absence degrades to the
   unverified VerifiableURI form), so it gets a deadline rather than the caller's patience.
   Without one, a drop with an icon, a banner and artwork made four unbounded round trips and
   the composer sat on "Creating…" forever. */
const HASH_TIMEOUT_MS = 12000

/**
 * keccak256 of the bytes a gateway serves for a CID, via /api/ipfs/hash — the digest LSP2/LSP4
 * verification data carries. Returns null when the gateway can't be read OR does not answer
 * within `timeoutMs`: callers publishing metadata fall back to the unverified form rather than
 * blocking on a gateway hiccup.
 * @param {string} uri An `ipfs://` URI or a bare CID.
 * @returns {Promise<string|null>} 0x-prefixed 32-byte digest, or null.
 */
export async function hashIpfsContent(uri, { timeoutMs = HASH_TIMEOUT_MS } = {}) {
  if (!uri) return null

  const cid = String(uri).replace(/^ipfs:\/\//, '').trim()
  if (!cid) return null

  try {
    const res = await fetch(`/api/ipfs/hash?cid=${encodeURIComponent(cid)}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) {
      console.warn(`[ipfs] could not hash ${cid}: ${res.status}`)
      return null
    }
    const { hash } = await res.json()
    return hash || null
  } catch (e) {
    console.warn(`[ipfs] could not hash ${cid}:`, e.message)
    return null
  }
}

/* One gateway's bad minute used to be the whole answer here: a single fetch, and a 504 or a
   hang meant the caller saw `{ result: false }` for content the next host holds. Walking the
   shared list instead costs nothing when the first one answers — which, with Filebase leading,
   is the host our own uploads pinned to. */
const JSON_FETCH_TIMEOUT_MS = 8000

/**
 * Fetches and parses JSON content from IPFS, trying each configured gateway in order.
 * @param {string} CID - Bare CID or path, already stripped of its `ipfs://` prefix.
 * @returns {Promise<object>} The parsed JSON, or `{ result: false }` when no gateway could serve it.
 */
export const getIPFS = async (CID) => {
  if (!CID) {
    console.error('getIPFS Error: No CID provided.')
    return { result: false }
  }

  try {
    const response = await fetchIPFS(CID, { timeoutMs: JSON_FETCH_TIMEOUT_MS })
    return await response.json()
  } catch (e) {
    console.error(`IPFS Error for CID ${CID}:`, e.message)
    return { result: false }
  }
}
