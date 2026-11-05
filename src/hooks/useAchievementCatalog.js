'use client'

import useSWR from 'swr'
import { getAchievementCatalog } from '@/lib/api'
import { ACHIEVEMENTS } from '@/config/achievements'

export default function useAchievementCatalog() {
  const result = useSWR('achievements:catalog', getAchievementCatalog)
  const catalog = (result.data?.catalog ?? ACHIEVEMENTS).filter((item) => item.listed !== false)
  return { ...result, catalog, achievementById: (id) => catalog.find((item) => item.id === id) ?? null }
}
