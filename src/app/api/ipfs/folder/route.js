// app/api/ipfs/folder/route.js

import { NextResponse } from 'next/server'
import { PinataSDK } from 'pinata'
import { shortUploadError } from '@/lib/uploadErrors'

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT,
})

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

/* A numbered collection's reveal needs a DIRECTORY cid, not a file cid: tokenURI resolves as
   baseURI + tokenId + suffix, so `ipfs://<dir>/7.json` only works when <dir> is a directory
   listing. Pinata's fileArray upload is the one path here that produces one — Filebase's S3
   API pins objects individually and gives no directory root, so there is no fallback provider
   for this route the way /api/ipfs/file has one.

   Deliberately small-batch: the platform body cap (4.5 MB on Vercel) bounds what can come
   through, which covers a per-token JSON manifest comfortably but not thousands of images.
   Creators of large generative collections pin the folder with their own tool and paste the
   CID into the same field — the manage panel accepts either. */
const MAX_FILES = 2000

export async function POST(request) {
  try {
    if (!process.env.PINATA_JWT) {
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

    /* Browsers send webkitRelativePath as the file name for a directory pick ("art/1.json").
       Pinata builds the directory from those names, so a nested path would bury the tokens a
       level deeper than baseURI expects — flatten to the basename. */
    const flattened = files.map((file) => {
      const base = String(file.name || 'file').split('/').pop()
      return new File([file], base, { type: file.type || 'application/octet-stream' })
    })

    const result = await pinata.upload.public.fileArray(flattened)

    console.log(`[pinata] pinned folder of ${flattened.length} files, CID: ${result.cid}`)

    return NextResponse.json({ cid: result.cid, files: flattened.length })
  } catch (error) {
    console.error('POST /api/ipfs/folder error:', error)

    /* Pinata is the only provider here, so its quota is a hard stop rather than something to
       fall back from. Say so, and point at the path that still works — the manage panel takes
       a CID pinned anywhere. */
    const message = String(error?.message ?? '')
    if (/plan usage limit|quota|blocked/i.test(message)) {
      return NextResponse.json(
        { error: 'Folder pinning is over its plan limit — pin the folder with your own IPFS tool and paste the CID instead' },
        { status: 503 },
      )
    }

    return NextResponse.json({ error: shortUploadError(error) }, { status: 500 })
  }
}
