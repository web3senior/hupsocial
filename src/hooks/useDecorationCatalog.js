'use client'

import { useMemo } from 'react'
import useSWR from 'swr'
import { liveCatalog } from '@/lib/decorationSettings'

const KEY = '/api/v1/decorations'

const fetchSettings = async (url) => {
  const response = await fetch(url)
  const result = await response.json()
  if (!result?.success) throw new Error(result?.error || 'Could not load decorations')
  return result.data.settings
}

/**
 * The decoration catalog as the admin has it right now, keyed by id: the bundled catalog with the
 * settings from /api/v1/decorations applied. One request for the whole app — every avatar asks
 * through the same key — and until it answers, or if it fails, the bundled values stand.
 * @returns {Map<string, Object>}
 */
export function useDecorationCatalog() {
  const { data } = useSWR(KEY, fetchSettings, { revalidateOnFocus: false, dedupingInterval: 60_000 })
  return useMemo(() => liveCatalog(data), [data])
}

/** Re-reads the settings after an admin change, so the page shows what it just saved. */
export const DECORATION_CATALOG_KEY = KEY
