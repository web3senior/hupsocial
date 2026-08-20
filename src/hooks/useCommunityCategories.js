'use client'

import useSWR from 'swr'
import { FALLBACK_CATEGORY } from '@/config/communityCategories'

const fetcher = (url) => fetch(url).then((res) => res.json())

// Before the first response (and if it ever fails) the picker still needs one real option, and
// the pills still need a label for "no category" — "Other" is both
const FALLBACK_LIST = [FALLBACK_CATEGORY]

/**
 * The active community categories from `community_categories`, in display order — the list the
 * create/modify picker offers and the directory chips filter on. Cached across the page by SWR
 * (every card calls this; one request serves them all) and held for ten minutes since the table
 * changes roughly never.
 * @returns {{ categories: Array<{slug: string, label: string}>, isLoading: boolean }}
 */
export default function useCommunityCategories() {
  const { data, isLoading } = useSWR('/api/v1/communities/categories', fetcher, {
    dedupingInterval: 10 * 60 * 1000,
    revalidateOnFocus: false,
  })

  const categories = Array.isArray(data?.data) && data.data.length > 0 ? data.data : FALLBACK_LIST
  return { categories, isLoading }
}
