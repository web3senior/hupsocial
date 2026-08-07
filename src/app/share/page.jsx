'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import NewPost from '@/components/NewPost'
import { toast } from '@/components/NextToast'
import { drainSharedPayload, normalizeSharedText } from '@/lib/shareTarget'
import styles from './page.module.scss'

// Landing route for the Web Share Target declared in app/manifest.js. Two paths arrive here:
// public/sw.js parks the shared text and files in Cache Storage and redirects, or — when no
// worker was in control — api/share/route.js redirects with the text in the query string.
export default function SharePage() {
  const router = useRouter()
  // null until the payload resolves, so the composer never mounts with a half-read share
  const [share, setShare] = useState(null)
  const resolvedRef = useRef(false)

  useEffect(() => {
    if (resolvedRef.current) return
    resolvedRef.current = true

    const resolve = async () => {
      // Read from location rather than useSearchParams: the payload is client-only anyway,
      // and this keeps the route clear of Next's Suspense requirement
      const params = new URLSearchParams(window.location.search)
      if (params.get('error')) toast('Something went wrong receiving that share', 'error')
      if (params.get('media') === 'dropped') toast('Only the text came through this time — attachments were dropped', 'info')

      const parked = await drainSharedPayload()
      if (parked) {
        setShare(parked)
        return
      }

      setShare({
        ...normalizeSharedText({ title: params.get('title'), text: params.get('text'), url: params.get('url') }),
        files: [],
      })
    }

    resolve()
  }, [])

  // replace, not push: closing the composer should land on the feed, and Back should not
  // walk into a share that has already been drained
  const leave = () => router.replace('/')

  if (!share) {
    return (
      <div className={styles.share}>
        <p className={styles.share__status}>Preparing your share…</p>
      </div>
    )
  }

  // Deliberately unwrapped: the composer is a top-layer dialog, and a styled container
  // around it only leaks inherited text properties into the editor
  return <NewPost text={share.text} url={share.url} seedFiles={share.files} onClose={leave} />
}
