'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Heart,
  User,
  Hash,
  Clock,
  Activity,
  ExternalLink,
  LucideHeart,
  LucideLoader2,
  LucideRefreshCcw,
} from 'lucide-react'
import { useWatchContractEvent } from 'wagmi'
import PageTitle from '@/components/PageTitle'
import { config } from '@/config/wagmi'
import { slugify } from '@/lib/utils'
import styles from './page.module.scss'
import { getActiveChain, getLikesPaginated, initPostContract } from '@/lib/communication'

const LIKED_EVENT_ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint256',
        name: 'postId',
        type: 'uint256',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'liker',
        type: 'address',
      },
    ],
    name: 'PostLiked',
    type: 'event',
  },
]

export default function Page() {
  const [likedLogs, setLikedLogs] = useState([])
  const [isLive, setIsLive] = useState(true)

  const [likes, setLikes] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [lastScannedBlock, setLastScannedBlock] = useState(null)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState(null)

  const { web3, contract } = initPostContract()
  // Constants for your contract

  const CHUNK_SIZE = 10000 // Blocks per scan
  const PAGE_SIZE = 20

  /**
   * Core fetching logic
   * @param {boolean} isInitial - Whether we are starting from the latest block or loading more
   */
  const fetchLikes = useCallback(
    async (isInitial = false) => {
      if (isLoading || (!hasMore && !isInitial)) return

      setIsLoading(true)
      setError(null)

      const DEPLOY_BLOCK = Number(await web3.eth.getBlockNumber()) // The block your contract was deployed at
      console.log(DEPLOY_BLOCK)
      try {
        // 1. Initialize Web3 components
        // const { web3 } = initPostContract();

        // 2. Determine scan range
        let endBlock
        if (isInitial) {
          // Fetch current block height for a fresh start
          // endBlock = await web3.eth.getBlockNumber();
          endBlock = 5000 // Mock current block
          setLikes([])
        } else {
          // Start from the block right before our last scan
          endBlock = lastScannedBlock - 1
        }

        // if (endBlock <= DEPLOY_BLOCK) {
        //   setHasMore(false)
        //   setIsLoading(false)
        //   return
        // }

        // 3. Call your paginated function
        // Note: Modify your getLikesPaginated to return { events, lastScannedBlock }
        // so the UI knows where to restart.
        const result = await getLikesPaginated(0, endBlock, CHUNK_SIZE, PAGE_SIZE)
        console.log(result)
        if (result.events.length > 0) {
          setLikes((prev) => (isInitial ? result.events : [...prev, ...result.events]))
        }

        setLastScannedBlock(result.lastScannedBlock)

        // If we scanned all the way to deployment, there's no more data
        if (result.lastScannedBlock <= DEPLOY_BLOCK) {
          setHasMore(false)
        }
      } catch (err) {
        console.error('Failed to fetch likes:', err)
        setError('Failed to sync with the Hup Ledger. Please try again.')
      } finally {
        setIsLoading(false)
      }
    },
    [isLoading, hasMore, lastScannedBlock]
  )

  useEffect(() => {
    if (!isLive) return

    fetchLikes(true)

    //  const interval = setInterval(getPostLikedEvent, 1000)
    // return () => clearInterval(interval)
  }, [isLive])

  return (
    <>
      <PageTitle name={`Search`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width={`medium`}>
          {/* <div className={`grid grid--fill gap-1`} style={{ '--data-width': `150px` }}> */}
        coming soon...
        </div>
      </div>
    </>
  )
}
