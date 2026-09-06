// app/api/ipfs/folder/route.js

import { NextResponse } from 'next/server'
import { PinataSDK } from 'pinata'
import { addFolderToFilebase } from '@/lib/filebase'
import { bothProvidersFailed, shortUploadError } from '@/lib/uploadErrors'

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT,
})

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

/* A numbered collection's reveal needs a DIRECTORY cid, not a file cid: tokenURI resolves as
   baseURI + tokenId + suffix, so `ipfs://<dir>/7.json` only works when <dir> is a directory
   listing. Both providers can build one — Filebase through its IPFS RPC's wrap-with-directory,
   Pinata through fileArray. (The presigned S3 path cannot: it pins objects individually and
   gives no directory root, which is why this route exists.)

   Deliberately small-batch: the platform body cap (4.5 MB on Vercel) bounds what can come
   through, which covers a per-token JSON manifest comfortably but not thousands of images.
   Creators of large generative collections pin the folder with their own tool and paste the
   CID into the same field — the manage panel accepts either. */
const MAX_FILES = 2000

/* Longer per attempt than a single file gets, and one attempt fewer: a folder is up to the whole
   body cap, and two of these leaves the fallback room inside the 60s budget. */
const FILEBASE_ATTEMPT_TIMEOUT_MS = 20_000
const FILEBASE_ATTEMPTS = 2

export async function POST(request) {
  try {
    if (!process.env.FILEBASE_IPFS_RPC_TOKEN && !process.env.PINATA_JWT) {
      return NextResponse.json({ error: 'Folder pinning is not configured on this deployment' }, { status: 501 })
    }

    const data = await request.formData()
    const files = data.getAll('files').filter((entry) => typeof entry === 'object' && entry !== null)

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Too many files — ${MAX_FILES} max per folder` }, { status: 400 })
    }

    /* Browsers send webkitRelativePath as the file name for a directory pick ("art/1.json"), and
       both providers build the directory from those names — a nested path would bury the tokens a
       level deeper than baseURI expects, so flatten to the basename. */
    const named = files.map((file) => ({ file, name: String(file.name || 'file').split('/').pop() }))

    let cid
    try {
      cid = await addFolderToFilebase(
        () => {
          const form = new FormData()
          for (const { file, name } of named) form.append('file', file, name)
          return form
        },
        { timeoutMs: FILEBASE_ATTEMPT_TIMEOUT_MS, attempts: FILEBASE_ATTEMPTS },
      )
    } catch (filebaseError) {
      console.warn('[filebase] folder pin failed, falling back to Pinata:', filebaseError.message)
      try {
        const flattened = named.map(({ file, name }) => new File([file], name, { type: file.type || 'application/octet-stream' }))
        const result = await pinata.upload.public.fileArray(flattened)
        console.log(`[pinata] pinned folder of ${flattened.length} files, CID: ${result.cid}`)
        cid = result.cid
      } catch (pinataError) {
        console.error('[pinata] fallback folder pin failed:', pinataError.message)
        return NextResponse.json({ error: bothProvidersFailed(filebaseError, pinataError) }, { status: 502 })
      }
    }

    return NextResponse.json({ cid, files: named.length })
  } catch (error) {
    console.error('POST /api/ipfs/folder error:', error)
    return NextResponse.json({ error: shortUploadError(error) }, { status: 500 })
  }
}
