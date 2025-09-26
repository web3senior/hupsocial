'use client'

import { useState, useEffect, useId, useRef } from 'react'
import { FluentProvider, webLightTheme, Badge } from '@fluentui/react-components'
import Link from 'next/link'
import moment from 'moment'
import heartIcon from '@/../public/icons/heart.svg'
import heartFilledIcon from '@/../public/icons/heart-filled.svg'
import commentIcon from '@/../public/icons/comment.svg'
import shareIcon from '@/../public/icons/share.svg'
import repostIcon from '@/../public/icons/repost.svg'
import txIcon from '@/../public/icons/tx.svg'
import { useParams, useRouter } from 'next/navigation'
import blueCheckMarkIcon from '@/../public/icons/blue-checkmark.svg'
import { useConnectorClient, useConnections, useClient, networks, useWaitForTransactionReceipt, useAccount, useDisconnect, Connector, useConnect, useWriteContract, useReadContract } from 'wagmi'
import { initContract, getPollByIndex, getHasLiked, getPollLikeCount, getPollCount, getVoteCountsForPoll, getVoterChoices } from '@/util/communication'
import { getProfile } from '@/util/api'
import PollTimer from '@/components/PollTimer'
import { useAuth } from '@/contexts/AuthContext'
import Web3 from 'web3'
import { isPollActive } from '@/util/utils'
import { useClientMounted } from '@/hooks/useClientMount'
import { config } from '@/config/wagmi'
import abi from '@/abi/hup.json'
import { toast } from '@/components/NextToast'
import Shimmer from '@/helper/Shimmer'
import { InlineLoading } from '@/components/Loading'
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
  const [poll, setPoll] = useState([])
  const [reactionCounter, setReactionCounter] = useState(0)
  const [selectedEmoji, setSelectedEmoji] = useState()
  const { web3, contract } = initContract()
  const giftModal = useRef()
  const giftModalMessage = useRef()
  const mounted = useClientMounted()
  const { address, isConnected } = useAccount()
  const router = useRouter()
  const params = useParams()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const giftModalClose = (action) => {
    // Check if user canceled gifting
    if (action === 'cancel') {
      giftModal.current.close()
      selectedEmoji.e.innerText = `Gift`
      return
    }

    const t = toast.loading(`Waiting for transaction's confirmation`)
    console.log(giftModalMessage.current.value)
    const message = giftModalMessage.current.value

    try {
      // window.lukso.request({ method: 'eth_requestAccounts' }).then((accounts) => {})
      const web3 = new Web3(auth.provider)

      // Create a Contract instance
      const contract = new web3.eth.Contract(abi, process.env.NEXT_PUBLIC_CONTRACT)
      contract.methods
        .react(auth.contextAccounts[0], selectedEmoji.item.emojiId, web3.utils.toHex(message))
        .send({
          from: account,
          value: selectedEmoji.item.price,
        })
        .then((res) => {
          console.log(res)

          toast.success(`Done`)
          toast.dismiss(t)

          party.confetti(document.body, {
            count: party.variation.range(20, 40),
          })
        })
        .catch((error) => {
          toast.dismiss(t)
        })
    } catch (error) {
      console.log(error)
      toast.dismiss(t)
    }
  }

  const likePoll = (e, pollId) => {
    e.stopPropagation()

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    writeContract({
      abi,
      address: process.env.NEXT_PUBLIC_CONTRACT,
      functionName: 'likePoll',
      args: [pollId],
    })
  }

  const unLikePoll = (pollId) => {}

  const openModal = (e, item) => {
    e.target.innerText = `Sending...`
    setSelectedEmoji({ e: e.target, item: item, message: null })
    giftModal.current.showModal()
  }

  useEffect(() => {
  getPollByIndex(params.id).then((res) => {
        console.log(res)
        res.pollId = params.id
        setPoll(res)
      })

    //getReactionCounter().then((counter) => setReactionCounter(counter))
  }, [])

  return (

      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <h3 className={`page-title`}>home</h3>

        <div className={`__container ${styles.page__container}`} data-width={`medium`}>
          {poll.length < 1 && <div className={`shimmer ${styles.pollShimmer}`} />}
          <div className={`${styles.grid} flex flex-column`}>
            {poll.length > 0 &&
              poll.map((item, i) => {
                return (
                  <article key={i}>
                    <section data-name={item.name} className={`${styles.poll} flex flex-column align-items-start justify-content-between`}>
                      <header className={`${styles.poll__header}`}>
                        <Profile creator={item.creator} createdAt={item.createdAt} />
                      </header>
                      <main className={`${styles.poll__main} w-100 flex flex-column grid--gap-050`}>
                        <div className={`${styles.poll__question}`} id={`pollQuestion${item.pollId}`}>
                          {item.question.length > 280 ? (
                            <>
                              {item.question.slice(0, 280) + `…`}
                              <p
                                className={`${styles.poll__showmore}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  document.querySelector(`#pollQuestion${item.pollId}`).innerText = `${item.question}`
                                }}
                              >
                                <b className={`text-primary`}>Show More</b>
                              </p>
                            </>
                          ) : (
                            <>{item.question}</>
                          )}
                        </div>

                        {item.pollType.toString() === `2` && (
                          <div className={`flex flex-row align-items-center gap-025`}>
                            <span className={`badge badge-pill badge-primary`}>only lyx holders</span>
                            <span className={`badge badge-pill badge-danger`}>&gt; {web3.utils.fromWei(item.holderAmount, `ether`)} LYX</span>
                          </div>
                        )}

                     {item.options.length > 0 && <Options item={item} />}

                        <div className={`${styles.poll__actions} w-100 flex flex-row align-items-center justify-content-start`}>
                          <button onClick={(e) => likePoll(e, item.pollId)}>{<LikeCount pollId={item.pollId} />}</button>

                          {item.allowedComments && (
                            <button>
                              <img alt={`blue checkmark icon`} src={commentIcon.src} />
                              <span>{0}</span>
                            </button>
                          )}

                          <button>
                            <img alt={`blue checkmark icon`} src={repostIcon.src} />
                          </button>

                          <button>
                            <img alt={`blue checkmark icon`} src={shareIcon.src} />
                          </button>

                          <button>
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path
                                d="M12 8.16338C12.1836 8.16338 12.3401 8.09875 12.4695 7.9695C12.5988 7.84012 12.6634 7.68363 12.6634 7.5C12.6634 7.31638 12.5988 7.15988 12.4695 7.0305C12.3401 6.90125 12.1836 6.83663 12 6.83663C11.8164 6.83663 11.6599 6.90125 11.5305 7.0305C11.4013 7.15988 11.3366 7.31638 11.3366 7.5C11.3366 7.68363 11.4013 7.84012 11.5305 7.9695C11.6599 8.09875 11.8164 8.16338 12 8.16338ZM6 6.5625H9.75V5.4375H6V6.5625ZM3.65625 15.375C3.26013 14.0076 2.86425 12.6471 2.46863 11.2933C2.07288 9.93944 1.875 8.55 1.875 7.125C1.875 6.08075 2.23894 5.19469 2.96681 4.46681C3.69469 3.73894 4.58075 3.375 5.625 3.375H9.5625C9.90575 2.924 10.3176 2.56125 10.7979 2.28675C11.2782 2.01225 11.8039 1.875 12.375 1.875C12.5818 1.875 12.7584 1.94831 12.9051 2.09494C13.0517 2.24156 13.125 2.41825 13.125 2.625C13.125 2.676 13.118 2.72694 13.104 2.77781C13.0901 2.82881 13.0755 2.87594 13.0601 2.91919C12.9909 3.09994 12.9319 3.28506 12.8833 3.47456C12.8348 3.66394 12.7933 3.85525 12.7586 4.0485L14.7101 6H16.125V10.5821L14.0783 11.2543L12.8438 15.375H9.375V13.875H7.125V15.375H3.65625ZM4.5 14.25H6V12.75H10.5V14.25H12L13.1625 10.3875L15 9.76875V7.125H14.25L11.625 4.5C11.625 4.25 11.6406 4.00938 11.6719 3.77813C11.7031 3.54688 11.7548 3.31488 11.8269 3.08213C11.4644 3.18213 11.1481 3.35644 10.8778 3.60506C10.6077 3.85356 10.4005 4.15188 10.2563 4.5H5.625C4.9 4.5 4.28125 4.75625 3.76875 5.26875C3.25625 5.78125 3 6.4 3 7.125C3 8.35 3.16875 9.54688 3.50625 10.7156C3.84375 11.8844 4.175 13.0625 4.5 14.25Z"
                                fill="#424242"
                              />
                            </svg>
                            <span>{new Intl.NumberFormat().format(0)}</span>
                          </button>
                          {/* <Link target={`_blank`} href={`https://exmaple.com/tx/`} className={`flex flex-row align-items-center gap-025  `}>
                          <img alt={`blue checkmark icon`} src={txIcon.src} />
                        </Link> */}
                        </div>
                      </main>
                    </section>
                  </article>
                )
              })}
          </div>
        </div>
      </div>
  )
}

const LikeCount = ({ pollId }) => {
  const [likeCount, setLikeCount] = useState(null)
  const [hasLiked, setHasLiked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const isMounted = useClientMounted()
  const { address, isConnected } = useAccount()

  const getPollData = async () => {
    const likeCount = await getPollLikeCount(pollId)
    const isLiked = isConnected ? await getHasLiked(pollId, address) : false
    console.log(isLiked)
    return { likeCount, hasLiked: isLiked }
  }

  useEffect(() => {
    getPollData()
      .then((result) => {
        setLikeCount(result.likeCount)
        setHasLiked(result.hasLiked)
        setLoading(false)
      })
      .catch((err) => {
        console.log(err)
        setError(`⚠️`)
        setLoading(false)
      })
  }, [pollId])

  if (loading) {
    return <InlineLoading />
  }

  if (error) {
    return <span>{error}</span>
  }

  return (
    <>
      {hasLiked ? <img alt={``} src={heartFilledIcon.src} /> : <img alt={``} src={heartIcon.src} />}
      <span>{likeCount}</span>
    </>
  )
}

/**
 * Options
 * @param {Object} item
 * @returns
 */
const Options = ({ item }) => {
  const [status, setStatus] = useState(`loading`)
  const [optionsVoteCount, setOptionsVoteCount] = useState()
  const [voted, setVoted] = useState()
  const [topOption, setTopOption] = useState()
  const [totalVotes, setTotalVotes] = useState(0)
  const { web3, contract: readOnlyContract } = initContract()
  const { address, isConnected } = useAccount()
  const { data: hash, isPending, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const vote = async (e, pollId, optionIndex) => {
    e.stopPropagation()
    console.log(isPollActive(item.startTime, item.endTime))

    if (isPollActive(item.startTime, item.endTime).status === `endeed`) {
      return
    }

    if (isPollActive(item.startTime, item.endTime).status === `willstart`) {
      toast(`Poll is not active yet.`, `warning`)
      return
    }

     if (voted) {
      return
    }

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    writeContract({
      abi,
      address: process.env.NEXT_PUBLIC_CONTRACT,
      functionName: 'vote',
      args: [pollId, optionIndex],
    })
  }

  useEffect(() => {
    getVoteCountsForPoll(web3.utils.toNumber(item.pollId)).then((res) => {
      console.log(res)
      setOptionsVoteCount(res)
      setTotalVotes(res.reduce((a, b) => web3.utils.toNumber(a) + web3.utils.toNumber(b), 0))

      // 1. Map the array to convert all BigInts to standard numbers.
      const numbers = res.map((n) => web3.utils.toNumber(n))

      // 2. Find the maximum of the resulting standard numbers.
      const largestOne = Math.max(...numbers)

      setTopOption(largestOne)

      setStatus(``)
    })

    // Get connected wallet choice
    if (isConnected) {
      getVoterChoices(web3.utils.toNumber(item.pollId), address).then((res) => {
        console.log(web3.utils.toNumber(res))
        if (web3.utils.toNumber(res) > 0) setVoted(web3.utils.toNumber(res))
      })
    }
  }, [item])

  if (status === `loading`)
    return (
      <>
        <div className={`shimmer ${styles.optionShimmer}`} />
        <div className={`shimmer ${styles.optionShimmer}`} />
        <div className={`shimmer ${styles.optionShimmer}`} />
      </>
    )

  return (
    <>
      <ul className={`${styles.poll__options} flex flex-column gap-050 w-100`}>
        {item.options.map((option, i) => {
          const votePercentage = totalVotes > 0 ? ((web3.utils.toNumber(optionsVoteCount[i]) / totalVotes) * 100).toFixed() : 0
          return (
            <li
              key={i}
              title={``}
              data-votes={web3.utils.toNumber(optionsVoteCount[i])}
              data-chosen={voted && voted === i + 1 ? true : false}
              style={{ '--data-width': `${votePercentage}%` }}
              data-percentage={votePercentage}
              data-isactive={isPollActive(item.startTime, item.endTime).isActive}
              data-top-option={topOption && topOption === i ? true : false}
              className={`${isPollActive(item.startTime, item.endTime).status === `endeed` ? styles.poll__options__optionEndeed : styles.poll__options__option} flex flex-row align-items-center justify-content-between`}
              onClick={(e) => vote(e, web3.utils.toNumber(item.pollId), i)}
              disabled={isPending || isConfirming}
            >
              <span>{option}</span>
            </li>
          )
        })}
      </ul>

      <p className={`${styles.poll__footer}`}>
        {optionsVoteCount && <>{totalVotes}</>} votes • {` `}
        <PollTimer startTime={item.startTime} endTime={item.endTime} pollId={item.pollId} />
      </p>
    </>
  )
}

/**
 * Profile
 * @param {String} addr
 * @returns
 */
const Profile = ({ creator, createdAt }) => {
  const [profile, setProfile] = useState()
  const { web3, contract } = initContract()

  useEffect(() => {
    getProfile(creator).then((res) => {
      console.log(res)
      if (res.data && Array.isArray(res.data.Profile) && res.data.Profile.length > 0) {
        setProfile(res)
      }
    })
  }, [])

  if (!profile)
    return (
      <div className={`${styles.profileShimmer} flex align-items-center gap-050`}>
        <div className={`shimmer rounded`} style={{ width: `36px`, height: `36px` }} />
        <div className={`flex flex-column justify-content-between gap-025`}>
          <span className={`shimmer rounded`} style={{ width: `60px`, height: `10px` }} />
          <span className={`shimmer rounded`} style={{ width: `40px`, height: `10px` }} />
        </div>
      </div>
    )

  return (
    <div className={`${styles.poll__header}`}>
      <figure className={`flex align-items-center`}>
        <img
          alt={profile.data.Profile[0].name || `Default PFP`}
          src={`${profile.data.Profile[0].profileImages.length > 0 ? profile.data.Profile[0].profileImages[0].src : 'https://ipfs.io/ipfs/bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm'}`}
          className={`rounded`}
        />
        <figcaption className={`flex flex-column`}>
          <div className={`flex align-items-center gap-025`}>
            <b>{profile.data.Profile[0].name}</b>
            <img alt={`blue checkmark icon`} src={blueCheckMarkIcon.src} />
            <small className={`text-secondary`}>{moment.unix(web3.utils.toNumber(createdAt)).utc().fromNow()}</small>
          </div>
          <code className={`text-secondary`}>{`${creator.slice(0, 4)}…${creator.slice(38)}`}</code>
        </figcaption>
      </figure>
    </div>
  )
}
