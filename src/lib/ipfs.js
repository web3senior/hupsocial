import { shortUploadError } from '@/lib/uploadErrors'

// The reason a response was not OK, in the short form every caller's toast shows verbatim. Our
// routes carry it as JSON `error`; the storage edge answers a presigned request with S3 XML.
async function readFailure(res, fallback) {
  const body = await res.text().catch(() => '')
  return shortUploadError(body, `${fallback} (${res.status})`)
}

// Upload through the server-side /api/ipfs/file route (Filebase primary, Pinata fallback).
// Subject to the Vercel 4.5 MB function payload limit.
async function uploadViaServer(file, filename) {
  const form = new FormData()
  form.append('file', file, filename)
  const res = await fetch('/api/ipfs/file', { method: 'POST', body: form })
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
async function requestPresign(file, filename) {
  const res = await fetch('/api/ipfs/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: filename, mimeType: file.type, size: file.size }),
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

async function resolveFilebaseCid(key) {
  for (let attempt = 1; ; attempt++) {
    const cidRes = await fetch(`/api/ipfs/cid?key=${encodeURIComponent(key)}`)
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

async function uploadViaFilebasePresign(file, { url, key }) {
  const uploadRes = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!uploadRes.ok) throw new Error(await readFailure(uploadRes, 'Storage rejected the upload'))

  return resolveFilebaseCid(key)
}

// Pinata's signed URL takes a multipart POST and answers with the CID directly.
async function uploadViaPinataPresign(file, filename, { url }) {
  /* The v3 uploads endpoint expects the same form shape the Pinata SDK sends:
     network and name alongside the file, not the file alone */
  const form = new FormData()
  form.append('file', file, filename)
  form.append('network', 'public')
  form.append('name', filename)
  const uploadRes = await fetch(url, { method: 'POST', body: form })
  if (!uploadRes.ok) throw new Error(await readFailure(uploadRes, 'Storage rejected the upload'))

  const { data } = await uploadRes.json()
  return `ipfs://${data.cid}`
}

async function uploadViaPresign(file, filename) {
  const presigned = await requestPresign(file, filename)

  return presigned.provider === 'filebase'
    ? uploadViaFilebasePresign(file, presigned)
    : uploadViaPinataPresign(file, filename, presigned)
}

// Upload a File/Blob to IPFS. Returns the CID as "ipfs://<hash>".
export async function uploadFileToIPFS(file) {
  const filename = file.name ?? 'upload'

  try {
    /* Large files skip the server route entirely — it cannot accept them, and finding that out
       costs a full upload. Small ones keep going through it: that route transcodes HEIC before
       pinning, which a direct-to-storage upload would bypass. */
    if (file.size >= PRESIGN_THRESHOLD_BYTES) {
      return await uploadViaPresign(file, filename)
    }

    try {
      return await uploadViaServer(file, filename)
    } catch (e) {
      console.warn('[ipfs] server upload failed, falling back to presigned upload:', e.message)
      return await uploadViaPresign(file, filename)
    }
  } catch (error) {
    /* Callers put error.message straight into a toast, so a fetch that never reached storage
       ("Failed to fetch") is translated here; the original stays on `cause` for the console */
    throw new Error(shortUploadError(error), { cause: error })
  }
}

/**
 * Uploads a plain JSON object through the server-side /api/ipfs/object route and returns the
 * CID string — used for post/community metadata payloads (small, so no presign needed).
 */
export async function uploadObjectToIPFS(contentObj) {
  try {
    const res = await fetch('/api/ipfs/object', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contentObj),
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
 * keccak256 of the bytes a gateway serves for a CID, via /api/ipfs/hash — the digest LSP2/LSP4
 * verification data carries. Returns null when the gateway can't be read: callers publishing
 * metadata fall back to the unverified form rather than blocking on a gateway hiccup.
 * @param {string} uri An `ipfs://` URI or a bare CID.
 * @returns {Promise<string|null>} 0x-prefixed 32-byte digest, or null.
 */
export async function hashIpfsContent(uri) {
  if (!uri) return null

  const cid = String(uri).replace(/^ipfs:\/\//, '').trim()
  if (!cid) return null

  try {
    const res = await fetch(`/api/ipfs/hash?cid=${encodeURIComponent(cid)}`)
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

/**
 * Fetches and parses JSON content from a specified IPFS gateway URL using the CID.
 */
export const getIPFS = async (CID) => {
  // 1. Basic input validation
  if (!CID) {
    console.error('getIPFS Error: No CID provided.')
    return { result: false }
  }

  // Ensure the gateway URL is configured
  const gatewayUrl = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL
  if (!gatewayUrl) {
    console.error('getIPFS Error: NEXT_PUBLIC_IPFS_GATEWAY_URL environment variable is not set.')
    return { result: false }
  }

  // Construct the full URL for the IPFS content
  const url = `${gatewayUrl}${CID}`

  try {
    // console.log(`Fetching from IPFS: ${url}`);

    const requestOptions = {
      method: 'GET',
      // 'follow' is the default behavior for 'redirect', but explicitly stating it is fine.
      redirect: 'follow',
    }

    const response = await fetch(url, requestOptions)

    // 2. Handle HTTP errors (e.g., 404 Not Found, 500 Server Error)
    if (!response.ok) {
      console.error(`IPFS Fetch Error: Failed to fetch CID ${CID}. Status: ${response.status} ${response.statusText}`)
      return { result: false }
    }

    // 3. Parse the response body as JSON
    const data = await response.json()

    return data
  } catch (e) {
    // 4. Handle network or JSON parsing errors
    console.error(`IPFS Fetch Exception for CID ${CID}:`, e)
    return { result: false }
  }
}
