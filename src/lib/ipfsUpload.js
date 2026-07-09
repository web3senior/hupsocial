// Shared server-side IPFS upload helper (Filebase primary, Pinata fallback) — extracted so
// server routes don't duplicate the upload logic already living in app/api/ipfs/file/route.js.

import { PinataSDK } from 'pinata'

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT,
})

async function uploadToFilebase(file) {
  const form = new FormData()
  form.append('file', file, file.name)

  const res = await fetch('https://rpc.filebase.io/api/v0/add', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.FILEBASE_IPFS_RPC_TOKEN}`,
    },
    body: form,
  })

  if (!res.ok) throw new Error(`Filebase RPC ${res.status}: ${await res.text()}`)

  const { Hash } = await res.json()
  return Hash
}

async function uploadToPinata(file) {
  const result = await pinata.upload.public.file(file, {
    pinataMetadata: { name: file.name },
  })
  return result.cid
}

export async function uploadFileToIPFS(file) {
  try {
    return await uploadToFilebase(file)
  } catch (e) {
    console.warn('[filebase] upload failed, falling back to Pinata:', e.message)
    return await uploadToPinata(file)
  }
}
