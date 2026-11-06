import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { cleanDeletedPost, processPostCleanupJobs, queuePostCleanup } from '@/lib/postStorageCleanup'

export const runtime = 'nodejs'
export const maxDuration = 60

// Public and idempotent: no deletion is possible before the indexer has recorded
// an authorized onchain delete. This supports EOAs, Universal Profiles and Solana.
export async function POST(request) {
  try {
    const { networkId, postId } = await request.json()
    if (!/^[1-9]\d*$/.test(String(networkId)) || !/^[1-9]\d*$/.test(String(postId))) {
      return NextResponse.json({ error: 'Invalid post identity' }, { status: 400 })
    }
    if (!await queuePostCleanup(networkId, postId)) return NextResponse.json({ error: 'Post not indexed yet' }, { status: 404 })
    const result = await cleanDeletedPost(networkId, postId)
    if (result.completed) revalidateTag('post-page-rows', { expire: 0 })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[post-storage] cleanup failed:', error)
    return NextResponse.json({ error: 'Storage cleanup could not finish; it will be retried.' }, { status: 502 })
  }
}

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const results = await processPostCleanupJobs()
  if (results.some((result) => result.completed)) revalidateTag('post-page-rows', { expire: 0 })
  return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
}
