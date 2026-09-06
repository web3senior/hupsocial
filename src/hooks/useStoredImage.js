'use client'

import { useCallback, useMemo, useState } from 'react'
import { resolveStorageImageUrl } from '@/lib/storageHelper'

/**
 * An `<img>` source for a stored URI, and what to do when it fails.
 *
 * Artwork reaches the browser through the image proxy, which resizes it — but the proxy can
 * only serve what an IPFS gateway still holds, and a banner an indexer remembered may
 * survive only on that indexer's own CDN: First Beings' and HALO's last IPFS provider was
 * Infura's node, which is gone. So a proxy miss retries the stored URL itself when that is a
 * plain https address, and only then is the image given up.
 *
 * Failures are remembered by source rather than by position, so two layers drawing the same
 * file (a banner and the logo over it) report one failure between them rather than skipping
 * a candidate that was never tried.
 * @param {string|null} uri The stored URI — ipfs://, https://, or null for none.
 * @param {{width?: number, still?: boolean}} [options] Size hints for the proxy.
 * @returns {{src: string|null, onError: Function}} `src` is null once nothing is left to try.
 */
export default function useStoredImage(uri, { width, still } = {}) {
  const candidates = useMemo(() => {
    const proxied = uri ? resolveStorageImageUrl(uri, { width, still }) : null
    const list = []
    if (proxied) list.push(proxied)
    if (uri && /^https?:\/\//i.test(uri) && uri !== proxied) list.push(uri)
    return list
  }, [uri, width, still])

  const [failed, setFailed] = useState(() => new Set())

  const onError = useCallback((event) => {
    const src = event.currentTarget.getAttribute('src')
    setFailed((current) => (current.has(src) ? current : new Set(current).add(src)))
  }, [])

  return { src: candidates.find((candidate) => !failed.has(candidate)) || null, onError }
}
