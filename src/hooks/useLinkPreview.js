'use client'

/**
 * @file hooks/useLinkPreview.js
 * @description The card a post's first previewable link earns, resolved live.
 *
 * Nothing about the link is stored on the post: the text carries the URL and everything else
 * resolves at render, so an edited tweet or a re-titled page shows as it is now. The link is
 * chosen synchronously from the text, so the card can reserve its space before the answer lands.
 */

import { useMemo } from 'react'
import useSWR from 'swr'
import { previewableLink } from '@/lib/linkPreview'

const fetcher = (url) => fetch(url).then((res) => (res.ok ? res.json() : { data: null }))

/**
 * @param {string} text the post's body
 * @param {{ enabled?: boolean }} [options]
 */
export function useLinkPreview(text, { enabled = true } = {}) {
  const link = useMemo(() => (enabled ? previewableLink(text) : null), [text, enabled])
  const key = link ? `/api/v1/links/preview?url=${encodeURIComponent(link.url)}` : null

  const { data, isLoading } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    // A card is context, not a feed of its own; the edge cache holds it for an hour anyway
    dedupingInterval: 3_600_000,
    keepPreviousData: true,
  })

  return { link, preview: data?.data ?? null, isLoading: Boolean(key) && isLoading }
}

export default useLinkPreview
