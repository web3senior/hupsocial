'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Activity, LucideLoader2, LucideRefreshCcw, Clock, User } from 'lucide-react'
import { getLikesPaginated, initPostContract } from '@/lib/communication'
import Profile from '@/components/Profile'
import { useConnection } from 'wagmi' // Adjust path as needed
import styles from './ActivityFeed.module.scss'

const DEPLOY_BLOCK = 0 

const formatEvent = (event) => ({
  id: `${event.transactionHash}-${event.logIndex}`,
  transactionHash: event.transactionHash,
  blockNumber: Number(event.blockNumber),
  returnValues: {
    postId: event.returnValues.postId.toString(),
    liker: event.returnValues.liker,
  },
})

export default function ActivityFeed() {
  const { address, isConnected } = useConnection()
  
  const [likes, setLikes] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [lastScannedBlock, setLastScannedBlock] = useState(null)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState(null)
  const [userPostIds, setUserPostIds] = useState(new Set())

  const CHUNK_SIZE = 25000
  const PAGE_SIZE = 15

  // Unique cache key per user
  const cacheKey = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}likes_cache_${address}`

  // 1. Fetch User's Post IDs
  useEffect(() => {
    const fetchUserPosts = async () => {
      if (!isConnected || !address) return
      try {
        const { contract } = initPostContract()
        // Replace with your actual contract method name
        const ids = await contract.methods.getPostIdsByAddress(address).call()
        setUserPostIds(new Set(ids.map(id => id.toString())))
      } catch (e) {
        console.error("Could not fetch user posts for filtering", e)
      }
    }
    fetchUserPosts()
  }, [address, isConnected])

  const fetchLikes = useCallback(async (isInitial = false) => {
    if (isLoading || (!hasMore && !isInitial) || !isConnected) return
    
    setIsLoading(true)
    setError(null)

    try {
      const { web3 } = initPostContract()
      const currentBlock = Number(await web3.eth.getBlockNumber())
      const safeTip = currentBlock - 10

      // Load specific cache for this wallet
      const saved = localStorage.getItem(cacheKey)
      const cachedEvents = saved ? JSON.parse(saved) : []

      if (isInitial) {
        if (cachedEvents.length > 0) setLikes(cachedEvents)

        const newestCachedBlock = cachedEvents.length > 0
          ? Math.max(...cachedEvents.map((e) => e.blockNumber))
          : DEPLOY_BLOCK

        if (safeTip > newestCachedBlock) {
          const result = await getLikesPaginated(newestCachedBlock + 1, safeTip, CHUNK_SIZE, PAGE_SIZE)
          
          const filteredNew = result.events
            .map(formatEvent)
            .filter(event => userPostIds.has(event.returnValues.postId))

          const updatedFeed = [...filteredNew, ...cachedEvents].slice(0, 100)
          setLikes(updatedFeed)
          localStorage.setItem(cacheKey, JSON.stringify(updatedFeed))
        }

        const oldestBlockInView = cachedEvents.length > 0 
          ? Math.min(...cachedEvents.map((e) => e.blockNumber)) 
          : safeTip
        setLastScannedBlock(oldestBlockInView - 1)
      } else {
        const result = await getLikesPaginated(DEPLOY_BLOCK, lastScannedBlock, CHUNK_SIZE, PAGE_SIZE)
        
        const filteredOlder = result.events
          .map(formatEvent)
          .filter(event => userPostIds.has(event.returnValues.postId))

        setLikes((prev) => [...prev, ...filteredOlder])
        setLastScannedBlock(result.lastScannedBlock)
        
        if (result.lastScannedBlock <= DEPLOY_BLOCK) setHasMore(false)
      }
    } catch (err) {
      console.error('Fetch Error:', err)
      setError('Sync delayed.')
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, hasMore, lastScannedBlock, isConnected, address, userPostIds, cacheKey])

  // Initial load once we have the user's post IDs
  useEffect(() => {
    if (userPostIds.size > 0) {
      fetchLikes(true)
    }
  }, [userPostIds])

  // Handle Disconnected State
  if (!isConnected) {
    return (
      <div className={styles.container}>
        <div className={styles.status}>
          <User size={20} />
          Please connect your wallet to view activity.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h4><Activity size={18} /> Notifications</h4>
        <button onClick={() => fetchLikes(true)} className={styles.refreshButton} disabled={isLoading}>
          <LucideRefreshCcw className={isLoading ? 'animate-spin' : ''} size={16} />
        </button>
      </div>

      <div className={styles.feed}>
        {likes.length === 0 && !isLoading ? (
          <div className={styles.status}>No likes on your posts yet.</div>
        ) : (
          likes.map((like) => (
            <div key={like.id} className={styles.activityRow}>
              <div className={styles.profileWrapper}>
                <Profile creator={like.returnValues.liker} createdAt={like.blockNumber} />
              </div>
              <div className={styles.actionLabel}>
                Liked your post <span className={styles.postId}>#{like.returnValues.postId}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.footer}>
        {hasMore ? (
          <button 
            onClick={() => fetchLikes(false)} 
            disabled={isLoading} 
            className={styles.loadMore}
          >
            {isLoading ? (
              <><LucideLoader2 className="animate-spin" size={16} /> Searching...</>
            ) : (
              'Load More'
            )}
          </button>
        ) : (
          likes.length > 0 && (
            <div className={styles.status}>
              <Clock size={14} /> Reached the beginning of history
            </div>
          )
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}