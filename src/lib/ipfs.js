// Upload a File/Blob directly to Pinata via a presigned URL, bypassing the
// Vercel 4.5 MB function payload limit. Returns the CID as "ipfs://<hash>".
export async function uploadFileToIPFS(file) {
  const filename = file.name ?? 'upload'

  const presignRes = await fetch('/api/ipfs/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: filename, mimeType: file.type }),
  })
  if (!presignRes.ok) throw new Error('Failed to get presigned upload URL')
  const { url } = await presignRes.json()

  const form = new FormData()
  form.append('file', file, filename)
  const uploadRes = await fetch(url, { method: 'POST', body: form })
  if (!uploadRes.ok) throw new Error(`Pinata upload failed: ${uploadRes.status}`)

  const { data } = await uploadRes.json()
  return `ipfs://${data.cid}`
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
