// Upload through the server-side /api/ipfs/file route (Filebase primary, Pinata fallback).
// Subject to the Vercel 4.5 MB function payload limit.
async function uploadViaServer(file, filename) {
  const form = new FormData()
  form.append('file', file, filename)
  const res = await fetch('/api/ipfs/file', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Server upload failed: ${res.status}`)
  const { cid } = await res.json()
  if (!cid) throw new Error('CID not found in server upload response')
  return cid
}

// Upload directly to Pinata via a presigned URL, bypassing the Vercel 4.5 MB
// function payload limit.
async function uploadViaPinataPresign(file, filename) {
  const presignRes = await fetch('/api/ipfs/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: filename, mimeType: file.type }),
  })
  if (!presignRes.ok) {
    const { error } = await presignRes.json().catch(() => ({}))
    throw new Error(error || 'Failed to get presigned upload URL')
  }
  const { url } = await presignRes.json()

  /* The v3 uploads endpoint expects the same form shape the Pinata SDK sends:
     network and name alongside the file, not the file alone */
  const form = new FormData()
  form.append('file', file, filename)
  form.append('network', 'public')
  form.append('name', filename)
  const uploadRes = await fetch(url, { method: 'POST', body: form })
  if (!uploadRes.ok) throw new Error(`Pinata upload failed: ${uploadRes.status}`)

  const { data } = await uploadRes.json()
  return `ipfs://${data.cid}`
}

// Upload a File/Blob to IPFS. Returns the CID as "ipfs://<hash>".
export async function uploadFileToIPFS(file) {
  const filename = file.name ?? 'upload'

  try {
    return await uploadViaServer(file, filename)
  } catch (e) {
    console.warn('[ipfs] server upload failed, falling back to Pinata presign:', e.message)
    return await uploadViaPinataPresign(file, filename)
  }
}

/**
 * Uploads a plain JSON object through the server-side /api/ipfs/object route and returns the
 * CID string — used for post/community metadata payloads (small, so no presign needed).
 */
export async function uploadObjectToIPFS(contentObj) {
  const res = await fetch('/api/ipfs/object', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contentObj),
  })
  if (!res.ok) throw new Error('Failed to upload content to IPFS')
  const { cid } = await res.json()
  if (!cid) throw new Error('CID not found')
  return cid
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
