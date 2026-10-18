'use client'

import useSWR from 'swr'
import { getIPFS } from '@/lib/ipfs'

export function useIpfsJson(cid) {
  const { data, isLoading } = useSWR(cid ? ['ipfs-json', cid] : null, async () => {
    const json = await getIPFS(cid)
    return json?.result === false ? null : json
  }, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  })

  return { data: data ?? null, isLoading }
}

