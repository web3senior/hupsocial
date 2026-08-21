'use client'

import { ChartBarIcon } from '@phosphor-icons/react'
import { useClientMounted } from '@/hooks/useClientMount'
import { usePostStats } from '@/hooks/usePostStats'
import Counter from './Counter'
import Tooltip from './Tooltip'

/**
 * View Metrics Component
 * Read-only counter — views are recorded by the IntersectionObserver in Post.jsx,
 * this only surfaces the live total.
 * @param {Object} props
 * @param {Object} props.post Core content model with network metadata and view metrics.
 */
export const View = ({ post }) => {
  const isMounted = useClientMounted()
  const { stats } = usePostStats(post)

  const viewCount = Number(stats?.total_views) || 0

  if (!isMounted) return null

  return (
    <Tooltip content="Views" placement="bottom" size="compact" hoverOnly>
      <button data-action="view" aria-label="Post views">
        <ChartBarIcon width={17} height={17} />
        {viewCount > 0 && (
          <Counter value={viewCount}>
            {new Intl.NumberFormat('en', {
              notation: 'compact',
              maximumFractionDigits: 1,
            }).format(viewCount)}
          </Counter>
        )}
      </button>
    </Tooltip>
  )
}

export default View
