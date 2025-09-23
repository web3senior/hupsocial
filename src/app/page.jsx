'use client'

import { useState, useEffect, useId, useRef } from 'react'
import { FluentProvider, webLightTheme, Badge } from '@fluentui/react-components'
import Link from 'next/link'
import moment from 'moment'
import heartIcon from '@/../public/icons/heart.svg'
import commentIcon from '@/../public/icons/comment.svg'
import shareIcon from '@/../public/icons/share.svg'
import repostIcon from '@/../public/icons/repost.svg'
import txIcon from '@/../public/icons/tx.svg'
import { useRouter } from 'next/navigation'
import blueCheckMarkIcon from '@/../public/icons/blue-checkmark.svg'
import { useConnectorClient, useConnections, useClient, networks, useAccount, useDisconnect, Connector, useConnect, useWriteContract, useReadContract } from 'wagmi'
import { initContract, getPolls, getPollCount, getVoteCountsForPoll, getVoterChoices } from '@/util/communication'
import { getProfile } from '@/util/api'
import PollTimer from '@/components/PollTimer'
import { useAuth } from '@/contexts/AuthContext'
import Web3 from 'web3'
import { isPollActive } from '@/util/utils'
import { useClientMounted } from '@/hooks/useClientMount'
import { config } from '@/config/wagmi'
import abi from '@/abi/hup.json'
import { toast } from '@/components/NextToast'
import styles from './page.module.scss'
import Shimmer from '@/helper/Shimmer'

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
  const [polls, setPolls] = useState([])
  const [reactionCounter, setReactionCounter] = useState(0)
  const [selectedEmoji, setSelectedEmoji] = useState()
  const { web3, contract } = initContract()
  const giftModal = useRef()
  const giftModalMessage = useRef()
  const mounted = useClientMounted()
  const { address, isConnected } = useAccount()
  const { writeContract } = useWriteContract()
  const router = useRouter()

  /**
   * Close the gift modal
   */
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
      const contract = new web3.eth.Contract(ABI, process.env.NEXT_PUBLIC_CONTRACT)
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

  const like = (pollId) => {}

  const unLike = (pollId) => {}

  const openModal = (e, item) => {
    e.target.innerText = `Sending...`
    setSelectedEmoji({ e: e.target, item: item, message: null })
    giftModal.current.showModal()
  }

  useEffect(() => {
    getPollCount().then((pollCount) => {
      console.log(pollCount)

      getPolls(1, web3.utils.toNumber(pollCount)).then((res) => {
        console.log(res)
        if (Array.isArray(res)) setPolls(res.reverse())
      })
    })

    //getReactionCounter().then((counter) => setReactionCounter(counter))
  }, [])

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <h3 className={`page-title`}>home</h3>

        <div className={`__container ${styles.page__container} mt-100`} data-width={`medium`}>
          <div className={`${styles.grid} flex flex-column`}>
            {polls &&
              polls.length > 0 &&
              polls.map((item, i) => {
                return (
                  <article onClick={() => router.push(`poll/${item.pollId}`)} key={i}>
                    {/* href={`p/${item.pollId}`} */}
                    <section data-name={item.name} className={`${styles.poll} flex flex-column align-items-start justify-content-between gap-1`}>
                      <header className={`${styles.poll__header}  w-100`}>
                        <Profile creator={item.creator} createdAt={item.createdAt} />
                      </header>
                      <main className={`${styles.poll__main} w-100 flex flex-column grid--gap-050 pl-70`}>
                        <p>{item.question}</p>

                        {item.pollType.toString() === `2` && (
                          <div className={`flex flex-row align-items-center gap-025`}>
                            <span className={`badge badge-pill badge-primary`}>only lyx holders</span>
                            <span className={`badge badge-pill badge-danger`}>&gt; {web3.utils.fromWei(item.holderAmount, `ether`)} LYX</span>
                          </div>
                        )}

                        <Options item={item} />

                        <div className={`${styles.poll__actions} w-100 flex flex-row align-items-center justify-content-start`}>
                          <button>
                            <img alt={`blue checkmark icon`} src={heartIcon.src} />
                            <span>{0}</span>
                          </button>

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
                            <span>{new Intl.NumberFormat().format(0)} LYX</span>
                          </button>
                          {/* <Link target={`_blank`} href={`https://exmaple.com/tx/`} className={`flex flex-row align-items-center gap-025  `}>
                          <img alt={`blue checkmark icon`} src={txIcon.src} />
                        </Link> */}
                        </div>
                      </main>
                    </section>
                    {i < polls.length - 1 && <hr />}
                  </article>
                )
              })}
          </div>
        </div>
      </div>
    </FluentProvider>
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
  const [totalVotes, setTotalVotes] = useState(0)
  const { web3, contract: readOnlyContract } = initContract()
  const { address, isConnected } = useAccount()
  const { writeContract } = useWriteContract()

  const vote = async (e, pollId, optionIndex) => {
    e.stopPropagation()
    console.log(isPollActive(item.startTime, item.endTime))
    if (!isPollActive(item.startTime, item.endTime).isActive) {
      toast(`Poll is not active!`, `danger`)
      return
    }

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    // writeContract({
    //   address: process.env.NEXT_PUBLIC_CONTRACT,
    //   abi,
    //   functionName: 'mint',
    //   args: [BigInt(tokenId)],
    // })

    const result = writeContract({
      abi,
      address: process.env.NEXT_PUBLIC_CONTRACT,
      functionName: 'vote',
      args: [pollId, 0n],
    })
console.log(result)
    console.log('------------')
    return
    const web3 = new Web3(config)

    // Create a Contract instance
    const contract = new web3.eth.Contract(abi, process.env.NEXT_PUBLIC_CONTRACT)

    // setIsLoading(true)

    // const t = toast.loading(`Waiting for transaction's confirmation`)

    //const formData = new FormData(e.target)
    // const price = formData.get('price')
    console.log(pollId, optionIndex)
    try {
      contract.methods
        .vote(pollId, optionIndex)
        .send({
          from: address,
        })
        .then((res) => {
          console.log(res) //res.events.tokenId

          //setIsLoading(true)

          //   toast.success(`Done`)

          // toast.dismiss(t)
        })
        .catch((error) => {
          console.log(error)
          // toast.dismiss(t)
        })
    } catch (error) {
      console.log(error)
      toast.dismiss(t)
    }
  }

  useEffect(() => {
    getVoteCountsForPoll(web3.utils.toNumber(item.pollId)).then((res) => {
      console.log(res)
      setOptionsVoteCount(res)
      setTotalVotes(res.reduce((a, b) => web3.utils.toNumber(a) + web3.utils.toNumber(b), 0))
      setStatus(``)
    })

    getVoterChoices(web3.utils.toNumber(item.pollId), address).then((res) => {
      console.log(web3.utils.toNumber(res))
      if (web3.utils.toNumber(res) > 0) setVoted(web3.utils.toNumber(res))
    })
  }, [])

  if (status === `loading`)
    return (
      <>
        <Shimmer style={{ background: `var(--gray-100)`, height: `50px` }} />
        <Shimmer style={{ background: `var(--gray-100)`, height: `50px` }} />
        <Shimmer style={{ background: `var(--gray-100)`, height: `50px` }} />
      </>
    )

  return (
    <>
      <ul className={`${styles.poll__options} flex flex-column gap-050 w-100`}>
        {!voted &&
          item.options.map((option, i) => {
            return (
              <li key={i} title={``} className={`${styles.poll__options__option} flex flex-row align-items-center justify-content-between`} onClick={(e) => vote(e, web3.utils.toNumber(item.pollId), i)}>
                <span>{option}</span>
              </li>
            )
          })}

        {voted &&
          item.options.map((option, i) => {
            return (
              <li
                key={i}
                title={``}
                data-votes={web3.utils.toNumber(optionsVoteCount[i])}
                data-chosen={voted === i + 1 ? true : false}
                style={{ '--data-width': `${(web3.utils.toNumber(optionsVoteCount[i]) / totalVotes) * 100}%` }}
                data-percentage={(web3.utils.toNumber(optionsVoteCount[i]) / totalVotes) * 100}
                className={`${styles.poll__options__voted} flex flex-row align-items-center justify-content-between`}
              >
                <span>{option}</span>
              </li>
            )
          })}
      </ul>

      <p className={`${styles.poll__ends}`}>
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
  const [profile, setProfile] = useState({
    data: {
      Profile: [
        {
          fullName: 'atenyun#188e',
          name: 'atenyun',
          description: '🌐 Working remotely\n👨‍💻 Software dev & tutor\n🧘‍♂️ Yoga\n\n⏣Official LUKSO Ambassador⏣ 🆙',
          id: '0x188eec07287d876a23565c3c568cbe0bb1984b83',
          profileImages: [
            {
              src: 'https://api.universalprofile.cloud/image/QmNhc9ZURyfqrEkn6dtVK12RBEoYZ61dcF9pivVuNCkitS?method=keccak256(bytes)&data=0xeef9c765d065ee3c3499ae953757523b8d38516fa3af39bd4a32ff701ad0f844',
            },
            {
              src: 'https://api.universalprofile.cloud/image/QmdoAvDg1BBjn55jAz89nr9zjM3NtCsW8aEqfh7ogHAarH?method=keccak256(bytes)&data=0x2c8bf1fae505819299cc003771c7a08e789cd07219886ebe39bc0b8c57c1ac95',
            },
            {
              src: 'https://api.universalprofile.cloud/image/QmdUkBCTotaaKYMx1azkYdreCt4R5kTH4VyyCLdwZNtG8M?method=keccak256(bytes)&data=0xae1e394ddfec918ad42c42e0911d935ec423fcb7024fad1fd68af94df5107ecd',
            },
            {
              src: 'https://api.universalprofile.cloud/image/QmR9K5NVHZQxwopoKeDQEMeynxxq8cyPfUiU7fqfeeqbV1?method=keccak256(bytes)&data=0xe25a3521b5f28c353a26a9c0b2a6001cb38a4606cc58e29a11363c518c469a34',
            },
          ],
        },
      ],
    },
  })
  const { web3, contract } = initContract()

  useEffect(() => {
    getProfile(creator).then((res) => {
      console.log(res)
      if (res.data && Array.isArray(res.data.Profile) && res.data.Profile.length > 0) {
        setProfile(res)
      }
    })
  }, [])

  if (!profile) return <div className={`shimmer ${styles.shimmer}`} />

  return (
    <figure className={`flex flex-row align-items-center justify-content-start gap-050`}>
      <img
        alt={profile.data.Profile[0].name || `Default PFP`}
        src={`${profile.data.Profile[0].profileImages.length > 0 ? profile.data.Profile[0].profileImages[0].src : 'https://ipfs.io/ipfs/bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm'}`}
        className={`${styles.pfp} rounded`}
      />
      <figcaption className={`flex flex-column gap-025`}>
        <div className={`flex align-items-center gap-025`}>
          <b>{profile.data.Profile[0].name}</b>
          <img alt={`blue checkmark icon`} src={blueCheckMarkIcon.src} />
          <small className={`text-secondary`}>{moment.unix(web3.utils.toNumber(createdAt)).utc().fromNow()}</small>
        </div>
        <code className={`text-secondary`}>{`${creator.slice(0, 4)}…${creator.slice(38)}`}</code>
      </figcaption>
    </figure>
  )
}
