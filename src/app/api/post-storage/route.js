import { NextResponse } from 'next/server'
import { hostedStorageConfigured, putHostedObject } from '@/lib/postStorageServer'

export async function GET() {
  return NextResponse.json({ hosted: hostedStorageConfigured() }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request) {
  if (!hostedStorageConfigured()) return NextResponse.json({ error: 'Hup storage is not configured' }, { status: 503 })
  try {
    const text = await request.text()
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) return NextResponse.json({ error: 'Post is too large' }, { status: 413 })
    const json = JSON.parse(text)
    if (!json || typeof json !== 'object') return NextResponse.json({ error: 'Invalid post content' }, { status: 400 })
    const uri = await putHostedObject(Buffer.from(JSON.stringify(json)), 'post.json', 'application/json')
    return NextResponse.json({ cid: uri, url: uri })
  } catch (error) {
    console.error('[post-storage] upload failed:', error)
    return NextResponse.json({ error: 'Could not save the post to Hup storage' }, { status: 502 })
  }
}
