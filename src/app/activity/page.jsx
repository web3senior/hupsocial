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
      <PageTitle name={`Activity`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={` __container ${styles.page__container}`} data-width={`medium`}>
          {/* <div className={`grid grid--fill gap-1`} style={{ '--data-width': `150px` }}> */}
          Coming soon: Activity feed and notifications.
          <div className="d-none min-h-screen bg-slate-50 p-4 md:p-12 font-sans text-slate-900">
            <script src="https://cdn.tailwindcss.com"></script>

            <div className="max-w-3xl mx-auto">
              <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                <h3>Coming soon</h3>
                <button
                  onClick={() => setIsLive(!isLive)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold transition-all ${
                    isLive
                      ? 'bg-pink-100 text-pink-600 border-2 border-pink-200 hover:bg-pink-200'
                      : 'bg-slate-200 text-slate-500 border-2 border-slate-300'
                  }`}
                >
                  <Activity className={`w-4 h-4 ${isLive ? 'animate-pulse' : ''}`} />
                  {isLive ? 'Live Monitoring' : 'Monitoring Paused'}
                </button>
              </header>

              <div className="space-y-4">
                {likedLogs.length === 0 ? (
                  <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-20 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 text-slate-400 mb-4">
                      <Clock className="w-8 h-8" />
                    </div>
                    <p className="text-slate-400 font-medium">
                      Waiting for interactions on the blockchain...
                    </p>
                  </div>
                ) : (
                  likedLogs.map((log) => (
                    <div
                      key={log.id}
                      className="group bg-white border-2 border-slate-100 rounded-2xl p-5 shadow-sm hover:border-pink-200 hover:shadow-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex gap-4">
                          <div className="mt-1 bg-pink-50 p-2 rounded-xl text-pink-500">
                            <Heart className="w-5 h-5 fill-pink-500" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-slate-800 flex items-center gap-1">
                                <User className="w-3 h-3 text-slate-400" />
                                {log.args.liker}
                              </span>
                              <span className="text-slate-400 text-sm">liked a post</span>
                            </div>

                            <div className="flex items-center gap-4 text-sm text-slate-500">
                              <span className="flex items-center gap-1.5 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100">
                                <Hash className="w-3 h-3" />
                                {log.args.postCid}
                              </span>
                              <span className="flex items-center gap-1.5">
                                <Clock className="w-3 h-3" />
                                {new Date(log.args.timestamp * 1000).toLocaleTimeString()}
                              </span>
                            </div>
                          </div>
                        </div>

                        <a
                          href="#"
                          className="opacity-0 group-hover:opacity-100 p-2 text-slate-400 hover:text-indigo-500 transition-all"
                          title="View Transaction"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {likedLogs.length > 0 && (
                <p className="text-center text-slate-400 text-xs mt-8 uppercase tracking-widest font-bold">
                  Showing last {likedLogs.length} events
                </p>
              )}
            </div>
          </div>

          <div className="d-none ms-motion-slideDownIn p-4 md:p-8 font-sans text-slate-900">
            <div className="max-w-2xl mx-auto">
              <header className="flex items-center justify-between mb-8">
                <div>
                  <h1 className="text-2xl font-bold flex items-center gap-2">
                    <LucideHeart className="text-pink-500 fill-pink-500" />
                    Recent Likes
                  </h1>
                  <p className="text-slate-500 text-sm">Synchronized with blockchain events</p>
                </div>
                <button
                  onClick={() => fetchLikes(true)}
                  disabled={isLoading}
                  className="p-2 hover:bg-slate-200 rounded-full transition-colors disabled:opacity-50"
                >
                  <LucideRefreshCcw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </header>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-xl mb-6 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-3">
                {likes.map((event, idx) => (
                  <div
                    key={`${event.transactionHash}-${idx}`}
                    className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between animate-in fade-in slide-in-from-bottom-2"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-xs font-mono text-slate-500">
                        {event.returnValues.liker.slice(0, 4)}
                      </div>
                      <div>
                        <p className="font-medium text-sm">
                          {event.returnValues.liker.slice(0, 6)}...
                          {event.returnValues.liker.slice(-4)}
                        </p>
                        <p className="text-xs text-slate-400">Block: {event.blockNumber}</p>
                      </div>
                    </div>
                    <div className="text-xs font-medium px-2 py-1 bg-pink-50 text-pink-600 rounded-lg">
                      Post #{event.returnValues.postId}
                    </div>
                  </div>
                ))}
              </div>

              {/* Load More Trigger */}
              <div className="mt-8 flex justify-center">
                {hasMore ? (
                  <button
                    onClick={() => fetchLikes(false)}
                    disabled={isLoading}
                    className="flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-full font-medium hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isLoading ? (
                      <>
                        <LucideLoader2 className="w-4 h-4 animate-spin" />
                        Scanning Ledger...
                      </>
                    ) : (
                      'Load More'
                    )}
                  </button>
                ) : (
                  <p className="text-slate-400 text-sm italic">Reached the beginning of time</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
