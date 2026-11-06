import { mutate } from 'swr'
import { upsertPosts } from '@/db/posts'
import { invalidateThread } from '@/db/comments'
import { usePostStore } from '@/stores/usePostStore'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function preparePostDeletion(item) {
  const response = await fetch('/api/post-storage/cleanup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ networkId: item.network_id, postId: String(item.id) }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error('Could not prepare storage cleanup. Please try deleting again.')
}

// This promise outlives the post card. The server queue handles a closed tab or
// a failed Filebase request; the browser only waits to give an accurate outcome.
export async function completePostDeletion(item) {
  upsertPosts([{ ...item, is_deleted: true, metadata: null, content: null }])
  if (item.is_comment) invalidateThread(item.network_id, item.is_comment)
  usePostStore.getState().notifyAuthoredPost()
  mutate((key) => typeof key === 'string' && key.startsWith(`posts/${item.network_id}/${item.id}/`))
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch('/api/post-storage/cleanup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ networkId: item.network_id, postId: String(item.id) }),
      })
      if (!response.ok) return false
      if (response.ok && (await response.json()).completed) return true
    } catch { /* The durable job remains queued. */ }
    await delay(2000)
  }
  return false
}
