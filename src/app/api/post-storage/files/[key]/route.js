import { NextResponse } from 'next/server'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { hostedClient, isStorageDeleted, storageOrigin } from '@/lib/postStorageServer'
import { HOSTED_PATH } from '@/lib/postStorage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, context) {
  const { key } = await context.params
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  if (!/^[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/.test(key)) return new NextResponse(null, { status: 404, headers })
  try {
    if (await isStorageDeleted(`${storageOrigin()}${HOSTED_PATH}${key}`)) return new NextResponse(null, { status: 410, headers })
    const range = request.headers.get('range')
    const object = await hostedClient().send(new GetObjectCommand({
      Bucket: process.env.HUP_STORAGE_BUCKET, Key: key, ...(range ? { Range: range } : {}),
    }))
    // Never serve author-controlled HTML/SVG as an executable same-origin document.
    const safeType = /^(application\/json|image\/(jpeg|png|webp|gif|avif)|video\/[\w.+-]+|audio\/[\w.+-]+)(;|$)/i.test(object.ContentType || '')
    headers['Content-Type'] = safeType ? object.ContentType : 'application/octet-stream'
    headers['Content-Security-Policy'] = "default-src 'none'; sandbox"
    headers['Accept-Ranges'] = 'bytes'
    if (object.ContentLength != null) headers['Content-Length'] = String(object.ContentLength)
    if (object.ContentRange) headers['Content-Range'] = object.ContentRange
    return new NextResponse(object.Body.transformToWebStream(), { status: object.ContentRange ? 206 : 200, headers })
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode
    return new NextResponse(null, { status: [404, 416].includes(status) ? status : 502, headers })
  }
}
