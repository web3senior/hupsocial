'use client'

import { useState, useEffect, useId, useRef, useCallback } from 'react'
import { FluentProvider, webLightTheme, Badge } from '@fluentui/react-components'
import Link from 'next/link'
import moment from 'moment'
import txIcon from '@/../public/icons/tx.svg'
import { useParams, useRouter } from 'next/navigation'
import { useConnectorClient, useConnections, useClient, networks, useWaitForTransactionReceipt, useAccount, useDisconnect, Connector, useConnect, useWriteContract, useReadContract } from 'wagmi'
import {
  initPostContract,
  initPostCommentContract,
  getPosts,
  getPostByIndex,
  getPostCommentCount,
  getCommentsByPostId,
  getHasLikedPost,
  getHasLikedComment,
  getPollLikeCount,
  getPostCount,
  getVoteCountsForPoll,
  getVoterChoices,
  getActiveChain,
} from '@/util/communication'
import { getProfile, getUniversalProfile } from '@/util/api'
import PollTimer from '@/components/PollTimer'
import { useAuth } from '@/contexts/AuthContext'
import Web3 from 'web3'
import { isPollActive } from '@/util/utils'
import { useClientMounted } from '@/hooks/useClientMount'
import { config } from '@/config/wagmi'
import abi from '@/abi/post.json'
import { CommentIcon, ShareIcon, RepostIcon, TipIcon, InfoIcon, BlueCheckMarkIcon } from '@/components/Icons'
import styles from './page.module.scss'

moment.defineLocale('en-short', {
  relativeTime: {
    future: 'in %s',
    past: '%s', //'%s ago'
    s: '1s',
    ss: '%ds',
    m: '1m',
    mm: '%dm',
    h: '1h',
    hh: '%dh',
    d: '1d',
    dd: '%dd',
    M: '1mo',
    MM: '%dmo',
    y: '1y',
    yy: '%dy',
  },
})

export default function Page() {
  const [post, setPost] = useState()

  const [comments, setComments] = useState({ list: [] })
  const [commentsLoaded, setcommentsLoaded] = useState(0)
  const [reactionCounter, setReactionCounter] = useState(0)
  const [commentCount, setCommentCount] = useState(0)
  const [isLoadedComment, setIsLoadedPoll] = useState(false)
  const [showCommentModal, setShowCommentModal] = useState()
  const { web3, contract } = initPostContract()
  const giftModal = useRef()
  const giftModalMessage = useRef()
  const mounted = useClientMounted()
  const [chains, setChains] = useState()
  const params = useParams()
  const [activeChain, setActiveChain] = useState(getActiveChain())
  const { address, isConnected } = useAccount()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const setCommentManager = (e) => {
    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    writeContract({
      abi,
      address: activeChain[1].post,
      functionName: 'setCommentManager',
      args: [document.querySelector(`[name="commentManagerAddress"]`).value],
    })
  }

  useEffect(() => {
    // getPostByIndex(params.id, address).then((res) => {
    //   console.log(res)
    //   res.postId = params.id
    //   setPost(res)
    // })
    // // Comments
    // getPostCommentCount(params.id).then((count) => {
    //   const totalComment = web3.utils.toNumber(count)
    //   setCommentCount(totalComment)
    //   if (commentsLoaded === 0 && !isLoadedComment) {
    //     loadMoreComment(totalComment)
    //   }
    // })
  }, []) // Added necessary dependencies  [isLoadedComment, commentsLoaded]

  return (
    <div className={`${styles.page} ms-motion-slideDownIn`}>
      <div>
        <input type="text" name="commentManagerAddress" id="" placeholder="Comment Manager Address" />
      </div>
      <button onClick={(e) => setCommentManager(e)}>Update</button>
    </div>
  )
}
